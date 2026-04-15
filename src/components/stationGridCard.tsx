'use client';

import { Monitor, ExternalLink } from 'lucide-react';
import { ZONE_COLORS } from '@/lib/types';
import type { StationSummary } from '@/lib/firestore';

interface StationGridCardProps {
  stat: StationSummary;
  onNavigate: (stationNum: number) => void;
}

export default function StationGridCard({ stat, onNavigate }: StationGridCardProps) {
  const stationNum = parseInt(stat.stationId.replace('station-', ''));
  const color = ZONE_COLORS[(stationNum - 1) % ZONE_COLORS.length];
  const progress = stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 0;
  const workingCount = stat.total - stat.completed - stat.hold;

  return (
    <button
      type="button"
      onClick={() => onNavigate(stationNum)}
      className="group text-left p-4 md:p-5 rounded-xl border transition-all hover:scale-[1.01] hover:shadow-lg"
      style={{ borderColor: color.primary + '40', backgroundColor: color.background + '20' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Monitor className="w-5 h-5" style={{ color: color.primary }} />
        <span className="text-lg font-bold text-white flex-1">스테이션 {stationNum}</span>
        <ExternalLink
          className="w-4 h-4 text-gray-600 group-hover:text-gray-300 transition-colors"
        />
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-4xl md:text-5xl font-bold text-white leading-none">
          {stat.completed}
        </span>
        <span className="text-lg text-gray-500">/ {stat.total}</span>
        <span className="ml-auto text-2xl font-bold" style={{ color: color.primary }}>
          {progress}%
        </span>
      </div>

      <div className="w-full h-2.5 rounded-full bg-gray-800 mb-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${progress}%`, backgroundColor: color.primary }}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs px-2 py-1 rounded bg-green-500/15 text-green-400">
          완료 {stat.completed}
        </span>
        {workingCount > 0 && (
          <span className="text-xs px-2 py-1 rounded bg-blue-500/15 text-blue-400">
            작업중 {workingCount}
          </span>
        )}
        {stat.hold > 0 && (
          <span className="text-xs px-2 py-1 rounded bg-orange-500/20 text-orange-400">
            보충대기 {stat.hold}
          </span>
        )}
        <span className="ml-auto text-xs text-gray-500">수량 {stat.totalQty.toLocaleString()}</span>
      </div>
    </button>
  );
}
