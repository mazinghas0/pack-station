/** Pack Station 전체 타입 정의 */

/** 스테이션 설정 */
export interface Station {
  id: string;
  name: string;
  cellCount: number;
  colorZone: StationColorZone;
  status: StationStatus;
  currentBatchId: string | null;
  createdAt: number;
}

export type StationStatus = 'idle' | 'scanning' | 'picking' | 'packing' | 'completed';

export interface StationColorZone {
  primary: string;
  background: string;
  label: string;
}

/** 스테이션 색상 프리셋 (9색 랙 구역제) */
export const ZONE_COLORS: StationColorZone[] = [
  { primary: '#3B82F6', background: '#1E3A5F', label: '파랑' },
  { primary: '#10B981', background: '#1A3A2A', label: '초록' },
  { primary: '#F59E0B', background: '#3D2E0A', label: '주황' },
  { primary: '#8B5CF6', background: '#2D1B69', label: '보라' },
  { primary: '#EF4444', background: '#3B1212', label: '빨강' },
  { primary: '#06B6D4', background: '#0C2D35', label: '청록' },
  { primary: '#EC4899', background: '#3B0F26', label: '분홍' },
  { primary: '#84CC16', background: '#1E2F0A', label: '라임' },
  { primary: '#F97316', background: '#3B1A08', label: '주홍' },
];

/** 배치 (한 번에 처리하는 묶음) */
export interface Batch {
  id: string;
  uploadId: string;
  stationId: string;
  batchNumber: number;
  cellCount: number;
  status: BatchStatus;
  totalOrders: number;
  completedOrders: number;
  holdOrders: number;
  createdAt: number;
  completedAt: number | null;
}

export type BatchStatus = 'pending' | 'scanning' | 'picking' | 'packing' | 'completed';

/** 업로드된 엑셀 데이터 */
export interface Upload {
  id: string;
  fileName: string;
  uploadDate: string;
  totalOrders: number;
  totalQuantity: number;
  assignedOrders: number;
  status: UploadStatus;
  createdAt: number;
}

export type UploadStatus = 'uploaded' | 'assigning' | 'assigned' | 'in_progress' | 'completed';

/** 개별 주문 (엑셀 1행 = 1주문라인) */
export interface OrderLine {
  id: string;
  uploadId: string;
  batchId: string | null;
  stationId: string | null;
  cellNumber: number | null;
  waybillNumber: string;
  orderNumber: string;
  orderLineNumber: string;
  orderDate: string;
  customerName: string;
  invoiceNumber: string;
  productCode: string;
  productBarcode: string;
  productName: string;
  quantity: number;
  confirmedQuantity: number;
  status: OrderLineStatus;
  shopName: string;
  deliveryMemo: string;
  uploadFileName: string;
}

export type OrderLineStatus = 'pending' | 'assigned' | 'packed' | 'hold' | 'replenish';

/** 셀 (물리적 박스 위치) */
export interface Cell {
  id: string;
  batchId: string;
  stationId: string;
  cellNumber: number;
  waybillNumber: string | null;
  customerName: string | null;
  invoiceNumber: string | null;
  totalSkuCount: number;
  packedSkuCount: number;
  totalQuantity: number;
  packedQuantity: number;
  status: CellStatus;
  products: CellProduct[];
}

export type CellStatus = 'empty' | 'assigned' | 'packing' | 'completed' | 'hold' | 'replenish';

/** 셀에 들어갈 상품 정보 */
export interface CellProduct {
  productCode: string;
  productBarcode: string;
  productName: string;
  requiredQuantity: number;
  packedQuantity: number;
  status: 'pending' | 'packed' | 'replenish';
}

/** SKU 분배 정보 (피킹리스트용) */
export interface SkuDistribution {
  productCode: string;
  productBarcode: string;
  productName: string;
  totalQuantity: number;
  cellAllocations: CellAllocation[];
  status: 'pending' | 'distributed' | 'partial';
}

export interface CellAllocation {
  cellNumber: number;
  cellId: string;
  quantity: number;
  packed: boolean;
}

/** 피킹리스트 아이템 */
export interface PickingListItem {
  index: number;
  productCode: string;
  productBarcode: string;
  productName: string;
  totalQuantity: number;
  cellCount: number;
}

/** 검색 결과 */
export interface SearchResult {
  type: 'waybill' | 'customer' | 'product';
  stationId: string | null;
  stationName: string | null;
  cellNumber: number | null;
  batchNumber: number | null;
  detail: string;
  status: string;
}

/** 일일 리포트 */
export interface DailyReport {
  date: string;
  totalWaybills: number;
  totalQuantity: number;
  totalBatches: number;
  completedBatches: number;
  holdCount: number;
  replenishCount: number;
  stationStats: StationStat[];
  avgBatchTime: number;
}

export interface StationStat {
  stationId: string;
  stationName: string;
  processedBatches: number;
  processedOrders: number;
  processedQuantity: number;
  holdCount: number;
  avgBatchTimeMinutes: number;
}

/** 데일리 브리핑 */
export interface DailyBriefing {
  date: string;
  batches: {
    uploadId: string;
    fileName: string;
    uploadedAt: number;
    totalWaybills: number;
    totalQuantity: number;
    totalSku: number;
  }[];
  stations: {
    stationId: string;
    processedWaybills: number;
    totalQuantity: number;
    holdCount: number;
    firstScanAt: number | null;
    lastScanAt: number | null;
    workDurationMinutes: number | null;
  }[];
  totals: {
    waybills: number;
    quantity: number;
    batchCount: number;
  };
  createdAt: number;
}

/** 업로드 요약 (다회차 배차 목록용) */
export interface UploadSummary {
  id: string;
  fileName: string;
  totalOrders: number;
  totalQuantity: number;
  uniqueProducts: number;
  uniqueWaybills: number;
  status: string;
  createdAt: number;
}

/** 엑셀 파싱 결과 */
export interface ParsedExcelData {
  orders: ParsedOrder[];
  totalOrders: number;
  totalQuantity: number;
  uniqueWaybills: number;
  uniqueProducts: number;
  fileName: string;
}

export interface ParsedOrder {
  waybillNumber: string;
  orderNumber: string;
  orderLineNumber: string;
  orderDate: string;
  customerName: string;
  invoiceNumber: string;
  productCode: string;
  productBarcode: string;
  productName: string;
  quantity: number;
  confirmedQuantity: number;
  shopName: string;
  deliveryMemo: string;
  uploadFileName: string;
}

/** 엑셀 컬럼 매핑 */
export interface ColumnMapping {
  waybillNumber: string;
  orderNumber: string;
  orderLineNumber: string;
  orderDate: string;
  customerName: string;
  invoiceNumber: string;
  productCode: string;
  productBarcode: string;
  productName: string;
  quantity: string;
  confirmedQuantity: string;
  shopName: string;
  deliveryMemo: string;
  uploadFileName: string;
}

/** 기본 컬럼 매핑 (깨끗한나라몰 출고 엑셀 기준) */
export const DEFAULT_COLUMN_MAPPING: ColumnMapping = {
  waybillNumber: '송장번호',
  orderNumber: '고객사주문번호',
  orderLineNumber: '고객사주문라인번호',
  orderDate: '고객사주문일자',
  customerName: '배송처명',
  invoiceNumber: '송장번호',
  productCode: '상품코드',
  productBarcode: '바코드',
  productName: '상품명',
  quantity: '예정수량',
  confirmedQuantity: '확정수량',
  shopName: '쇼핑몰명',
  deliveryMemo: '배송메모',
  uploadFileName: '업로드파일명',
};
