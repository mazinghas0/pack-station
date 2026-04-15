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
  limit,
  deleteDoc,
  runTransaction,
  getCountFromServer,
  type Unsubscribe,
  type DocumentReference,
  type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import type { ParsedOrder, ParsedExcelData, UploadSummary, DailyBriefing } from './types';

/** ========== 셀 번호 유틸 ========== */

/** 정수 셀 번호(1-108)를 랙 레이블(R01-01 형식)로 변환 */
export function cellNumberToLabel(n: number): string {
  const rack = Math.ceil(n / 9);
  const pos = ((n - 1) % 9) + 1;
  return `R${String(rack).padStart(2, '0')}-${String(pos).padStart(2, '0')}`;
}

/** 총 셀 수 (12랙 × 9셀) */
export const TOTAL_CELLS = 99;

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

  /** 저장 완료 후 자동으로 활성 배차로 지정 */
  await setActiveUpload(uploadId, data.fileName);

  return uploadId;
}

/** 최신 업로드 조회 (하위 호환 유지) */
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

/** 활성 배차 지정 */
export async function setActiveUpload(uploadId: string, fileName: string): Promise<void> {
  const configRef = doc(db, 'config', 'activeUpload');
  await setDoc(configRef, { uploadId, fileName, activatedAt: serverTimestamp() });
}

/** 활성 배차 조회 (스테이션 + 관리자 공통 사용) */
export async function getActiveUpload(): Promise<{ id: string; fileName: string; totalOrders: number; totalQuantity: number; uniqueProducts: number; uniqueWaybills: number; status: string } | null> {
  const configRef = doc(db, 'config', 'activeUpload');
  const configSnap = await getDoc(configRef);
  if (!configSnap.exists()) return null;

  const { uploadId } = configSnap.data();
  const uploadSnap = await getDoc(doc(db, 'uploads', uploadId));
  if (!uploadSnap.exists()) return null;

  const d = uploadSnap.data();
  return {
    id: d.id,
    fileName: d.fileName,
    totalOrders: d.totalOrders,
    totalQuantity: d.totalQuantity,
    uniqueProducts: d.uniqueProducts,
    uniqueWaybills: d.uniqueWaybills,
    status: d.status,
  };
}

/** 최근 업로드 목록 조회 (최대 30건) */
export async function getRecentUploads(): Promise<UploadSummary[]> {
  const q = query(collection(db, 'uploads'), orderBy('createdAt', 'desc'), limit(30));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: data.id,
      fileName: data.fileName,
      totalOrders: data.totalOrders,
      totalQuantity: data.totalQuantity,
      uniqueProducts: data.uniqueProducts,
      uniqueWaybills: data.uniqueWaybills,
      status: data.status,
      createdAt: data.createdAt?.toMillis?.() ?? 0,
    };
  });
}

/** ========== 운송장 스캔 (셀 배정) ========== */

interface AssignProduct {
  productCode: string;
  productBarcode: string;
  productName: string;
  requiredQuantity: number;
  packedQuantity: number;
  status: 'pending';
}

interface AssignAtomicParams {
  stationId: string;
  uploadId: string;
  cellNumber: number;
  waybillNumber: string;
  customerName: string;
  deliveryMemo: string;
  products: AssignProduct[];
  totalSkuCount: number;
  totalQuantity: number;
  orderRefs: DocumentReference<DocumentData>[];
}

/**
 * 운송장 1건을 셀에 원자적으로 배정 (수동·자동 공용).
 * 한 트랜잭션 내부에서 cells + waybillLocks 생성 + orders 상태 업데이트까지 수행.
 * 충돌 시 CELL_EXISTS / DUPLICATE:{stationId}:{cellNumber} 에러를 throw.
 */
