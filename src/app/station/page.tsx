'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Monitor } from 'lucide-react';
import { ZONE_COLORS } from '@/lib/types';

/** 스테이션 선택 페이지 */
export default function StationSelectPage() {
  const router = useRouter();

  const stations = Array.from({ length: 6 }, (_, i) => ({
    id: `station-${i + 1}`,
    number: i + 1,
    color: ZONE_COLORS[i % ZONE_COLORS.length],
  }));

  return (
    <main className="min-h-screen bg-black p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 md:gap-4 mb-8 md:mb-12">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-400" />
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">스테이션 선택</h1>
            <p className="text-gray-500 text-sm md:text-base">작업할 스테이션을 선택하세요</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
          {stations.map((station) => (
            <button
              key={station.id}
              onClick={() => router.push(`/station/${station.number}`)}
              className="group relative flex flex-col items-center gap-2 md:gap-4 p-5 md:p-8 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.02]"
              style={{
                borderColor: station.color.primary + '60',
                backgroundColor: station.color.background + '30',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = station.color.primary;
                e.currentTarget.style.backgroundColor = station.color.background + '60';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = station.color.primary + '60';
                e.currentTarget.style.backgroundColor = station.color.background + '30';
              }}
            >
              <Monitor
                className="w-10 md:w-14 h-10 md:h-14 transition-colors"
                style={{ color: station.color.primary }}
              />
              <span className="text-xl md:text-3xl font-bold text-white">
                스테이션 {station.number}
              </span>
              <span
                className="text-sm px-3 py-1 rounded-full"
                style={{
                  backgroundColor: station.color.primary + '20',
                  color: station.color.primary,
                }}
              >
                {station.color.label} 구역
              </span>
              {/* 상태 표시 (Firebase 연결 후 동적으로) */}
              <span className="text-xs text-gray-600">대기 중</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
