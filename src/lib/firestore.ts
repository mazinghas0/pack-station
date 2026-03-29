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

/** 운송장을 스캔하여 셀에 배정 */
export async function assignWaybillToCell(
  stationId: string,
  cellNumber: number,
  waybillNumber: string,
  uploadId: string
): Promise<{ success: boolean; error?: string; existingStation?: string; existingCell?: number }> {
  /** 1. 크로스 스테이션 중복 체크 */
  const duplicateCheck = query(
    collection(db, 'cells'),
    where('waybillNumber', '==', waybillNumber)
  );
  const duplicateSnap = await getDocs(duplicateCheck);

  if (!duplicateSnap.empty) {
    const existing = duplicateSnap.docs[0].data();
    return {
      success: false,
      error: `이미 등록된 운송장입니다`,
      existingStation: existing.stationId,
      existingCell: existing.cellNumber,
    };
  }

  /** 2. 업로드 데이터에서 해당 운송장의 주문 라인 조회 */
  const orderQuery = query(
    collection(db, 'orders'),
    where('uploadId', '==', uploadId),
    where('waybillNumber', '==', waybillNumber)
  );
  const orderSnap = await getDocs(orderQuery);

  /** 업로드 데이터에 없는 운송장 거부 */
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
  const customerName = orderSnap.docs.length > 0 ? orderSnap.docs[0].data().customerName : '';
  const deliveryMemo = orderSnap.docs.length > 0 ? orderSnap.docs[0].data().deliveryMemo : '';

  /** 3. 셀 문서 생성 */
  const cellId = `${stationId}_cell_${cellNumber}`;
  const cellRef = doc(db, 'cells', cellId);

  await setDoc(cellRef, {
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

  /** 4. 주문 상태 업데이트 */
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

  const batch = writeBatch(db);
  for (const docSnap of snapshot.docs) {
    batch.delete(docSnap.ref);
  }
  await batch.commit();
}

/** ========== 검색 ========== */

/** 운송장번호로 검색 (크로스 스테이션) */
export async function searchByWaybill(waybillNumber: string): Promise<CellData | null> {
  const q = query(collection(db, 'cells'), where('waybillNumber', '==', waybillNumber));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as CellData;
}
