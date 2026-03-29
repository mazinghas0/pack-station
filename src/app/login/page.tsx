'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Loader2, AlertCircle } from 'lucide-react';
import { login } from '@/lib/auth';
import { useAuth } from '@/components/authProvider';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setLoading(true);
    setError(null);

    const result = await login(username.trim(), password);

    if (result.success && result.user) {
      setUser(result.user);
      router.push('/');
    } else {
      setError(result.error || '로그인 실패');
    }

    setLoading(false);
  }, [username, password, router, setUser]);

  return (
    <main className="min-h-screen bg-black flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Package className="w-10 h-10 text-blue-400" />
            <h1 className="text-4xl font-bold text-white">Pack Station</h1>
          </div>
          <p className="text-gray-500">합포장 오더분배 시스템</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm text-gray-400 mb-2">아이디</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="아이디 입력"
              className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-lg"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 입력"
              className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-lg"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full py-4 rounded-xl text-lg font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                로그인 중...
              </span>
            ) : (
              '로그인'
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
