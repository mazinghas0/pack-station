'use client';

import { useState } from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import type { UploadSummary } from '@/lib/types';

interface RecentBatchesCardProps {
  uploads: UploadSummary[];
  activeUploadId: string | null;
  onActivate: (uploadId: string, fileName: string) => void;
  maxRows?: number;
}

export default function RecentBatchesCard(props: RecentBatchesCardProps) {
  const { uploads, activeUploadId, onActivate, maxRows = 3 } = props;
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? uploads : uploads.slice(0, maxRows);
  const hasMore = uploads.length > maxRows;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <History className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-semibold text-white flex-1">최근 배차 기록</span>
        <span className="text-xs text-gray-500">{uploads.length}건</span>
      </div>

      {uploads.length === 0 ? (
        <div className="p-5 text-center">
          <p className="text-xs text-gray-600">기록 없음</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-800/60">
            {visible.map((u) => {
              const isActive = u.id === activeUploadId;
              return (
                <div key={u.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 shrink-0">활성</span>
                      )}
                      <p className="text-xs text-white truncate">{u.fileName}</p>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {u.uniqueWaybills.toLocaleString()}건 · {u.totalQuantity.toLocaleString()}개
                    </p>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => onActivate(u.id, u.fileName)}
                      className="text-[10px] px-2 py-1 rounded bg-gray-800 hover:bg-blue-600/30 text-gray-400 hover:text-blue-300 transition-colors shrink-0"
                    >
                      활성화
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1 px-4 py-2 border-t border-gray-800 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  접기
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  전체 보기 ({uploads.length - maxRows}건 더)
                </>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
