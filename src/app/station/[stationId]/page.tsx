'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ScanBarcode, Package, CheckCircle2 } from 'lucide-react';
import { ZONE_COLORS, type CellStatus } from '@/lib/types';

/** 셀 카드 데모 데이터 (Firebase 연결 전 스켈레톤) */
interface DemoCell {
  cellNumber: number;
  waybillNumber: string | null;
  customerName: string | null;
  totalSkuCount: number;
  packedSkuCount: number;
  totalQuantity: number;
  packedQuantity: number;
  status: CellStatus;
}

export default function StationWorkPage() {
  const params = useParams();
  const router = useRouter();
  const stationId = Number(params.stationId);
  const stationColor = ZONE_COLORS[(stationId - 1) % ZONE_COLORS.length];
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [scanMode, setScanMode] = useState<'waybill' | 'sku'>('waybill');
  const [scanValue, setScanValue] = useState('');
  const [cells, setCells] = useState<DemoCell[]>(() =>
    Array.from({ length: 100 }, (_, i) => ({
      cellNumber: i + 1,
      waybillNumber: null,
      customerName: null,
      totalSkuCount: 0,
      packedSkuCount: 0,
      totalQuantity: 0,
      packedQuantity: 0,
      status: 'empty' as CellStatus,
    }))
  );
  const [scannedCount, setScannedCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState('운송장을 스캔하여 셀에 배정하세요');

  /** 페이지 로드 시 스캔 입력에 포커스 */
  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  /** 스캔 입력 처리 (바코드 스캐너는 엔터로 끝남) */
  const handleScan = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !scanValue.trim()) return;

    if (scanMode === 'waybill') {
      /** 운송장 스캔 모드 */
      const nextEmptyCell = cells.find((c) => c.status === 'empty');
      if (!nextEmptyCell) {
        setStatusMessage('모든 셀이 배정 완료되었습니다');
        setScanValue('');
        return;
      }

      /** 중복 체크 */
      const duplicate = cells.find((c) => c.waybillNumber === scanValue.trim());
      if (duplicate) {
        setStatusMessage(`이미 셀 ${duplicate.cellNumber}번에 등록된 운송장입니다`);
        setScanValue('');
        return;
      }

      /** 셀 배정 */
      setCells((prev) =>
        prev.map((c) =>
          c.cellNumber === nextEmptyCell.cellNumber
            ? {
                ...c,
                waybillNumber: scanValue.trim(),
                customerName: '(Firebase 연결 후 표시)',
                totalSkuCount: 3,
                totalQuantity: 8,
                status: 'assigned' as CellStatus,
              }
            : c
        )
      );
      setScannedCount((prev) => prev + 1);
      setStatusMessage(`셀 ${nextEmptyCell.cellNumber}번에 운송장 배정 완료`);
    }

    setScanValue('');
    scanInputRef.current?.focus();
  }, [scanValue, scanMode, cells]);

  /** 구역 색상 (4색 구역제: 25개씩) */
  const getCellZoneColor = (cellNumber: number): string => {
    const zoneIndex = Math.floor((cellNumber - 1) / 25);
    return ZONE_COLORS[zoneIndex % ZONE_COLORS.length].primary;
  };

  const getCellStatusStyle = (cell: DemoCell) => {
    switch (cell.status) {
      case 'empty':
        return 'border-gray-800 bg-gray-900/30 opacity-40';
      case 'assigned':
        return 'border-gray-600 bg-gray-900/60';
      case 'packing':
        return 'border-yellow-500 bg-yellow-500/10';
      case 'completed':
        return 'border-green-500 bg-green-500/10 opacity-60';
      case 'hold':
        return 'border-orange-500 bg-orange-500/10 animate-pulse';
      case 'replenish':
        return 'border-orange-500 bg-orange-500/10 animate-pulse';
      default:
        return 'border-gray-800 bg-gray-900/30';
    }
  };

  return (
    <main className="min-h-screen bg-black flex flex-col">
      {/* 상단 바 */}
      <header className="no-print flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/station')}
            className="p-2 rounded-lg hover:bg-gray-800"
          >
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div
            className="text-xl font-bold px-3 py-1 rounded-lg"
            style={{ backgroundColor: stationColor.primary + '20', color: stationColor.primary }}
          >
            스테이션 {stationId}
          </div>
        </div>

        {/* 진행률 대형 표시 */}
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
              style={{
                width: `${(scannedCount / 100) * 100}%`,
                backgroundColor: stationColor.primary,
              }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setScanMode('waybill'); scanInputRef.current?.focus(); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${scanMode === 'waybill' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              운송장
            </button>
            <button
              onClick={() => { setScanMode('sku'); scanInputRef.current?.focus(); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${scanMode === 'sku' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              상품(SKU)
            </button>
          </div>
        </div>

        {/* 스캔 입력 */}
        <div className="flex items-center gap-2">
          <ScanBarcode className="w-5 h-5 text-gray-500" />
          <input
            ref={scanInputRef}
            type="text"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={handleScan}
            placeholder={scanMode === 'waybill' ? '운송장 바코드 스캔...' : 'SKU 바코드 스캔...'}
            className="w-64 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
            autoFocus
          />
        </div>
      </header>

      {/* 상태 메시지 */}
      <div className="no-print px-4 py-2 text-center text-sm" style={{ color: stationColor.primary }}>
        {statusMessage}
      </div>

      {/* 셀 그리드 (10x10) */}
      <div className="flex-1 p-3">
        <div className="grid grid-cols-10 gap-1.5 h-full">
          {cells.map((cell) => (
            <div
              key={cell.cellNumber}
              className={`relative flex flex-col items-center justify-center rounded-lg border-2 p-1 min-h-[80px] transition-all duration-200 cursor-pointer hover:scale-[1.02]
                ${getCellStatusStyle(cell)}`}
            >
              {/* 셀 번호 (대형) */}
              <span
                className="text-2xl font-black leading-none"
                style={{ color: getCellZoneColor(cell.cellNumber) }}
              >
                {cell.cellNumber}
              </span>

              {cell.status !== 'empty' && (
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

                  {/* 완료 체크 */}
                  {cell.status === 'completed' && (
                    <CheckCircle2 className="absolute top-1 right-1 w-4 h-4 text-green-400" />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
