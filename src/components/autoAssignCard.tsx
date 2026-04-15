'use client';

import { Zap, Loader2 } from 'lucide-react';

export interface AutoAssignConfigItem {
  stationId: string;
  label: string;
  count: number;
}

interface AutoAssignCardProps {
  activeUploadId: string | null;
  config: AutoAssignConfigItem[];
  onConfigChange: (next: AutoAssignConfigItem[]) => void;
  onRun: () => void;
  running: boolean;
  result: string | null;
}

export default function AutoAssignCard(props: AutoAssignCardProps) {
  const { activeUploadId, config, onConfigChange, onRun, running, result } = props;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <Zap className="w-4 h-4 text-yellow-400" />
        <span className="text-sm font-semibold text-white flex-1">자동 배차</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">테스트용</span>
      </div>

      {!activeUploadId ? (
        <div className="p-5 text-center">
          <p className="text-xs text-gray-600">활성 배차 없음 — 엑셀 업로드 먼저</p>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="space-y-2">
            {config.map((cfg, i) => (
              <div key={cfg.stationId} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-20 shrink-0">{cfg.label}</span>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={cfg.count}
                  onChange={(e) => {
                    const next = [...config];
                    next[i] = { ...cfg, count: Math.max(0, Number(e.target.value)) };
                    onConfigChange(next);
                  }}
                  className="w-20 px-2 py-1.5 rounded-md bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:border-blue-500"
                />
                <span className="text-xs text-gray-500">건</span>
              </div>
            ))}
          </div>

          <button
            onClick={onRun}
            disabled={running}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:bg-gray-800 disabled:text-gray-600"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                배차 중...
              </>
            ) : (
              '실행'
            )}
          </button>

          {result && (
            <p className={`text-xs ${result.startsWith('오류') ? 'text-red-400' : 'text-green-400'}`}>
              {result}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
