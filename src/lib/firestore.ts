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
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { ParsedOrder, ParsedExcelData, UploadSummary, DailyBriefing } from './types';

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

/** 최근 업로드 목록 조회 (최대 10건) */
export async function getRecentUploads(): Promise<UploadSummary[]> {
  const q = query(collection(db, 'uploads'), orderBy('createdAt', 'desc'), limit(10));
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
  /** 중복 체크용 마커 문서 (배차+운송장번호 기준 — 다회차 업로드 충돌 방지) */
  const waybillLockRef = doc(db, 'waybillLocks', `${uploadId}_${waybillNumber}`);

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

/** ========== 자동 배차 ========== */

/**
 * 업로드된 데이터에서 미배차 운송장을 지정 수만큼 스테이션에 자동으로 셀 배정.
 * 관리자 사전 배치 및 개발 테스트 용도. 스캔 로직(assignWaybillToCell)과 동일한
 * waybillLocks 패턴을 사용해 중복 배정이 원천 차단됨.
 */
export async function autoAssignToStation(
  uploadId: string,
  stationId: string,
  count: number
): Promise<{ assigned: number; alreadyAssigned: number }> {
  /** 1. 미배차(pending) 주문 전체 조회 */
  const pendingSnap = await getDocs(
    query(
      collection(db, 'orders'),
      where('uploadId', '==', uploadId),
      where('status', '==', 'pending')
    )
  );

  /** 2. 운송장번호 기준으로 그룹핑 */
  const waybillMap = new Map<string, Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }>>();
  for (const d of pendingSnap.docs) {
    const wn = d.data().waybillNumber as string;
    if (!waybillMap.has(wn)) waybillMap.set(wn, []);
    waybillMap.get(wn)!.push({ ref: d.ref, data: d.data() as Record<string, unknown> });
  }

  const targetWaybills = Array.from(waybillMap.entries()).slice(0, count);
  const alreadyAssigned = Math.max(0, waybillMap.size - targetWaybills.length);

  if (targetWaybills.length === 0) return { assigned: 0, alreadyAssigned };

  /** 3. 현재 스테이션의 기존 셀 번호 확인 → 다음 빈 번호 결정 */
  const existingCellsSnap = await getDocs(
    query(
      collection(db, 'cells'),
      where('stationId', '==', stationId),
      where('uploadId', '==', uploadId)
    )
  );
  const usedCells = new Set(existingCellsSnap.docs.map((d) => d.data().cellNumber as number));

  let nextCell = 1;
  const pickNextCell = (): number => {
    while (usedCells.has(nextCell)) nextCell++;
    usedCells.add(nextCell);
    return nextCell++;
  };

  /** 4. 셀/락/주문 업데이트 작업 목록 빌드 */
  type WriteOp = { ref: ReturnType<typeof doc>; data: Record<string, unknown>; type: 'set' | 'update' };
  const ops: WriteOp[] = [];

  for (const [waybillNumber, orderDocs] of targetWaybills) {
    const cellNumber = pickNextCell();
    const cellId = `${stationId}_cell_${cellNumber}`;

    const products = orderDocs.map((o) => ({
      productCode: o.data.productCode as string,
      productBarcode: o.data.productBarcode as string,
      productName: o.data.productName as string,
      requiredQuantity: (o.data.confirmedQuantity as number) || (o.data.quantity as number),
      packedQuantity: 0,
      status: 'pending' as const,
    }));
    const totalQuantity = products.reduce((s, p) => s + p.requiredQuantity, 0);

    ops.push({
      ref: doc(db, 'cells', cellId),
      type: 'set',
      data: {
        id: cellId,
        stationId,
        cellNumber,
        waybillNumber,
        customerName: (orderDocs[0].data.customerName as string) || '',
        deliveryMemo: (orderDocs[0].data.deliveryMemo as string) || '',
        uploadId,
        totalSkuCount: products.length,
        packedSkuCount: 0,
        totalQuantity,
        packedQuantity: 0,
        status: 'assigned',
        products,
        createdAt: serverTimestamp(),
      },
    });

    ops.push({
      ref: doc(db, 'waybillLocks', `${uploadId}_${waybillNumber}`),
      type: 'set',
      data: { stationId, cellNumber, createdAt: serverTimestamp() },
    });

    for (const o of orderDocs) {
      ops.push({
        ref: o.ref as ReturnType<typeof doc>,
        type: 'update',
        data: { stationId, cellNumber, status: 'assigned' },
      });
    }
  }

  /** 5. Firestore writeBatch 450개 제한에 맞게 분할 커밋 */
  const batchSize = 450;
  for (let i = 0; i < ops.length; i += batchSize) {
    const wb = writeBatch(db);
    for (const op of ops.slice(i, i + batchSize)) {
      if (op.type === 'set') wb.set(op.ref, op.data);
      else wb.update(op.ref, op.data);
    }
    await wb.commit();
  }

  return { assigned: targetWaybills.length, alreadyAssigned };
}

/** ========== 실시간 리스너 ========== */

/** 스테이션의 셀 목록 실시간 구독 */
export function subscribeToCells(
  stationId: string,
  uploadId: string,
  callback: (cells: CellData[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cells'),
    where('stationId', '==', stationId),
    where('uploadId', '==', uploadId)
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
export async function clearStationCells(stationId: string): Promise<void> {
  const q = query(collection(db, 'cells'), where('stationId', '==', stationId));
  const snapshot = await getDocs(q);

  /** 셀 삭제 + 운송장 마커 삭제 (450개씩 배치 분할) */
  const batchSize = 450;
  const allOps: { cellRef: ReturnType<typeof doc>; waybillNumber: string; uploadId: string | null }[] = [];

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

/** 24시간 지난 업로드 자동 정리 (admin 진입 시 백그라운드 실행) */
export async function cleanupExpiredUploads(): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const q = query(collection(db, 'uploads'), orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);

  const expired = snap.docs.filter((d) => {
    const ms: number = d.data().createdAt?.toMillis?.() ?? 0;
    return ms > 0 && ms < cutoff;
  });

  if (expired.length === 0) return;

  const batchSize = 450;
  for (const uploadDoc of expired) {
    const uploadId = uploadDoc.data().id as string;

    /** 해당 uploadId의 orders 삭제 */
    const ordersSnap = await getDocs(
      query(collection(db, 'orders'), where('uploadId', '==', uploadId))
    );
    for (let i = 0; i < ordersSnap.docs.length; i += batchSize) {
      const wb = writeBatch(db);
      for (const d of ordersSnap.docs.slice(i, i + batchSize)) wb.delete(d.ref);
      await wb.commit();
    }

    /** upload 문서 삭제 */
    await deleteDoc(uploadDoc.ref);
  }
}
