'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getCurrentUser, initMasterAccount, type UserInfo } from '@/lib/auth';

interface AuthContextType {
  user: UserInfo | null;
  setUser: (user: UserInfo | null) => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  isLoading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      /** 마스터 계정 초기화 */
      try {
        await initMasterAccount();
      } catch {
        /** Firebase 미연결 시 무시 */
      }

      /** 저장된 세션 확인 */
      const currentUser = getCurrentUser();
      setUser(currentUser);
      setIsLoading(false);

      /** 로그인 페이지가 아닌데 로그인 안 되어 있으면 리다이렉트 */
      if (!currentUser && pathname !== '/login') {
        router.push('/login');
      }
    })();
  }, [pathname, router]);

  /** 로그인 안 되어 있고 로그인 페이지가 아니면 로딩 표시 */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  /** 로그인 페이지는 인증 없이 접근 가능 */
  if (pathname === '/login') {
    return (
      <AuthContext.Provider value={{ user, setUser, isLoading }}>
        {children}
      </AuthContext.Provider>
    );
  }

  /** 로그인 안 되어 있으면 빈 화면 (리다이렉트 중) */
  if (!user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-500">로그인 페이지로 이동 중...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
