'use client';

import { useRouter } from 'next/navigation';
import { Package, Monitor, Settings, LogOut, User } from 'lucide-react';
import { useAuth } from '@/components/authProvider';
import { logout, canAccessAdmin } from '@/lib/auth';

export default function HomePage() {
  const router = useRouter();
  const { user, setUser } = useAuth();

  const handleLogout = () => {
    logout();
    setUser(null);
    router.push('/login');
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-black p-6 md:p-8">
      {/* 우측 상단 사용자 정보 */}
      <div className="absolute top-4 right-4 md:top-6 md:right-6 flex items-center gap-2 md:gap-3">
        <div className="flex items-center gap-2 text-gray-400">
          <User className="w-4 h-4" />
          <span className="text-xs md:text-sm">{user?.name} ({user?.role})</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">로그아웃</span>
        </button>
      </div>

      <div className="text-center mb-10 md:mb-16">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Package className="w-10 md:w-12 h-10 md:h-12 text-blue-400" />
          <h1 className="text-3xl md:text-5xl font-bold text-white">Pack Station</h1>
        </div>
        <p className="text-lg md:text-xl text-gray-400">합포장 오더분배 시스템</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-2xl w-full">
        {/* 관리자 버튼 (마스터/관리자만) */}
        {canAccessAdmin(user) && (
          <button
            onClick={() => router.push('/admin')}
            className="group flex flex-col items-center gap-4 p-10 rounded-2xl border-2 border-gray-700 hover:border-blue-500 bg-gray-900/50 hover:bg-gray-900 transition-all duration-200"
          >
            <Settings className="w-16 h-16 text-gray-400 group-hover:text-blue-400 transition-colors" />
            <span className="text-2xl font-semibold text-gray-200 group-hover:text-white">관리자</span>
            <span className="text-sm text-gray-500">엑셀 업로드 / 스테이션 관리 / 현황</span>
          </button>
        )}

        <button
          onClick={() => router.push('/station')}
          className="group flex flex-col items-center gap-4 p-10 rounded-2xl border-2 border-gray-700 hover:border-green-500 bg-gray-900/50 hover:bg-gray-900 transition-all duration-200"
        >
          <Monitor className="w-16 h-16 text-gray-400 group-hover:text-green-400 transition-colors" />
          <span className="text-2xl font-semibold text-gray-200 group-hover:text-white">스테이션</span>
          <span className="text-sm text-gray-500">작업 스테이션 선택 후 진입</span>
        </button>
      </div>

      <footer className="mt-16 text-gray-600 text-sm">
        Pack Station v1.0
      </footer>
    </main>
  );
}
