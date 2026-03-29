'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ScanBarcode, Package, CheckCircle2, AlertTriangle, Keyboard, Zap, RotateCcw, ClipboardList, Search, PauseCircle, Shield, Maximize2, Minimize2, X } from 'lucide-react';
import { ZONE_COLORS } from '@/lib/types';
import { assignWaybillToCell, subscribeToCells, getActiveUpload, getStationUpload, setStationUpload, clearStationCells, setCellHold, clearCellHold, completeSkuForCells, cellNumberToLabel, TOTAL_CELLS, type CellData } from '@/lib/firestore';
import { playScanSuccess, playScanError } from '@/lib/sounds';
import { useAuth } from '@/components/authProvider';
import { canAccessAdmin } from '@/lib/auth';
import PickingListModal from '@/components/pickingListModal';
import SearchModal from '@/components/searchModal';

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
  const { user: currentUser } = useAuth();
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

  const [scanMode, setScanMode] = useState<ScanMode>('waybill');
  const [focusedProduct, setFocusedProduct] = useState<FocusedProduct | null>(null);
  const [showPickingList, setShowPickingList] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [newBatchReady, setNewBatchReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<CellData | null>(null);

  /** 배차 ID 로딩 — 스테이션 전용 배차 우선, 없으면 활성 배차 사용 */
  useEffect(() => {
    (async () => {
      const [stationUploadId, activeUpload] = await Promise.all([
        getStationUpload(stationId),
        getActiveUpload(),
      ]);

      const resolvedId = stationUploadId ?? activeUpload?.id ?? null;

      if (resolvedId) {
        setUploadId(resolvedId);
        await setStationUpload(stationId, resolvedId);
        setStatusMessage('운송장을 스캔하여 셀에 배정하세요');

        /** 스테이션 배차와 활성 배차가 다르면 새 배차 알림 */
        if (activeUpload && activeUpload.id !== resolvedId) {
          setNewBatchReady(true);
        }
      } else {
        setStatusMessage('관리자 페이지에서 엑셀을 먼저 업로드해주세요');
        setStatusType('error');
      }
    })();
  }, [stationId]);

  /** Firebase 실시간 셀 구독 — uploadId 확정 후에만 구독 시작 */
  useEffect(() => {
    if (!uploadId) return;
    const unsubscribe = subscribeToCells(stationId, uploadId, (firestoreCells) => {
      setCells(firestoreCells);
      if (localCellCountRef.current === null) {
        localCellCountRef.current = firestoreCells.length;
      }
    });
    return () => unsubscribe();
  }, [stationId, uploadId]);

  /** 전체화면 상태 동기화 */
  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  /** 페이지 클릭 시 스캔 입력에 포커스 (모달 열린 상태에서는 제외) */
  useEffect(() => {
    const handleClick = () => {
      if (!showPickingList && !showSearch) {
        scanInputRef.current?.focus();
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showPickingList, showSearch]);

  const scannedCount = cells.length;
  const completedCount = cells.filter((c) => c.status === 'completed').length;
  const holdCount = cells.filter((c) => c.status === 'hold').length;

  /** 배치 요약 (초기화 전 표시) */
  const batchSummary = useMemo(() => ({
    total: scannedCount,
    completed: completedCount,
    hold: holdCount,
    pending: scannedCount - completedCount - holdCount,
  }), [scannedCount, completedCount, holdCount]);

  /** ===== 운송장 스캔 처리 ===== */
  const processWaybillScan = useCallback(async (waybillNumber: string) => {
    if (!uploadId || isProcessingRef.current) return;

    const trimmed = waybillNumber.trim();
    if (!trimmed) return;

    isProcessingRef.current = true;

    try {
      const currentCount = localCellCountRef.current ?? scannedCount;
      const nextCellNumber = currentCount + 1;

      if (nextCellNumber > TOTAL_CELLS) {
        playScanError();
        setStatusMessage(`${TOTAL_CELLS}셀이 모두 배정되었습니다. 상품분배 모드로 전환하세요.`);
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

  /** ===== SKU 패킹 완료 처리 ===== */
  const handleCompleteSku = useCallback(async () => {
    if (!focusedProduct) return;
    const cellNumbers = focusedProduct.matchingCells.map((c) => c.cellNumber);
    await completeSkuForCells(stationId, cellNumbers, focusedProduct.productBarcode, cells);
    playScanSuccess();
    setStatusMessage(`${focusedProduct.productName} 패킹 완료 처리됐습니다.`);
    setStatusType('success');
    setFocusedProduct(null);
  }, [focusedProduct, stationId, cells]);

  /** ===== SKU 스캔 처리 ===== */
  const processSkuScan = useCallback((barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    /** 동일 바코드 재스캔 → 완료 처리 */
    if (focusedProduct && focusedProduct.productBarcode === trimmed) {
      handleCompleteSku();
      return;
    }

    const matchingCells: FocusedProduct['matchingCells'] = [];
    let productName = '';

    for (const cell of cells) {
      if (!cell.products || cell.status === 'hold') continue;
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
  }, [cells, focusedProduct, handleCompleteSku]);

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

  /** 배치 초기화 (요약 포함) — 초기화 후 최신 활성 배차로 자동 전환 */
  const handleClearBatch = useCallback(async () => {
    const msg = scannedCount > 0
      ? `현재 배치 요약:\n• 총 ${batchSummary.total}셀\n• 완료 ${batchSummary.completed}셀\n• 보충대기 ${batchSummary.hold}셀\n• 작업중 ${batchSummary.pending}셀\n\n초기화하고 다음 배치를 시작하시겠습니까?`
      : '셀을 초기화하시겠습니까?';

    if (!confirm(msg)) return;
    await clearStationCells(stationId);
    localCellCountRef.current = 0;
    setFocusedProduct(null);
    setScanMode('waybill');

    /** 초기화 시 최신 활성 배차로 자동 전환 */
    const active = await getActiveUpload();
    if (active) {
      setUploadId(active.id);
      await setStationUpload(stationId, active.id);
      setNewBatchReady(false);
      setStatusMessage('셀 초기화 완료. 새 배차 운송장을 스캔하세요.');
    } else {
      setStatusMessage('셀 초기화 완료. 새 배치 운송장을 스캔하세요.');
    }
    setStatusType('info');
  }, [stationId, scannedCount, batchSummary]);

  /** 셀 보충대기 토글 */
  const handleToggleHold = useCallback(async (cellNumber: number) => {
    const cell = cells.find((c) => c.cellNumber === cellNumber);
    if (!cell) return;

    if (cell.status === 'hold') {
      await clearCellHold(cell.id);
      setStatusMessage(`셀 ${cellNumber}번 보충대기 해제`);
    } else {
      await setCellHold(cell.id);
      setStatusMessage(`셀 ${cellNumber}번 보충대기 설정`);
    }
    setStatusType('info');
  }, [cells]);

  /** 구역 색상 (랙 단위: 9셀씩 1랙, 9색 순환) */
  const getCellZoneColor = (cellNumber: number): string => {
    const rackIndex = Math.ceil(cellNumber / 9) - 1;
    return ZONE_COLORS[rackIndex % ZONE_COLORS.length].primary;
  };

  const getCellForNumber = (num: number): CellData | null => {
    return cells.find((c) => c.cellNumber === num) || null;
  };

  const isCellFocused = (cellNumber: number): boolean => {
    if (!focusedProduct) return false;
    return focusedProduct.matchingCells.some((c) => c.cellNumber === cellNumber);
  };

  const getFocusedQty = (cellNumber: number): number => {
    if (!focusedProduct) return 0;
    const match = focusedProduct.matchingCells.find((c) => c.cellNumber === cellNumber);
    return match ? match.requiredQuantity - match.packedQuantity : 0;
  };

  const getCellStatusStyle = (cell: CellData | null, cellNumber: number): string => {
    const focused = isCellFocused(cellNumber);

    if (focused) {
      return 'border-yellow-400 bg-yellow-400/20 ring-2 ring-yellow-400 scale-[1.02] shadow-lg shadow-yellow-400/30';
    }

    if (!cell) return 'border-gray-700/60 bg-gray-900/40';

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

          {/* 모드 전환 */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => handleModeSwitch('waybill')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scanMode === 'waybill' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <ScanBarcode className="w-3.5 h-3.5 inline mr-1" />
              운송장
            </button>
            <button
              onClick={() => handleModeSwitch('sku')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scanMode === 'sku' ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
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
              {scannedCount}<span className="text-sm text-gray-500">/{cells.length || TOTAL_CELLS}</span>
            </p>
          </div>
          {holdCount > 0 && (
            <div className="text-center">
              <p className="text-xs text-orange-400/60">보충대기</p>
              <p className="text-lg font-bold text-orange-400">{holdCount}</p>
            </div>
          )}
          <div className="w-36 h-3 rounded-full bg-gray-800">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${(scannedCount / (cells.length || TOTAL_CELLS)) * 100}%`, backgroundColor: stationColor.primary }}
            />
          </div>
        </div>

        {/* 도구 버튼들 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPickingList(true)}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white"
            title="피킹리스트"
          >
            <ClipboardList className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowSearch(true)}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white"
            title="검색"
          >
            <Search className="w-5 h-5" />
          </button>
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
              placeholder={scanMode === 'waybill' ? '운송장 스캔...' : '상품 바코드 스캔...'}
              className={`w-56 pl-9 pr-3 py-2 rounded-lg border text-white placeholder-gray-600 focus:outline-none text-sm ${
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

          {canAccessAdmin(currentUser) && (
            <button
              onClick={() => router.push('/admin')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            >
              <Shield className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">관리자</span>
            </button>
          )}

          <button
            onClick={handleToggleFullscreen}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white transition-colors"
            title={isFullscreen ? '전체화면 해제' : '전체화면'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 새 배차 알림 배너 */}
      {newBatchReady && (
        <div className="no-print px-4 py-2 bg-blue-500/10 border-b border-blue-500/30 flex items-center justify-between">
          <p className="text-blue-400 text-sm">새 배차가 준비됐습니다. 현재 작업 완료 후 초기화 버튼을 누르면 자동으로 전환됩니다.</p>
        </div>
      )}

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

      {/* 상태 메시지 — focusedProduct 없을 때만 표시 */}
      {!focusedProduct && (
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
      )}

      {/* SKU 포커스 정보 바 — 상태 메시지 통합 */}
      {focusedProduct && (
        <div className="no-print px-4 py-1.5 bg-yellow-500/10 border-b border-yellow-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Package className="w-4 h-4 text-yellow-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-yellow-300 font-bold text-sm truncate">{focusedProduct.productName}</p>
              <p className={`text-xs truncate
                ${statusType === 'success' ? 'text-green-400' : ''}
                ${statusType === 'error' ? 'text-red-400' : ''}
                ${statusType === 'info' ? 'text-yellow-400/60 font-mono' : ''}`}
              >
                {statusType === 'info' ? focusedProduct.productBarcode : statusMessage}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-3">
            <div className="text-center">
              <p className="text-[10px] text-yellow-400/60">분배 셀</p>
              <p className="text-lg font-black text-yellow-300 leading-none">{focusedProduct.matchingCells.length}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-yellow-400/60">총 수량</p>
              <p className="text-lg font-black text-yellow-300 leading-none">{focusedProduct.totalQuantity}</p>
            </div>
            <button
              onClick={handleCompleteSku}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-bold transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              완료
            </button>
            <button
              onClick={() => setFocusedProduct(null)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 셀 그리드 (12랙 × 9셀) */}
      <div className="flex-1 p-3 flex flex-col min-h-0">
        {/* 랙 헤더 행 */}
        <div className="grid grid-cols-11 gap-1.5 mb-1">
          {Array.from({ length: 11 }, (_, i) => i + 1).map((rackNum) => (
            <div
              key={rackNum}
              className="text-center text-[10px] font-bold py-0.5 rounded"
              style={{ color: ZONE_COLORS[(rackNum - 1) % ZONE_COLORS.length].primary, backgroundColor: ZONE_COLORS[(rackNum - 1) % ZONE_COLORS.length].primary + '20' }}
            >
              R{String(rackNum).padStart(2, '0')}
            </div>
          ))}
        </div>

        {/* 9행 × 11열 셀 */}
        <div className="flex-1 min-h-0 grid grid-cols-11 grid-rows-9 gap-1.5 h-full">
          {Array.from({ length: TOTAL_CELLS }, (_, i) => {
            const cellNumber = i + 1;
            const rack = Math.ceil(cellNumber / 9);
            const pos = ((cellNumber - 1) % 9) + 1;
            /** 열 우선(column-major) → 행 우선(row-major) 재배열: 랙이 열, 위치가 행 */
            const gridCol = rack;
            const gridRow = pos;
            const cell = getCellForNumber(cellNumber);
            const focused = isCellFocused(cellNumber);
            const focusQty = getFocusedQty(cellNumber);

            return (
              <div
                key={cellNumber}
                style={{ gridColumn: gridCol, gridRow: gridRow }}
                onClick={(e) => { if (cell) { e.stopPropagation(); setSelectedCell(cell); } }}
                className={`relative flex flex-col items-center justify-center rounded-lg border-2 p-1 transition-all duration-200
                  ${getCellStatusStyle(cell, cellNumber)}
                  ${focused ? 'animate-pulse z-10' : ''}
                  ${cell ? 'cursor-pointer' : ''}`}
              >
                {/* 랙 레이블 */}
                <span
                  className={`font-black leading-none ${focused ? 'text-base' : 'text-xs'}`}
                  style={{ color: focused ? '#facc15' : cell ? getCellZoneColor(cellNumber) : getCellZoneColor(cellNumber) + '80' }}
                >
                  {cellNumberToLabel(cellNumber)}
                </span>

                {/* SKU 포커스 시 필요 수량 */}
                {focused && (
                  <span className="text-xl font-black text-yellow-300 mt-0.5">
                    x{focusQty}
                  </span>
                )}

                {/* 배정된 셀 정보 */}
                {cell && !focused && (
                  <>
                    <span className="text-[9px] text-gray-400 mt-0.5 truncate w-full text-center font-mono">
                      {cell.waybillNumber}
                    </span>

                    <div className="flex items-center gap-0.5 mt-0.5">
                      <Package className="w-2.5 h-2.5 text-gray-500" />
                      <span className="text-[10px] text-gray-400">
                        {cell.packedSkuCount}/{cell.totalSkuCount}
                      </span>
                      <span className="text-[10px] font-bold text-white">
                        x{cell.totalQuantity}
                      </span>
                    </div>

                    <span className="text-[8px] text-gray-600 truncate w-full text-center">
                      {cell.customerName}
                    </span>

                    {/* 상태 아이콘 */}
                    {cell.status === 'completed' && (
                      <CheckCircle2 className="absolute top-0.5 right-0.5 w-3 h-3 text-green-400" />
                    )}
                    {cell.status === 'hold' && (
                      <PauseCircle className="absolute top-0.5 right-0.5 w-3 h-3 text-orange-400" />
                    )}

                    {/* 보충대기 토글 버튼 (셀 좌상단) */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleHold(cellNumber); }}
                      className={`absolute top-0 left-0 w-4 h-4 rounded-full flex items-center justify-center transition-colors ${
                        cell.status === 'hold'
                          ? 'bg-orange-500 text-white'
                          : 'bg-transparent text-transparent hover:bg-gray-700 hover:text-gray-400'
                      }`}
                      title={cell.status === 'hold' ? '보충대기 해제' : '보충대기 설정'}
                    >
                      <PauseCircle className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 모달들 */}
      <PickingListModal
        isOpen={showPickingList}
        onClose={() => setShowPickingList(false)}
        cells={cells}
        stationNum={stationNum}
      />
      <SearchModal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
      />

      {/* 셀 상세 모달 */}
      {selectedCell && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">셀 {selectedCell.cellNumber}번</p>
                <p className="text-lg font-bold text-white font-mono">{selectedCell.waybillNumber}</p>
                <p className="text-sm text-gray-400">{selectedCell.customerName}</p>
              </div>
              <div className="flex items-center gap-3">
                {/* 셀 상태 배지 */}
                {selectedCell.status === 'completed' && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
                    <CheckCircle2 className="w-3 h-3" /> 완료
                  </span>
                )}
                {selectedCell.status === 'hold' && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400">
                    <PauseCircle className="w-3 h-3" /> 보충대기
                  </span>
                )}
                {selectedCell.status === 'pending' && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                    <Package className="w-3 h-3" /> 작업중
                  </span>
                )}
                <button
                  onClick={() => setSelectedCell(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 수량 요약 */}
            <div className="flex gap-4 px-5 py-3 bg-gray-800/50 border-b border-gray-800">
              <div className="text-center">
                <p className="text-xs text-gray-500">총 수량</p>
                <p className="text-xl font-bold text-white">{selectedCell.totalQuantity}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">포장 완료</p>
                <p className="text-xl font-bold text-green-400">{selectedCell.packedQuantity}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">SKU</p>
                <p className="text-xl font-bold text-gray-300">{selectedCell.packedSkuCount}/{selectedCell.totalSkuCount}</p>
              </div>
            </div>

            {/* 상품 목록 */}
            <div className="max-h-64 overflow-y-auto">
              {selectedCell.products.map((product, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between px-5 py-3 border-b border-gray-800/50 ${
                    product.status === 'completed' ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm text-white truncate">{product.productName}</p>
                    <p className="text-xs text-gray-500 font-mono">{product.productBarcode}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-white">
                      {product.packedQuantity}<span className="text-gray-500">/{product.requiredQuantity}</span>
                    </span>
                    {product.status === 'completed' && (
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 배송 메모 */}
            {selectedCell.deliveryMemo && (
              <div className="px-5 py-3 bg-yellow-500/5 border-t border-yellow-500/20">
                <p className="text-xs text-yellow-400/70">배송 메모</p>
                <p className="text-sm text-yellow-300">{selectedCell.deliveryMemo}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
