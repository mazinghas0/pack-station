'use client';

import { useState, useCallback } from 'react';
import { X, Search, MapPin, Package, User } from 'lucide-react';
import { searchCells, type CellData } from '@/lib/firestore';
import { ZONE_COLORS } from '@/lib/types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<CellData[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    const trimmed = keyword.trim();
    if (!trimmed) return;

    setSearching(true);
    setSearched(false);

    const found = await searchCells(trimmed);
    setResults(found);
    setSearched(true);
    setSearching(false);
  }, [keyword]);

  const getCellZoneColor = (cellNumber: number): string => {
    const zoneIndex = Math.floor((cellNumber - 1) / 25);
    return ZONE_COLORS[zoneIndex % ZONE_COLORS.length].primary;
  };

  const getStationNum = (stationId: string): string => {
    return stationId.replace('station-', '');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl mx-4">
        {/* 헤더 */}
        <div className="sticky top-0 flex items-center justify-between p-5 border-b border-gray-800 bg-gray-900 rounded-t-2xl z-10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-400" />
            통합 검색
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 검색 입력 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="운송장번호, 고객명, 상품명, 바코드..."
              className="flex-1 px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <button
              onClick={handleSearch}
              disabled={searching || !keyword.trim()}
              className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:bg-gray-800 disabled:text-gray-600"
            >
              {searching ? '검색 중...' : '검색'}
            </button>
          </div>

          <p className="text-xs text-gray-600">전체 스테이션에서 검색합니다. 운송장번호, 고객명, 상품명, 바코드 모두 가능합니다.</p>

          {/* 검색 결과 */}
          {searched && results.length === 0 && (
            <div className="text-center py-12 text-gray-600">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>검색 결과가 없습니다.</p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-400">{results.length}건 검색됨</p>

              {results.map((cell) => (
                <div
                  key={cell.id}
                  className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50 space-y-2"
                >
                  {/* 위치 정보 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MapPin className="w-4 h-4 text-blue-400" />
                      <span className="text-white font-medium">
                        스테이션 {getStationNum(cell.stationId)}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-sm font-bold"
                        style={{
                          backgroundColor: getCellZoneColor(cell.cellNumber) + '20',
                          color: getCellZoneColor(cell.cellNumber),
                        }}
                      >
                        셀 {cell.cellNumber}번
                      </span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                      ${cell.status === 'assigned' ? 'bg-blue-500/20 text-blue-400' : ''}
                      ${cell.status === 'packing' ? 'bg-yellow-500/20 text-yellow-400' : ''}
                      ${cell.status === 'completed' ? 'bg-green-500/20 text-green-400' : ''}
                      ${cell.status === 'hold' ? 'bg-orange-500/20 text-orange-400' : ''}
                    `}>
                      {cell.status === 'assigned' ? '배정' : ''}
                      {cell.status === 'packing' ? '작업중' : ''}
                      {cell.status === 'completed' ? '완료' : ''}
                      {cell.status === 'hold' ? '보충대기' : ''}
                    </span>
                  </div>

                  {/* 운송장 + 고객 */}
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-400 font-mono">{cell.waybillNumber}</span>
                    <span className="flex items-center gap-1 text-gray-500">
                      <User className="w-3 h-3" />
                      {cell.customerName}
                    </span>
                  </div>

                  {/* 상품 목록 */}
                  {cell.products && cell.products.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {cell.products.map((p, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-700/50 text-xs text-gray-300"
                        >
                          <Package className="w-3 h-3 text-gray-500" />
                          {p.productName}
                          <span className="font-bold text-white">x{p.requiredQuantity}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
