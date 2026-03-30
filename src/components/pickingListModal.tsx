'use client';

import { useMemo } from 'react';
import { X, Printer, Package } from 'lucide-react';
import { ZONE_COLORS } from '@/lib/types';
import { cellNumberToLabel, type CellData } from '@/lib/firestore';

interface PickingListModalProps {
  isOpen: boolean;
  onClose: () => void;
  cells: CellData[];
  stationNum: number;
}

interface PickingItem {
  productName: string;
  productBarcode: string;
  totalQuantity: number;
  cells: { cellNumber: number; quantity: number }[];
}

export default function PickingListModal({ isOpen, onClose, cells, stationNum }: PickingListModalProps) {
  /** 셀 데이터에서 SKU별 피킹리스트 집계 */
  const pickingList = useMemo<PickingItem[]>(() => {
    const skuMap = new Map<string, PickingItem>();

    for (const cell of cells) {
      if (!cell.products) continue;
      for (const product of cell.products) {
        const key = product.productBarcode || product.productCode;
        const existing = skuMap.get(key);

        if (existing) {
          existing.totalQuantity += product.requiredQuantity;
          existing.cells.push({ cellNumber: cell.cellNumber, quantity: product.requiredQuantity });
        } else {
          skuMap.set(key, {
            productName: product.productName,
            productBarcode: product.productBarcode,
            totalQuantity: product.requiredQuantity,
            cells: [{ cellNumber: cell.cellNumber, quantity: product.requiredQuantity }],
          });
        }
      }
    }

    return Array.from(skuMap.values()).sort((a, b) => b.totalQuantity - a.totalQuantity);
  }, [cells]);

  /** 전체 통계 */
  const totalSkus = pickingList.length;
  const totalQuantity = pickingList.reduce((sum, item) => sum + item.totalQuantity, 0);
  const totalCells = cells.length;

  /** 셀 번호의 구역 색상 (랙 단위) */
  const getCellZoneColor = (cellNumber: number): string => {
    const rackIndex = Math.ceil(cellNumber / 9) - 1;
    return ZONE_COLORS[rackIndex % ZONE_COLORS.length].primary;
  };

  /** 인쇄 */
  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center print:relative print:inset-auto print:block print:z-auto">
      <div className="absolute inset-0 bg-black/70 no-print" onClick={onClose} />

      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl mx-4 print:max-w-none print:max-h-none print:overflow-visible print:m-0 print:rounded-none print:border-none print:bg-white print:shadow-none">
        {/* 헤더 */}
        <div className="sticky top-0 flex items-center justify-between p-5 border-b border-gray-800 bg-gray-900 rounded-t-2xl z-10 print:bg-white print:border-gray-300 print:rounded-none print:static">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2 print:text-black">
              <Package className="w-5 h-5 text-blue-400 print:text-black" />
              피킹리스트 — 스테이션 {stationNum}
            </h2>
            <p className="text-sm text-gray-500 mt-1 print:text-gray-600">
              {totalSkus}종 / {totalQuantity}개 / {totalCells}셀
            </p>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              <Printer className="w-4 h-4" />
              인쇄
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5">
          {pickingList.length === 0 ? (
            <div className="text-center py-16 text-gray-600">
              <Package className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p>배정된 셀이 없습니다.</p>
              <p className="text-sm mt-1">운송장을 스캔한 후 피킹리스트를 확인하세요.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800 print:text-gray-600 print:border-gray-300">
                  <th className="py-3 px-2 w-12">#</th>
                  <th className="py-3 px-2">상품명</th>
                  <th className="py-3 px-2">바코드</th>
                  <th className="py-3 px-2 text-center w-20">총수량</th>
                  <th className="py-3 px-2">셀 배분</th>
                </tr>
              </thead>
              <tbody>
                {pickingList.map((item, index) => (
                  <tr
                    key={item.productBarcode}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 print:border-gray-200 print:hover:bg-transparent"
                  >
                    <td className="py-3 px-2 text-gray-500 print:text-gray-600">{index + 1}</td>
                    <td className="py-3 px-2">
                      <span className="text-white font-medium print:text-black">{item.productName}</span>
                    </td>
                    <td className="py-3 px-2">
                      <span className="text-gray-400 font-mono text-xs print:text-gray-600">{item.productBarcode}</span>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <span className="text-lg font-bold text-white print:text-black">{item.totalQuantity}</span>
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex flex-wrap gap-1.5">
                        {item.cells.map((c) => (
                          <span
                            key={c.cellNumber}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium print:border print:border-gray-400"
                            style={{
                              backgroundColor: getCellZoneColor(c.cellNumber) + '20',
                              color: getCellZoneColor(c.cellNumber),
                            }}
                          >
                            {cellNumberToLabel(c.cellNumber)}
                            {c.quantity > 1 && <span className="font-bold">x{c.quantity}</span>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