async function assignWaybillAtomic(params: AssignAtomicParams): Promise<void> {
  const cellId = `${params.stationId}_cell_${params.cellNumber}`;
  const cellRef = doc(db, 'cells', cellId);
  const waybillLockRef = doc(db, 'waybillLocks', `${params.uploadId}_${params.waybillNumber}`);

  await runTransaction(db, async (tx) => {
    const cellSnap = await tx.get(cellRef);
    if (cellSnap.exists()) {
      throw new Error('CELL_EXISTS');
    }

    const lockSnap = await tx.get(waybillLockRef);
    if (lockSnap.exists()) {
      const lockData = lockSnap.data();
      throw new Error(`DUPLICATE:${lockData.stationId}:${lockData.cellNumber}`);
    }

    tx.set(waybillLockRef, {
      stationId: params.stationId,
      cellNumber: params.cellNumber,
      createdAt: serverTimestamp(),
    });

    tx.set(cellRef, {
      id: cellId,
      stationId: params.stationId,
      cellNumber: params.cellNumber,
      waybillNumber: params.waybillNumber,
      customerName: params.customerName,
      deliveryMemo: params.deliveryMemo,
      uploadId: params.uploadId,
      totalSkuCount: params.totalSkuCount,
      packedSkuCount: 0,
      totalQuantity: params.totalQuantity,
      packedQuantity: 0,
      status: 'assigned',
      products: params.products,
      createdAt: serverTimestamp(),
    });

    for (const ref of params.orderRefs) {
      tx.update(ref, {
        stationId: params.stationId,
        cellNumber: params.cellNumber,
        status: 'assigned',
      });
    }
  });
}

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

  /** 2. 셀 생성 + 락 등록 + 주문 상태 업데이트를 단일 트랜잭션으로 처리 */
  try {
    await assignWaybillAtomic({
      stationId,
      uploadId,
      cellNumber,
      waybillNumber,
      customerName,
      deliveryMemo,
      products,
      totalSkuCount,
      totalQuantity,
      orderRefs: orderSnap.docs.map((d) => d.ref),
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

  return { success: true };
}

/** ========== 자동 배차 ========== */

/**
 * 업로드된 데이터에서 미배차 운송장을 지정 수만큼 스테이션에 자동으로 셀 배정.
 * 수동 스캔(assignWaybillToCell)과 동일한 assignWaybillAtomic 헬퍼를 재사용하므로
 * 운송장당 단일 트랜잭션으로 원자성이 보장된다. 셀 번호 충돌 시 다음 빈 번호로 재시도.
 */
export async function autoAssignToStation(
  uploadId: string,
  stationId: string,
  count: number
): Promise<{ assigned: number; alreadyAssigned: number; skipped: number }> {
  /** 1. 미배차(pending) 주문 조회 */
  const pendingSnap = await getDocs(
    query(
      collection(db, 'orders'),
      where('uploadId', '==', uploadId),
      where('status', '==', 'pending')
    )
  );

  /** 2. 운송장번호 기준으로 그룹핑 */
  const waybillMap = new Map<string, Array<{ ref: DocumentReference<DocumentData>; data: Record<string, unknown> }>>();
  for (const d of pendingSnap.docs) {
    const wn = d.data().waybillNumber as string;
    if (!waybillMap.has(wn)) waybillMap.set(wn, []);
    waybillMap.get(wn)!.push({ ref: d.ref, data: d.data() as Record<string, unknown> });
  }

  const targetWaybills = Array.from(waybillMap.entries()).slice(0, count);
  const alreadyAssigned = Math.max(0, waybillMap.size - targetWaybills.length);

  if (targetWaybills.length === 0) return { assigned: 0, alreadyAssigned, skipped: 0 };

  /** 3. 현재 스테이션의 기존 셀 번호 조회 → 빈 번호 탐색 seed */
  const existingCellsSnap = await getDocs(
    query(
      collection(db, 'cells'),
      where('stationId', '==', stationId),
      where('uploadId', '==', uploadId)
    )
  );
  const usedCells = new Set(existingCellsSnap.docs.map((d) => d.data().cellNumber as number));

  const pickNextCell = (): number | null => {
    for (let n = 1; n <= TOTAL_CELLS; n++) {
      if (!usedCells.has(n)) return n;
    }
    return null;
  };

  /** 4. 운송장 단위로 트랜잭션 배정. 충돌 시 다음 셀 번호로 재시도. */
  let assigned = 0;
  let skipped = 0;

  for (const [waybillNumber, orderDocs] of targetWaybills) {
    const products: AssignProduct[] = orderDocs.map((o) => ({
      productCode: o.data.productCode as string,
      productBarcode: o.data.productBarcode as string,
      productName: o.data.productName as string,
      requiredQuantity: (o.data.confirmedQuantity as number) || (o.data.quantity as number),
      packedQuantity: 0,
      status: 'pending',
    }));
    const totalQuantity = products.reduce((s, p) => s + p.requiredQuantity, 0);
    const customerName = (orderDocs[0].data.customerName as string) || '';
    const deliveryMemo = (orderDocs[0].data.deliveryMemo as string) || '';
    const orderRefs = orderDocs.map((o) => o.ref);

    let success = false;
    /** 셀 번호 충돌 시 다음 빈 번호로 재시도 (최대 TOTAL_CELLS번) */
    for (let attempt = 0; attempt < TOTAL_CELLS; attempt++) {
      const cellNumber = pickNextCell();
      if (cellNumber === null) break;

      try {
        await assignWaybillAtomic({
          stationId,
          uploadId,
          cellNumber,
          waybillNumber,
          customerName,
          deliveryMemo,
          products,
          totalSkuCount: products.length,
          totalQuantity,
          orderRefs,
        });
        usedCells.add(cellNumber);
        assigned++;
        success = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'CELL_EXISTS') {
          /** 다른 프로세스가 선점 — 해당 번호 used 처리 후 다음 번호로 재시도 */
          usedCells.add(cellNumber);
          continue;
        }
        if (msg.startsWith('DUPLICATE:')) {
          /** 운송장이 이미 다른 곳에 락 걸림 — 이 운송장 스킵 */
          skipped++;
          success = true;
          break;
        }
        throw err;
      }
    }

    /** 셀이 가득 찼으면 루프 종료 */
    if (!success && pickNextCell() === null) break;
  }

  return { assigned, alreadyAssigned, skipped };
}

/** ========== 실시간 리스너 ========== */

/** 스테이션의 셀 목록 실시간 구독 */
export function subscribeToCells(
  stationId: string,
  uploadId: string,
  callback: (cells: CellData[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cells'),
    where('stationId', '==', stationId),
    where('uploadId', '==', uploadId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const cells: CellData[] = snapshot.docs.map((d) => d.data() as CellData);
      cells.sort((a, b) => a.cellNumber - b.cellNumber);
      callback(cells);
    },
    (err) => onError?.(err),
  );
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

/** 전체 스테이션 현황 실시간 구독 (관리자용 — 활성 배차 기준으로만 집계) */
export function subscribeToAllStations(
  uploadId: string,
  callback: (stationSummary: StationSummary[]) => void
): Unsubscribe {
  const q = query(collection(db, 'cells'), where('uploadId', '==', uploadId));
  return onSnapshot(q, (snapshot) => {
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

/** ========== 스테이션별 배차 관리 ========== */

/** 스테이션이 현재 작업 중인 uploadId 저장 */
export async function setStationUpload(stationId: string, uploadId: string): Promise<void> {
  await setDoc(doc(db, 'stations', stationId), { currentUploadId: uploadId }, { merge: true });
}

/** 스테이션이 현재 작업 중인 uploadId 조회 */
export async function getStationUpload(stationId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'stations', stationId));
  if (!snap.exists()) return null;
  return (snap.data().currentUploadId as string) ?? null;
}

/** ========== 배치 초기화 ========== */

/** 스테이션의 모든 셀 초기화 (다음 배치 시작) */
/** SKU 바코드 기준으로 해당 셀들의 패킹 완료 처리 */
export async function completeSkuForCells(
  stationId: string,
  cellNumbers: number[],
  productBarcode: string,
  currentCells: CellData[]
): Promise<void> {
  const batch = writeBatch(db);

  for (const cellNumber of cellNumbers) {
    const cell = currentCells.find((c) => c.cellNumber === cellNumber);
    if (!cell) continue;

    const updatedProducts = cell.products.map((p) =>
      p.productBarcode === productBarcode
        ? { ...p, packedQuantity: p.requiredQuantity, status: 'completed' }
        : p
    );

    const packedSkuCount = updatedProducts.filter((p) => p.packedQuantity >= p.requiredQuantity).length;
    const packedQuantity = updatedProducts.reduce((sum, p) => sum + p.packedQuantity, 0);
    const allComplete = packedSkuCount === updatedProducts.length;

    const cellRef = doc(db, 'cells', `${stationId}_cell_${cellNumber}`);
    batch.update(cellRef, {
      products: updatedProducts,
      packedSkuCount,
      packedQuantity,
      status: allComplete ? 'completed' : 'packing',
    });
  }

  await batch.commit();
}

export async function clearStationCells(stationId: string): Promise<void> {
  const q = query(collection(db, 'cells'), where('stationId', '==', stationId));
  const snapshot = await getDocs(q);

  /** 셀 삭제 + 운송장 마커 삭제 (450개씩 배치 분할) */
  const batchSize = 450;
  const allOps: { cellRef: DocumentReference<DocumentData>; waybillNumber: string; uploadId: string | null }[] = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    allOps.push({
      cellRef: docSnap.ref,
      waybillNumber: data.waybillNumber as string,
      uploadId: (data.uploadId as string) ?? null,
    });
  }

  for (let i = 0; i < allOps.length; i += batchSize) {
    const batch = writeBatch(db);
    const chunk = allOps.slice(i, i + batchSize);

    for (const op of chunk) {
      batch.delete(op.cellRef);
      if (op.waybillNumber) {
        /** 신규: 배차+운송장 복합키 / 구버전 데이터: 운송장 단독 키 (호환) */
        const lockKey = op.uploadId
          ? `${op.uploadId}_${op.waybillNumber}`
          : op.waybillNumber;
        batch.delete(doc(db, 'waybillLocks', lockKey));
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

/** 통합 검색 — 운송장/고객명은 인덱스 프리픽스 쿼리, 상품은 결과 없을 때만 전체 스캔 */
export async function searchCells(keyword: string): Promise<CellData[]> {
  const end = keyword + '\uf8ff';

  const [waybillSnap, customerSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'cells'),
      where('waybillNumber', '>=', keyword),
      where('waybillNumber', '<=', end),
    )),
    getDocs(query(
      collection(db, 'cells'),
      where('customerName', '>=', keyword),
      where('customerName', '<=', end),
    )),
  ]);

  const seen = new Set<string>();
  const results: CellData[] = [];

  for (const snap of [waybillSnap, customerSnap]) {
    for (const d of snap.docs) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        results.push(d.data() as CellData);
      }
    }
  }

  if (results.length > 0) return results;

  // 운송장·고객명 결과 없을 때만 상품 바코드/이름 전체 스캔 (fallback)
  const lower = keyword.toLowerCase();
  const allSnap = await getDocs(collection(db, 'cells'));
  return allSnap.docs
    .map((d) => d.data() as CellData)
    .filter((cell) =>
      cell.products?.some(
        (p) =>
          p.productBarcode?.toLowerCase().includes(lower) ||
          p.productName?.toLowerCase().includes(lower),
      ),
    );
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

/** ========== 데일리 브리핑 ========== */

/**
 * 오늘 마감 처리:
 * 1. 현재 날짜 기준 모든 업로드의 cells 집계
 * 2. dailyReports/{date} 저장
 * 3. cells + orders + uploads 삭제 (데이터 정리)
 */
export async function generateDailyBriefing(date: string): Promise<DailyBriefing> {
  /** 오늘 날짜의 모든 업로드 조회 */
  const uploadsSnap = await getDocs(query(collection(db, 'uploads'), orderBy('createdAt', 'asc')));
  const uploads = uploadsSnap.docs.map((d) => d.data());

  /** 전체 cells 조회 (스테이션별 집계용) */
  const cellsSnap = await getDocs(collection(db, 'cells'));
  const allCells = cellsSnap.docs.map((d) => d.data());

  /** 배차별 요약 */
  const batches: DailyBriefing['batches'] = uploads.map((u) => ({
    uploadId: u.id as string,
    fileName: u.fileName as string,
    uploadedAt: u.createdAt?.toMillis?.() ?? 0,
    totalWaybills: u.uniqueWaybills as number,
    totalQuantity: u.totalQuantity as number,
    totalSku: u.uniqueProducts as number,
  }));

  /** 스테이션별 집계 */
  const stationMap = new Map<string, {
    waybills: number;
    quantity: number;
    hold: number;
    firstScanAt: number | null;
    lastScanAt: number | null;
  }>();

  for (const cell of allCells) {
    const sid = cell.stationId as string;
    const entry = stationMap.get(sid) ?? { waybills: 0, quantity: 0, hold: 0, firstScanAt: null, lastScanAt: null };
    entry.waybills += 1;
    entry.quantity += (cell.totalQuantity as number) || 0;
    if (cell.status === 'hold' || cell.status === 'replenish') entry.hold += 1;

    const scanTime: number = cell.createdAt?.toMillis?.() ?? 0;
    if (scanTime > 0) {
      if (entry.firstScanAt === null || scanTime < entry.firstScanAt) entry.firstScanAt = scanTime;
      if (entry.lastScanAt === null || scanTime > entry.lastScanAt) entry.lastScanAt = scanTime;
    }
    stationMap.set(sid, entry);
  }

  const stations: DailyBriefing['stations'] = [];
  for (const [stationId, s] of stationMap) {
    const durationMinutes =
      s.firstScanAt && s.lastScanAt
        ? Math.round((s.lastScanAt - s.firstScanAt) / 60000)
        : null;
    stations.push({
      stationId,
      processedWaybills: s.waybills,
      totalQuantity: s.quantity,
      holdCount: s.hold,
      firstScanAt: s.firstScanAt,
      lastScanAt: s.lastScanAt,
      workDurationMinutes: durationMinutes,
    });
  }
  stations.sort((a, b) => a.stationId.localeCompare(b.stationId));

  const totals: DailyBriefing['totals'] = {
    waybills: batches.reduce((s, b) => s + b.totalWaybills, 0),
    quantity: batches.reduce((s, b) => s + b.totalQuantity, 0),
    batchCount: batches.length,
  };

  const briefing: DailyBriefing = {
    date,
    batches,
    stations,
    totals,
    createdAt: Date.now(),
  };

  /** dailyReports/{date} 저장 (영구 보관) */
  await setDoc(doc(db, 'dailyReports', date), briefing);

  /** cells + waybillLocks 일괄 삭제 */
  const batchSize = 450;
  const cellOps = cellsSnap.docs.map((d) => ({
    ref: d.ref,
    waybillNumber: d.data().waybillNumber as string,
    uploadId: d.data().uploadId as string | null,
  }));
  for (let i = 0; i < cellOps.length; i += batchSize) {
    const wb = writeBatch(db);
    for (const op of cellOps.slice(i, i + batchSize)) {
      wb.delete(op.ref);
      if (op.waybillNumber) {
        const lockKey = op.uploadId ? `${op.uploadId}_${op.waybillNumber}` : op.waybillNumber;
        wb.delete(doc(db, 'waybillLocks', lockKey));
      }
    }
    await wb.commit();
  }

  /** orders 일괄 삭제 */
  const ordersSnap = await getDocs(collection(db, 'orders'));
  for (let i = 0; i < ordersSnap.docs.length; i += batchSize) {
    const wb = writeBatch(db);
    for (const d of ordersSnap.docs.slice(i, i + batchSize)) wb.delete(d.ref);
    await wb.commit();
  }

  /** uploads 일괄 삭제 */
  for (let i = 0; i < uploadsSnap.docs.length; i += batchSize) {
    const wb = writeBatch(db);
    for (const d of uploadsSnap.docs.slice(i, i + batchSize)) wb.delete(d.ref);
    await wb.commit();
  }

  /** config/activeUpload 초기화 */
  await deleteDoc(doc(db, 'config', 'activeUpload'));

  return briefing;
}

/** 최근 브리핑 목록 조회 (최대 30일) */
export async function getDailyBriefings(): Promise<DailyBriefing[]> {
  const q = query(collection(db, 'dailyReports'), orderBy('createdAt', 'desc'), limit(30));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as DailyBriefing);
}

/** 업로드 참조 정리 — config/activeUpload + stations.currentUploadId 에서 해당 uploadId 제거 */
async function purgeUploadRefs(uploadId: string): Promise<void> {
  const configRef = doc(db, 'config', 'activeUpload');
  const configSnap = await getDoc(configRef);
  if (configSnap.exists() && configSnap.data().uploadId === uploadId) {
    await deleteDoc(configRef);
  }

  const stationsSnap = await getDocs(
    query(collection(db, 'stations'), where('currentUploadId', '==', uploadId))
  );
  if (!stationsSnap.empty) {
    const wb = writeBatch(db);
    for (const d of stationsSnap.docs) {
      wb.set(d.ref, { currentUploadId: null }, { merge: true });
    }
    await wb.commit();
  }
}

/** 특정 배차 데이터 삭제 (마스터 전용 수동 삭제) — cells + waybillLocks + orders + upload + 참조 정리 */
export async function deleteUploadBatch(uploadId: string): Promise<void> {
  const batchSize = 450;

  const cellsSnap = await getDocs(
    query(collection(db, 'cells'), where('uploadId', '==', uploadId))
  );
  for (let i = 0; i < cellsSnap.docs.length; i += batchSize) {
    const wb = writeBatch(db);
    for (const d of cellsSnap.docs.slice(i, i + batchSize)) {
      wb.delete(d.ref);
      const waybill = d.data().waybillNumber as string | undefined;
      if (waybill) {
        wb.delete(doc(db, 'waybillLocks', `${uploadId}_${waybill}`));
      }
    }
    await wb.commit();
  }

  const ordersSnap = await getDocs(
    query(collection(db, 'orders'), where('uploadId', '==', uploadId))
  );
  for (let i = 0; i < ordersSnap.docs.length; i += batchSize) {
    const wb = writeBatch(db);
    for (const d of ordersSnap.docs.slice(i, i + batchSize)) wb.delete(d.ref);
    await wb.commit();
  }

  await deleteDoc(doc(db, 'uploads', uploadId));
  await purgeUploadRefs(uploadId);
}

/** 선택 배차 정산 — 선택된 uploadIds만 집계하여 dailyReports/{date}에 append, 이후 원본 삭제 */
export async function settleUploadBatches(uploadIds: string[], date: string): Promise<DailyBriefing> {
  if (uploadIds.length === 0) {
    throw new Error('정산할 배차가 없습니다');
  }

  /** 1. 선택 업로드 문서 조회 */
  const uploadDocs = await Promise.all(
    uploadIds.map((id) => getDoc(doc(db, 'uploads', id)))
  );
  const uploads = uploadDocs.filter((s) => s.exists()).map((s) => s.data());

  /** 2. 해당 업로드의 cells 조회 (Firestore `in` 쿼리는 최대 30개 — 분할) */
  const cellsChunks: Record<string, unknown>[] = [];
  const chunkSize = 30;
  for (let i = 0; i < uploadIds.length; i += chunkSize) {
    const chunk = uploadIds.slice(i, i + chunkSize);
    const snap = await getDocs(
      query(collection(db, 'cells'), where('uploadId', 'in', chunk))
    );
    for (const d of snap.docs) cellsChunks.push(d.data());
  }

  /** 3. 배차별 요약 */
  const newBatches: DailyBriefing['batches'] = uploads.map((u) => ({
    uploadId: u.id as string,
    fileName: u.fileName as string,
    uploadedAt: u.createdAt?.toMillis?.() ?? 0,
    totalWaybills: u.uniqueWaybills as number,
    totalQuantity: u.totalQuantity as number,
    totalSku: u.uniqueProducts as number,
  }));

  /** 4. 스테이션별 집계 */
  const stationMap = new Map<string, {
    waybills: number;
    quantity: number;
    hold: number;
    firstScanAt: number | null;
    lastScanAt: number | null;
  }>();

  for (const cell of cellsChunks) {
    const sid = cell.stationId as string;
    const entry = stationMap.get(sid) ?? { waybills: 0, quantity: 0, hold: 0, firstScanAt: null, lastScanAt: null };
    entry.waybills += 1;
    entry.quantity += (cell.totalQuantity as number) || 0;
    if (cell.status === 'hold' || cell.status === 'replenish') entry.hold += 1;

    const scanTimeRaw = cell.createdAt as { toMillis?: () => number } | undefined;
    const scanTime = scanTimeRaw?.toMillis?.() ?? 0;
    if (scanTime > 0) {
      if (entry.firstScanAt === null || scanTime < entry.firstScanAt) entry.firstScanAt = scanTime;
      if (entry.lastScanAt === null || scanTime > entry.lastScanAt) entry.lastScanAt = scanTime;
    }
    stationMap.set(sid, entry);
  }

  const newStations: DailyBriefing['stations'] = [];
  for (const [stationId, s] of stationMap) {
    const durationMinutes =
      s.firstScanAt && s.lastScanAt
        ? Math.round((s.lastScanAt - s.firstScanAt) / 60000)
        : null;
    newStations.push({
      stationId,
      processedWaybills: s.waybills,
      totalQuantity: s.quantity,
      holdCount: s.hold,
      firstScanAt: s.firstScanAt,
      lastScanAt: s.lastScanAt,
      workDurationMinutes: durationMinutes,
    });
  }

  /** 5. 기존 dailyReports/{date} 병합 (중복 uploadId 제외) */
  const reportRef = doc(db, 'dailyReports', date);
  const existingSnap = await getDoc(reportRef);
  const existing = existingSnap.exists() ? (existingSnap.data() as DailyBriefing) : null;

  const existingIds = new Set((existing?.batches ?? []).map((b) => b.uploadId));
  const mergedBatches = [
    ...(existing?.batches ?? []),
    ...newBatches.filter((b) => !existingIds.has(b.uploadId)),
  ];

  const mergedStationMap = new Map<string, DailyBriefing['stations'][number]>();
  for (const s of existing?.stations ?? []) mergedStationMap.set(s.stationId, s);
  for (const s of newStations) {
    const prev = mergedStationMap.get(s.stationId);
    if (!prev) {
      mergedStationMap.set(s.stationId, s);
      continue;
    }
    mergedStationMap.set(s.stationId, {
      stationId: s.stationId,
      processedWaybills: prev.processedWaybills + s.processedWaybills,
      totalQuantity: prev.totalQuantity + s.totalQuantity,
      holdCount: prev.holdCount + s.holdCount,
      firstScanAt: prev.firstScanAt && s.firstScanAt
        ? Math.min(prev.firstScanAt, s.firstScanAt)
        : prev.firstScanAt ?? s.firstScanAt,
      lastScanAt: prev.lastScanAt && s.lastScanAt
        ? Math.max(prev.lastScanAt, s.lastScanAt)
        : prev.lastScanAt ?? s.lastScanAt,
      workDurationMinutes: null,
    });
  }
  const mergedStations = Array.from(mergedStationMap.values())
    .map((s) => ({
      ...s,
      workDurationMinutes:
        s.firstScanAt && s.lastScanAt
          ? Math.round((s.lastScanAt - s.firstScanAt) / 60000)
          : null,
    }))
    .sort((a, b) => a.stationId.localeCompare(b.stationId));

  const mergedTotals: DailyBriefing['totals'] = {
    waybills: mergedBatches.reduce((s, b) => s + b.totalWaybills, 0),
    quantity: mergedBatches.reduce((s, b) => s + b.totalQuantity, 0),
    batchCount: mergedBatches.length,
  };

  const briefing: DailyBriefing = {
    date,
    batches: mergedBatches,
    stations: mergedStations,
    totals: mergedTotals,
    createdAt: Date.now(),
  };

  await setDoc(reportRef, briefing);

  /** 6. 선택 배차만 원본 삭제 (참조 정리 포함) */
  for (const id of uploadIds) {
    await deleteUploadBatch(id);
  }

  return briefing;
}

/** 30일 초과 데일리 브리핑 자동 삭제 */
export async function cleanupOldDailyReports(): Promise<void> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const snap = await getDocs(query(collection(db, 'dailyReports'), orderBy('createdAt', 'asc')));
  const old = snap.docs.filter((d) => (d.data().createdAt as number) < cutoff);
  if (old.length === 0) return;
  const wb = writeBatch(db);
  for (const d of old) wb.delete(d.ref);
  await wb.commit();
}

/** Firestore 데이터 현황 (카운트만, 빠른 집계 쿼리 사용) */
export async function getDataStats(): Promise<{ cells: number; orders: number; uploads: number; oldestReport: string | null }> {
  const [cellsCount, ordersCount, uploadsCount, reportsSnap] = await Promise.all([
    getCountFromServer(collection(db, 'cells')),
    getCountFromServer(collection(db, 'orders')),
    getCountFromServer(collection(db, 'uploads')),
    getDocs(query(collection(db, 'dailyReports'), orderBy('createdAt', 'desc'), limit(1))),
  ]);

  const lastReport = reportsSnap.docs[0]?.data().date as string | undefined;

  return {
    cells: cellsCount.data().count,
    orders: ordersCount.data().count,
    uploads: uploadsCount.data().count,
    oldestReport: lastReport ?? null,
  };
}
