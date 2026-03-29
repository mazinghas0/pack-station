import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  orderBy,
  deleteDoc,
  runTransaction,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { ParsedOrder, ParsedExcelData } from './types';

/** ========== 업로드 (엑셀 데이터 저장) ========== */

/** 엑셀 파싱 결과를 Firestore에 저장 */
export async function saveUpload(data: ParsedExcelData): Promise<string> {
  const uploadId = `upload_${Date.now()}`;
  const uploadRef = doc(db, 'uploads', uploadId);

  await setDoc(uploadRef, {
    id: uploadId,
    fileName: data.fileName,
    totalOrders: data.totalOrders,
    totalQuantity: data.totalQuantity,
    uniqueProducts: data.uniqueProducts,
    uniqueWaybills: data.uniqueWaybills,
    status: 'uploaded',
    createdAt: serverTimestamp(),
  });

  /** 주문 데이터를 배치로 저장 (500개씩 분할 - Firestore 제한) */
  const batchSize = 450;
  for (let i = 0; i < data.orders.length; i += batchSize) {
    const batch = writeBatch(db);
    const chunk = data.orders.slice(i, i + batchSize);

    for (const order of chunk) {
      const orderId = `${uploadId}_${order.waybillNumber}_${order.productBarcode}`;
      const orderRef = doc(db, 'orders', orderId);
      batch.set(orderRef, {
        ...order,
        id: orderId,
        uploadId,
        stationId: null,
        cellNumber: null,
        batchId: null,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  }

  return uploadId;
}

/** 최신 업로드 조회 */
export async function getLatestUpload(): Promise<{ id: string; fileName: string; totalOrders: number; totalQuantity: number; uniqueProducts: number; uniqueWaybills: number; status: string } | null> {
  const q = query(collection(db, 'uploads'), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const docData = snapshot.docs[0].data();
  return {
    id: docData.id,
    fileName: docData.fileName,
    totalOrders: docData.totalOrders,
    totalQuantity: docData.totalQuantity,
    uniqueProducts: docData.uniqueProducts,
    uniqueWaybills: docData.uniqueWaybills,
    status: docData.status,
  };
}

/** ========== 운송장 스캔 (셀 배정) ========== */

/** 운송장을 스캔하여 셀에 배정 (트랜잭션으로 이중 배정 방지) */
export async function assignWaybillToCell(
  stationId: string,
  cellNumber: number,
  waybillNumber: string,
  uploadId: string
): Promise<{ success: boolean; error?: string; existingStation?: string; existingCell?: number }> {
  /** 1. 업로드 데이터에서 해당 운송장의 주문 라인 조회 (트랜잭션 밖 — 읽기 전용) */
  const orderQuery = query(
    collection(db, 'orders'),
    where('uploadId', '==', uploadId),
    where('waybillNumber', '==', waybillNumber)
  );
  const orderSnap = await getDocs(orderQuery);

  if (orderSnap.empty) {
    return {
      success: false,
      error: '출고 데이터에 없는 운송장입니다. 번호를 확인해주세요.',
    };
  }

  const products = orderSnap.docs.map((d) => {
    const data = d.data();
    return {
      productCode: data.productCode,
      productBarcode: data.productBarcode,
      productName: data.productName,
      requiredQuantity: data.confirmedQuantity || data.quantity,
      packedQuantity: 0,
      status: 'pending' as const,
    };
  });

  const totalSkuCount = products.length;
  const totalQuantity = products.reduce((sum, p) => sum + p.requiredQuantity, 0);
  const customerName = orderSnap.docs[0].data().customerName || '';
  const deliveryMemo = orderSnap.docs[0].data().deliveryMemo || '';

  /** 2. 트랜잭션: 중복 체크 + 셀 생성을 원자적으로 처리 */
  const cellId = `${stationId}_cell_${cellNumber}`;
  const cellRef = doc(db, 'cells', cellId);
  /** 중복 체크용 마커 문서 (운송장번호 기준) */
  const waybillLockRef = doc(db, 'waybillLocks', waybillNumber);

  try {
    await runTransaction(db, async (tx) => {
      /** 셀 번호 충돌 체크 */
      const cellSnap = await tx.get(cellRef);
      if (cellSnap.exists()) {
        throw new Error('CELL_EXISTS');
      }

      /** 운송장 중복 체크 (마커 문서 기반) */
      const lockSnap = await tx.get(waybillLockRef);
      if (lockSnap.exists()) {
        const lockData = lockSnap.data();
        throw new Error(`DUPLICATE:${lockData.stationId}:${lockData.cellNumber}`);
      }

      /** 마커 문서 생성 (중복 방지용) */
      tx.set(waybillLockRef, {
        stationId,
        cellNumber,
        createdAt: serverTimestamp(),
      });

      /** 셀 문서 생성 */
      tx.set(cellRef, {
        id: cellId,
        stationId,
        cellNumber,
        waybillNumber,
        customerName,
        deliveryMemo,
        uploadId,
        totalSkuCount,
        packedSkuCount: 0,
        totalQuantity,
        packedQuantity: 0,
        status: 'assigned',
        products,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';

    if (msg === 'CELL_EXISTS') {
      return { success: false, error: '이미 사용 중인 셀입니다. 다시 스캔해주세요.' };
    }

    if (msg.startsWith('DUPLICATE:')) {
      const parts = msg.split(':');
      return {
        success: false,
        error: '이미 등록된 운송장입니다',
        existingStation: parts[1],
        existingCell: Number(parts[2]),
      };
    }

    return { success: false, error: err instanceof Error ? err.message : '셀 배정 실패' };
  }

  /** 3. 주문 상태 업데이트 (트랜잭션 밖 — 실패해도 셀 배정은 유지) */
  const orderBatch = writeBatch(db);
  for (const orderDoc of orderSnap.docs) {
    orderBatch.update(orderDoc.ref, {
      stationId,
      cellNumber,
      status: 'assigned',
    });
  }
  await orderBatch.commit();

  return { success: true };
}

/** ========== 실시간 리스너 ========== */

/** 스테이션의 셀 목록 실시간 구독 */
export function subscribeToCells(
  stationId: string,
  callback: (cells: CellData[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cells'),
    where('stationId', '==', stationId)
  );

  return onSnapshot(q, (snapshot) => {
    const cells: CellData[] = snapshot.docs.map((d) => d.data() as CellData);
    cells.sort((a, b) => a.cellNumber - b.cellNumber);
    callback(cells);
  });
}

/** 셀 데이터 타입 (Firestore 문서) */
export interface CellData {
  id: string;
  stationId: string;
  cellNumber: number;
  waybillNumber: string;
  customerName: string;
  deliveryMemo: string;
  uploadId: string;
  totalSkuCount: number;
  packedSkuCount: number;
  totalQuantity: number;
  packedQuantity: number;
  status: string;
  products: {
    productCode: string;
    productBarcode: string;
    productName: string;
    requiredQuantity: number;
    packedQuantity: number;
    status: string;
  }[];
}

/** 전체 스테이션 현황 실시간 구독 (관리자용) */
export function subscribeToAllStations(
  callback: (stationSummary: StationSummary[]) => void
): Unsubscribe {
  return onSnapshot(collection(db, 'cells'), (snapshot) => {
    const stationMap = new Map<string, { total: number; completed: number; hold: number; totalQty: number }>();

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const sid = data.stationId as string;
      const existing = stationMap.get(sid) || { total: 0, completed: 0, hold: 0, totalQty: 0 };
      existing.total += 1;
      if (data.status === 'completed') existing.completed += 1;
      if (data.status === 'hold' || data.status === 'replenish') existing.hold += 1;
      existing.totalQty += (data.totalQuantity as number) || 0;
      stationMap.set(sid, existing);
    }

    const summary: StationSummary[] = [];
    for (const [stationId, stats] of stationMap) {
      summary.push({ stationId, ...stats });
    }
    summary.sort((a, b) => a.stationId.localeCompare(b.stationId));
    callback(summary);
  });
}

export interface StationSummary {
  stationId: string;
  total: number;
  completed: number;
  hold: number;
  totalQty: number;
}

/** ========== 배치 초기화 ========== */

/** 스테이션의 모든 셀 초기화 (다음 배치 시작) */
export async function clearStationCells(stationId: string): Promise<void> {
  const q = query(collection(db, 'cells'), where('stationId', '==', stationId));
  const snapshot = await getDocs(q);

  /** 셀 삭제 + 운송장 마커 삭제 (450개씩 배치 분할) */
  const batchSize = 450;
  const allOps: { cellRef: ReturnType<typeof doc>; waybillNumber: string }[] = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    allOps.push({ cellRef: docSnap.ref, waybillNumber: data.waybillNumber });
  }

  for (let i = 0; i < allOps.length; i += batchSize) {
    const batch = writeBatch(db);
    const chunk = allOps.slice(i, i + batchSize);

    for (const op of chunk) {
      batch.delete(op.cellRef);
      if (op.waybillNumber) {
        batch.delete(doc(db, 'waybillLocks', op.waybillNumber));
      }
    }

    await batch.commit();
  }
}

/** ========== 검색 ========== */

/** 운송장번호로 검색 (크로스 스테이션) */
export async function searchByWaybill(waybillNumber: string): Promise<CellData | null> {
  const q = query(collection(db, 'cells'), where('waybillNumber', '==', waybillNumber));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as CellData;
}

/** 통합 검색 — 전체 셀에서 운송장/고객명/SKU 검색 (크로스 스테이션) */
export async function searchCells(keyword: string): Promise<CellData[]> {
  const snapshot = await getDocs(collection(db, 'cells'));
  const allCells = snapshot.docs.map((d) => d.data() as CellData);
  const lower = keyword.toLowerCase();

  return allCells.filter((cell) => {
    if (cell.waybillNumber?.toLowerCase().includes(lower)) return true;
    if (cell.customerName?.toLowerCase().includes(lower)) return true;
    if (cell.products?.some((p) =>
      p.productBarcode?.toLowerCase().includes(lower) ||
      p.productName?.toLowerCase().includes(lower)
    )) return true;
    return false;
  });
}

/** 셀 보충 대기(hold) 상태로 변경 */
export async function setCellHold(cellId: string): Promise<void> {
  const cellRef = doc(db, 'cells', cellId);
  await setDoc(cellRef, { status: 'hold' }, { merge: true });
}

/** 셀 hold 해제 → assigned로 복귀 */
export async function clearCellHold(cellId: string): Promise<void> {
  const cellRef = doc(db, 'cells', cellId);
  await setDoc(cellRef, { status: 'assigned' }, { merge: true });
}
