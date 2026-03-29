import * as XLSX from 'xlsx';
import {
  type ParsedExcelData,
  type ParsedOrder,
  type ColumnMapping,
  DEFAULT_COLUMN_MAPPING,
} from './types';

/** 엑셀 파일 파싱 (암호화 해제 포함) */
export function parseExcelBuffer(
  buffer: ArrayBuffer,
  password?: string,
  customMapping?: Partial<ColumnMapping>
): ParsedExcelData {
  const mapping = { ...DEFAULT_COLUMN_MAPPING, ...customMapping };

  /** 암호화된 엑셀 읽기 시도 */
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'array',
      password: password || 'skw',
      codepage: 949,
    });
  } catch {
    /** 비밀번호 없이 재시도 */
    workbook = XLSX.read(buffer, {
      type: 'array',
      codepage: 949,
    });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rawData.length === 0) {
    throw new Error('엑셀 파일에 데이터가 없습니다.');
  }

  /** 헤더 자동 인식: 실제 컬럼명과 매핑 컬럼명을 매칭 */
  const headers = Object.keys(rawData[0]);
  const resolvedMapping = resolveColumnMapping(headers, mapping);

  /** 주문 데이터 파싱 */
  const orders: ParsedOrder[] = rawData.map((row) => ({
    waybillNumber: String(row[resolvedMapping.waybillNumber] || '').trim(),
    orderNumber: String(row[resolvedMapping.orderNumber] || '').trim(),
    orderLineNumber: String(row[resolvedMapping.orderLineNumber] || '').trim(),
    orderDate: String(row[resolvedMapping.orderDate] || '').trim(),
    customerName: String(row[resolvedMapping.customerName] || '').trim(),
    invoiceNumber: String(row[resolvedMapping.invoiceNumber] || '').trim(),
    productCode: String(row[resolvedMapping.productCode] || '').trim(),
    productBarcode: String(row[resolvedMapping.productBarcode] || '').trim(),
    productName: String(row[resolvedMapping.productName] || '').trim(),
    quantity: Number(row[resolvedMapping.quantity]) || 0,
    confirmedQuantity: Number(row[resolvedMapping.confirmedQuantity]) || 0,
    shopName: String(row[resolvedMapping.shopName] || '').trim(),
    deliveryMemo: String(row[resolvedMapping.deliveryMemo] || '').trim(),
    uploadFileName: String(row[resolvedMapping.uploadFileName] || '').trim(),
  }));

  /** 유효한 주문만 필터 (운송장번호가 있는 것) */
  const validOrders = orders.filter((o) => o.waybillNumber.length > 0);

  /** 운송장별 그룹핑하여 통계 계산 */
  const waybillSet = new Set(validOrders.map((o) => o.waybillNumber));
  const productSet = new Set(validOrders.map((o) => o.productBarcode));
  const totalQuantity = validOrders.reduce((sum, o) => sum + o.confirmedQuantity, 0);

  return {
    orders: validOrders,
    totalOrders: waybillSet.size,
    totalQuantity,
    uniqueWaybills: waybillSet.size,
    uniqueProducts: productSet.size,
    fileName: '',
  };
}

/** 헤더 컬럼 자동 매칭 */
function resolveColumnMapping(
  headers: string[],
  mapping: ColumnMapping
): Record<keyof ColumnMapping, string> {
  const resolved: Record<string, string> = {};

  for (const [key, targetName] of Object.entries(mapping)) {
    /** 정확한 매칭 */
    const exactMatch = headers.find((h) => h === targetName);
    if (exactMatch) {
      resolved[key] = exactMatch;
      continue;
    }

    /** 부분 매칭 (포함 관계) */
    const partialMatch = headers.find(
      (h) => h.includes(targetName) || targetName.includes(h)
    );
    if (partialMatch) {
      resolved[key] = partialMatch;
      continue;
    }

    /** 매칭 실패 시 원래 이름 유지 */
    resolved[key] = targetName;
  }

  return resolved as Record<keyof ColumnMapping, string>;
}

/** 운송장별로 주문라인을 그룹핑 */
export function groupByWaybill(
  orders: ParsedOrder[]
): Map<string, ParsedOrder[]> {
  const map = new Map<string, ParsedOrder[]>();

  for (const order of orders) {
    const existing = map.get(order.waybillNumber) || [];
    existing.push(order);
    map.set(order.waybillNumber, existing);
  }

  return map;
}

/** SKU별로 총 수량 계산 (피킹리스트용) */
export function groupBySku(
  orders: ParsedOrder[]
): Map<string, { productName: string; productBarcode: string; totalQuantity: number; cellCount: number }> {
  const map = new Map<string, { productName: string; productBarcode: string; totalQuantity: number; waybills: Set<string> }>();

  for (const order of orders) {
    const key = order.productBarcode || order.productCode;
    const existing = map.get(key);

    if (existing) {
      existing.totalQuantity += order.confirmedQuantity;
      existing.waybills.add(order.waybillNumber);
    } else {
      map.set(key, {
        productName: order.productName,
        productBarcode: order.productBarcode,
        totalQuantity: order.confirmedQuantity,
        waybills: new Set([order.waybillNumber]),
      });
    }
  }

  /** cellCount = 해당 SKU가 들어갈 운송장(셀) 수 */
  const result = new Map<string, { productName: string; productBarcode: string; totalQuantity: number; cellCount: number }>();
  for (const [key, value] of map) {
    result.set(key, {
      productName: value.productName,
      productBarcode: value.productBarcode,
      totalQuantity: value.totalQuantity,
      cellCount: value.waybills.size,
    });
  }

  return result;
}
