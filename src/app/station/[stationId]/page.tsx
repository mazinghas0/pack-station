'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ScanBarcode, Package, CheckCircle2, AlertTriangle, Keyboard, Zap, RotateCcw } from 'lucide-react';
import { ZONE_COLORS } from '@/lib/types';
import { assignWaybillToCell, subscribeToCells, getLatestUpload, clearStationCells, type CellData } from '@/lib/firestore';
import { playScanSuccess, playScanError, playComplete } from '@/lib/sounds';

type ScanMode = 'waybill' | 'sku';

interface FocusedProduct {
  productBarcode: string;
  productName: string;
  matchingCells: { cellNumber: number; requiredQuantity: number; packedQuantity: number }[];
  totalQuantity: number;
}

export default function StationWorkPage() {
  const params = useParams();
  const router = useRouter();
  const stationId = `station-${params.stationId}`;
  const stationNum = Number(params.stationId);
  const stationColor = ZONE_COLORS[(stationNum - 1) % ZONE_COLORS.length];
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [scanValue, setScanValue] = useState('');
  const [cells, setCells] = useState<CellData[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('데이터 로딩 중...');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const isProcessingRef = useRef(false);
  const localCellCountRef = useRef<number | null>(null);

  /** SKU 스캔 모드 */
  const [scanMode, setScanMode] = useState<ScanMode>('waybill');
  const [focusedProduct, setFocusedProduct] = useState<FocusedProduct | null>(null);

  /** 최신 업로드 ID 가져오기 */
  useEffect(() => {
    (async () => {
      const upload = await getLatestUpload();
      if (upload) {
        setUploadId(upload.id);
        setStatusMessage('운송장을 스캔하여 셀에 배정하세요');
      } else {
        setStatusMessage('관리자 페이지에서 엑셀을 먼저 업로드해주세요');
        setStatusType('error');
      }
    })();
  }, []);

  /** Firebase 실시간 셀 구독 */
  useEffect(() => {
    const unsubscribe = subscribeToCells(stationId, (firestoreCells) => {
      setCells(firestoreCells);
      if (localCellCountRef.current === null) {
        localCellCountRef.current = firestoreCells.length;
      }
    });
    return () => unsubscribe();
  }, [stationId]);

  /** 페이지 클릭 시 스캔 입력에 포커스 */
  useEffect(() => {
    const handleClick = () => scanInputRef.current?.focus();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const scannedCount = cells.length;

  /** ===== 운송장 스캔 처리 ===== */
  const processWaybillScan = useCallback(async (waybillNumber: string) => {
    if (!uploadId || isProcessingRef.current) return;

    const trimmed = waybillNumber.trim();
    if (!trimmed) return;

    isProcessingRef.current = true;

    try {
      const currentCount = localCellCountRef.current ?? scannedCount;
      const nextCellNumber = currentCount + 1;

      if (nextCellNumber > 100) {
        playScanError();
        setStatusMessage('100셀이 모두 배정되었습니다. 상품 스캔 모드로 전환하세요.');
        setStatusType('error');
        return;
      }

      const result = await assignWaybillToCell(stationId, nextCellNumber, trimmed, uploadId);

      if (result.success) {
        localCellCountRef.current = nextCellNumber;
        playScanSuccess();
        setStatusMessage(`셀 ${nextCellNumber}번 배정 완료 — ${trimmed}`);
        setStatusType('success');
      } else {
        playScanError();
        const location = result.existingStation && result.existingCell
          ? ` → ${result.existingStation} 셀 ${result.existingCell}번`
          : '';
        setStatusMessage(`${result.error}${location}`);
        setStatusType('error');
      }
    } catch (err) {
      playScanError();
      setStatusMessage(err instanceof Error ? err.message : '스캔 처리 오류');
      setStatusType('error');
    } finally {
      isProcessingRef.current = false;
    }
  }, [uploadId, stationId, scannedCount]);

  /** ===== SKU 스캔 처리 ===== */
  const processSkuScan = useCallback((barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    /** cells 배열에서 해당 바코드가 필요한 셀 찾기 (클라이언트 필터링) */
    const matchingCells: FocusedProduct['matchingCells'] = [];
    let productName = '';

    for (const cell of cells) {
      if (!cell.products) continue;
      for (const product of cell.products) {
        if (product.productBarcode === trimmed && product.packedQuantity < product.requiredQuantity) {
          matchingCells.push({
            cellNumber: cell.cellNumber,
            requiredQuantity: product.requiredQuantity,
            packedQuantity: product.packedQuantity,
          });
          if (!productName) productName = product.productName;
        }
      }
    }

    if (matchingCells.length === 0) {
      playScanError();
      setFocusedProduct(null);
      setStatusMessage(`이 상품이 필요한 셀이 없습니다 (${trimmed})`);
      setStatusType('error');
      return;
    }

    const totalQty = matchingCells.reduce((sum, c) => sum + (c.requiredQuantity - c.packedQuantity), 0);

    playScanSuccess();
    setFocusedProduct({
      productBarcode: trimmed,
      productName,
      matchingCells,
      totalQuantity: totalQty,
    });
    setStatusMessage(`${productName} — ${matchingCells.length}개 셀에 총 ${totalQty}개 분배`);
    setStatusType('success');
  }, [cells]);

  /** 통합 스캔 핸들러 */
  const handleScan = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !scanValue.trim()) return;

    if (scanMode === 'waybill') {
      processWaybillScan(scanValue);
    } else {
      processSkuScan(scanValue);
    }
    setScanValue('');
  }, [scanValue, scanMode, processWaybillScan, processSkuScan]);

  /** 수동 입력 처리 */
  const handleManualSubmit = useCallback(() => {
    if (!manualValue.trim()) return;
    if (scanMode === 'waybill') {
      processWaybillScan(manualValue);
    } else {
      processSkuScan(manualValue);
    }
    setManualValue('');
    setShowManualInput(false);
    scanInputRef.current?.focus();
  }, [manualValue, scanMode, processWaybillScan, processSkuScan]);

  /** 모드 전환 */
  const handleModeSwitch = useCallback((mode: ScanMode) => {
    setScanMode(mode);
    setFocusedProduct(null);
    setScanValue('');
    if (mode === 'waybill') {
      setStatusMessage('운송장을 스캔하여 셀에 배정하세요');
    } else {
      setStatusMessage('상품 바코드를 스캔하면 해당 셀이 강조됩니다');
    }
    setStatusType('info');
    scanInputRef.current?.focus();
  }, []);

  /** 배치 초기화 */
  const handleClearBatch = useCallback(async () => {
    if (!confirm('현재 스테이션의 모든 셀을 초기화하시겠습니까?\n(다음 배치 시작 시 사용)')) return;
    await clearStationCells(stationId);
    localCellCountRef.current = 0;
    setFocusedProduct(null);
    setScanMode('waybill');
    setStatusMessage('셀 초기화 완료. 새 배치를 시작하세요.');
    setStatusType('info');
  }, [stationId]);

  /** 구역 색상 (4색 구역제: 25개씩) */
  const getCellZoneColor = (cellNumber: number): string => {
    const zoneIndex = Math.floor((cellNumber - 1) / 25);
    return ZONE_COLORS[zoneIndex % ZONE_COLORS.length].primary;
  };

  /** 셀 데이터 조회 */
  const getCellForNumber = (num: number): CellData | null => {
    return cells.find((c) => c.cellNumber === num) || null;
  };

  /** 포커스된 셀인지 확인 */
  const isCellFocused = (cellNumber: number): boolean => {
    if (!focusedProduct) return false;
    return focusedProduct.matchingCells.some((c) => c.cellNumber === cellNumber);
  };

  /** 포커스된 셀의 필요 수량 */
  const getFocusedQty = (cellNumber: number): number => {
    if (!focusedProduct) return 0;
    const match = focusedProduct.matchingCells.find((c) => c.cellNumber === cellNumber);
    return match ? match.requiredQuantity - match.packedQuantity : 0;
  };

  /** 셀 스타일 */
  const getCellStatusStyle = (cell: CellData | null, cellNumber: number): string => {
    const focused = isCellFocused(cellNumber);

    if (focused) {
      return 'border-yellow-400 bg-yellow-400/20 ring-2 ring-yellow-400 scale-[1.02] shadow-lg shadow-yellow-400/30';
    }

    if (!cell) return 'border-gray-700/60 bg-gray-900/40';

    /** SKU 모드에서 포커스 안 된 배정 셀은 어둡게 */
    const dimmed = focusedProduct ? ' opacity-40' : '';

    switch (cell.status) {
      case 'assigned':
        return 'border-blue-500/70 bg-blue-500/10' + dimmed;
      case 'packing':
        return 'border-yellow-500 bg-yellow-500/10' + dimmed;
      case 'completed':
        return 'border-green-500/60 bg-green-500/10' + dimmed;
      case 'hold':
      case 'replenish':
        return 'border-orange-500 bg-orange-500/10 animate-pulse' + dimmed;
      default:
        return 'border-blue-500/70 bg-blue-500/10' + dimmed;
    }
  };

  return (
    <main className="min-h-screen bg-black flex flex-col">
      {/* 상단 바 */}
      <header className="no-print flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/station')} className="p-2 rounded-lg hover:bg-gray-800">
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div
            className="text-xl font-bold px-3 py-1 rounded-lg"
            style={{ backgroundColor: stationColor.primary + '20', color: stationColor.primary }}
          >
            스테이션 {stationNum}
          </div>

          {/* 모드 전환 버튼 */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => handleModeSwitch('waybill')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scanMode === 'waybill'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <ScanBarcode className="w-3.5 h-3.5 inline mr-1" />
              운송장
            </button>
            <button
              onClick={() => handleModeSwitch('sku')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scanMode === 'sku'
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5 inline mr-1" />
              상품분배
            </button>
          </div>
        </div>

        {/* 진행률 */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-500">스캔</p>
            <p className="text-2xl font-bold text-white">
              {scannedCount}<span className="text-sm text-gray-500">/100</span>
            </p>
          </div>
          <div className="w-48 h-3 rounded-full bg-gray-800">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${(scannedCount / 100) * 100}%`, backgroundColor: stationColor.primary }}
            />
          </div>
        </div>

        {/* 스캔 입력 + 버튼들 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManualInput(!showManualInput)}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white"
            title="수동 입력"
          >
            <Keyboard className="w-5 h-5" />
          </button>

          <div className="relative">
            <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              ref={scanInputRef}
              type="text"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={handleScan}
              placeholder={scanMode === 'waybill' ? '운송장 바코드 스캔...' : '상품 바코드 스캔...'}
              className={`w-64 pl-9 pr-3 py-2 rounded-lg border text-white placeholder-gray-600 focus:outline-none text-sm ${
                scanMode === 'waybill'
                  ? 'bg-gray-900 border-gray-700 focus:border-blue-500'
                  : 'bg-yellow-950/30 border-yellow-700/50 focus:border-yellow-500'
              }`}
              autoFocus
            />
          </div>

          {focusedProduct && (
            <button
              onClick={() => { setFocusedProduct(null); setStatusMessage('상품 바코드를 스캔하면 해당 셀이 강조됩니다'); setStatusType('info'); }}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white"
              title="포커스 해제"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}

          {scannedCount > 0 && (
            <button
              onClick={handleClearBatch}
              className="px-3 py-2 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-400"
            >
              초기화
            </button>
          )}
        </div>
      </header>

      {/* 수동 입력 패널 */}
      {showManualInput && (
        <div className="no-print px-4 py-3 bg-gray-900 border-b border-gray-800 flex items-center gap-3">
          <span className="text-sm text-gray-400">수동 입력:</span>
          <input
            type="text"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
            placeholder={scanMode === 'waybill' ? '운송장 번호 직접 입력...' : '상품 바코드 직접 입력...'}
            className="flex-1 max-w-md px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
            autoFocus
          />
          <button
            onClick={handleManualSubmit}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            등록
          </button>
        </div>
      )}

      {/* 상태 메시지 */}
      <div
        className={`no-print px-4 py-2 text-center text-sm font-medium
          ${statusType === 'success' ? 'text-green-400 bg-green-500/5' : ''}
          ${statusType === 'error' ? 'text-red-400 bg-red-500/5' : ''}
          ${statusType === 'info' ? 'text-gray-400' : ''}`}
      >
        {statusType === 'error' && <AlertTriangle className="inline w-4 h-4 mr-1" />}
        {statusType === 'success' && <CheckCircle2 className="inline w-4 h-4 mr-1" />}
        {statusMessage}
      </div>

      {/* SKU 포커스 정보 바 */}
      {focusedProduct && (
        <div className="no-print px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/30 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Package className="w-6 h-6 text-yellow-400" />
            <div>
              <p className="text-yellow-300 font-bold text-lg">{focusedProduct.productName}</p>
              <p className="text-yellow-400/70 text-xs">{focusedProduct.productBarcode}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-yellow-400/60">분배 셀</p>
              <p className="text-2xl font-black text-yellow-300">{focusedProduct.matchingCells.length}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-yellow-400/60">총 수량</p>
              <p className="text-2xl font-black text-yellow-300">{focusedProduct.totalQuantity}</p>
            </div>
          </div>
        </div>
      )}

      {/* 셀 그리드 (10x10) */}
      <div className="flex-1 p-3">
        <div className="grid grid-cols-10 gap-1.5 h-full">
          {Array.from({ length: 100 }, (_, i) => i + 1).map((cellNumber) => {
            const cell = getCellForNumber(cellNumber);
            const focused = isCellFocused(cellNumber);
            const focusQty = getFocusedQty(cellNumber);

            return (
              <div
                key={cellNumber}
                className={`relative flex flex-col items-center justify-center rounded-lg border-2 p-1 min-h-[80px] transition-all duration-200
                  ${getCellStatusStyle(cell, cellNumber)}
                  ${focused ? 'animate-pulse z-10' : ''}`}
              >
                {/* 셀 번호 */}
                <span
                  className={`font-black leading-none ${focused ? 'text-4xl' : 'text-2xl'}`}
                  style={{ color: focused ? '#facc15' : cell ? getCellZoneColor(cellNumber) : getCellZoneColor(cellNumber) + '80' }}
                >
                  {cellNumber}
                </span>

                {/* SKU 포커스 시 필요 수량 크게 표시 */}
                {focused && (
                  <span className="text-2xl font-black text-yellow-300 mt-0.5">
                    x{focusQty}
                  </span>
                )}

                {/* 배정된 셀 정보 (포커스 아닐 때) */}
                {cell && !focused && (
                  <>
                    <span className="text-[10px] text-gray-400 mt-0.5 truncate w-full text-center font-mono">
                      {cell.waybillNumber}
                    </span>

                    <div className="flex items-center gap-1 mt-0.5">
                      <Package className="w-3 h-3 text-gray-500" />
                      <span className="text-xs text-gray-400">
                        {cell.packedSkuCount}/{cell.totalSkuCount}
                      </span>
                      <span className="text-xs font-bold text-white">
                        x{cell.totalQuantity}
                      </span>
                    </div>

                    <span className="text-[9px] text-gray-600 truncate w-full text-center">
                      {cell.customerName}
                    </span>

                    {cell.status === 'completed' && (
                      <CheckCircle2 className="absolute top-1 right-1 w-4 h-4 text-green-400" />
                    )}
                    {(cell.status === 'hold' || cell.status === 'replenish') && (
                      <AlertTriangle className="absolute top-1 right-1 w-4 h-4 text-orange-400" />
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
