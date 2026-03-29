'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ScanBarcode, Package, CheckCircle2, AlertTriangle, Keyboard } from 'lucide-react';
import { ZONE_COLORS, type CellStatus } from '@/lib/types';
import { assignWaybillToCell, subscribeToCells, getLatestUpload, clearStationCells, type CellData } from '@/lib/firestore';
import { playScanSuccess, playScanError, playComplete } from '@/lib/sounds';

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
      // 페이지 첫 로드 시 Firestore 기준으로 localCellCount 초기화
      if (localCellCountRef.current === null) {
        localCellCountRef.current = firestoreCells.length;
      }
    });
    return () => unsubscribe();
  }, [stationId]);

  /** 페이지 클릭 시 스캔 입력에 포커스 (작업 중 실수 방지) */
  useEffect(() => {
    const handleClick = () => scanInputRef.current?.focus();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  /** 스캔된 셀 수 */
  const scannedCount = cells.length;
  const completedCount = cells.filter((c) => c.status === 'completed').length;

  /** 운송장 스캔 처리 */
  const processWaybillScan = useCallback(async (waybillNumber: string) => {
    if (!uploadId || isProcessingRef.current) return;

    const trimmed = waybillNumber.trim();
    if (!trimmed) return;

    isProcessingRef.current = true;

    try {
      // Firestore 구독 응답을 기다리지 않고 ref로 즉각 계산
      const currentCount = localCellCountRef.current ?? scannedCount;
      const nextCellNumber = currentCount + 1;

      if (nextCellNumber > 100) {
        playScanError();
        setStatusMessage('100셀이 모두 배정되었습니다. 배치를 완료해주세요.');
        setStatusType('error');
        return;
      }

      const result = await assignWaybillToCell(stationId, nextCellNumber, trimmed, uploadId);

      if (result.success) {
        // 성공 즉시 로컬 카운터 증가 (Firestore 응답 대기 없음)
        localCellCountRef.current = nextCellNumber;
        playScanSuccess();
        setStatusMessage(`셀 ${nextCellNumber}번에 운송장 배정 완료 (${trimmed.slice(-6)})`);
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

  /** 스캔 입력 (바코드 스캐너 = Enter 키) */
  const handleScan = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !scanValue.trim()) return;
    processWaybillScan(scanValue);
    setScanValue('');
  }, [scanValue, processWaybillScan]);

  /** 수동 입력 처리 */
  const handleManualSubmit = useCallback(() => {
    if (!manualValue.trim()) return;
    processWaybillScan(manualValue);
    setManualValue('');
    setShowManualInput(false);
    scanInputRef.current?.focus();
  }, [manualValue, processWaybillScan]);

  /** 배치 초기화 */
  const handleClearBatch = useCallback(async () => {
    if (!confirm('현재 스테이션의 모든 셀을 초기화하시겠습니까?\n(다음 배치 시작 시 사용)')) return;
    await clearStationCells(stationId);
    localCellCountRef.current = 0;
    setStatusMessage('셀 초기화 완료. 새 배치를 시작하세요.');
    setStatusType('info');
  }, [stationId]);

  /** 구역 색상 (4색 구역제: 25개씩) */
  const getCellZoneColor = (cellNumber: number): string => {
    const zoneIndex = Math.floor((cellNumber - 1) / 25);
    return ZONE_COLORS[zoneIndex % ZONE_COLORS.length].primary;
  };

  /** 셀 데이터를 그리드 형태로 변환 (100칸 고정) */
  const getCellForNumber = (num: number): CellData | null => {
    return cells.find((c) => c.cellNumber === num) || null;
  };

  const getCellStatusStyle = (cell: CellData | null): string => {
    if (!cell) return 'border-gray-800/50 bg-gray-900/20 opacity-30';

    switch (cell.status) {
      case 'assigned':
        return 'border-gray-600 bg-gray-900/60';
      case 'packing':
        return 'border-yellow-500 bg-yellow-500/10';
      case 'completed':
        return 'border-green-500/60 bg-green-500/5 opacity-50';
      case 'hold':
      case 'replenish':
        return 'border-orange-500 bg-orange-500/10 animate-pulse';
      default:
        return 'border-gray-600 bg-gray-900/60';
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

          <ScanBarcode className="w-5 h-5 text-gray-500" />
          <input
            ref={scanInputRef}
            type="text"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={handleScan}
            placeholder="운송장 바코드 스캔..."
            className="w-64 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
            autoFocus
          />

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
            placeholder="운송장 번호 직접 입력..."
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

      {/* 셀 그리드 (10x10) */}
      <div className="flex-1 p-3">
        <div className="grid grid-cols-10 gap-1.5 h-full">
          {Array.from({ length: 100 }, (_, i) => i + 1).map((cellNumber) => {
            const cell = getCellForNumber(cellNumber);

            return (
              <div
                key={cellNumber}
                className={`relative flex flex-col items-center justify-center rounded-lg border-2 p-1 min-h-[80px] transition-all duration-200
                  ${getCellStatusStyle(cell)}`}
              >
                {/* 셀 번호 (대형) */}
                <span
                  className="text-2xl font-black leading-none"
                  style={{ color: cell ? getCellZoneColor(cellNumber) : getCellZoneColor(cellNumber) + '30' }}
                >
                  {cellNumber}
                </span>

                {cell && (
                  <>
                    {/* 운송장 번호 (축약) */}
                    <span className="text-[10px] text-gray-500 mt-0.5 truncate w-full text-center">
                      {cell.waybillNumber?.slice(-6)}
                    </span>

                    {/* SKU 수 / 수량 */}
                    <div className="flex items-center gap-1 mt-0.5">
                      <Package className="w-3 h-3 text-gray-500" />
                      <span className="text-xs text-gray-400">
                        {cell.packedSkuCount}/{cell.totalSkuCount}
                      </span>
                      <span className="text-xs font-bold text-white">
                        x{cell.totalQuantity}
                      </span>
                    </div>

                    {/* 고객명 */}
                    <span className="text-[9px] text-gray-600 truncate w-full text-center">
                      {cell.customerName}
                    </span>

                    {/* 상태 아이콘 */}
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
