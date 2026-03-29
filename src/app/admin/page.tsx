'use client';

import { useState, useCallback, useEffect } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, ArrowLeft, Loader2, Database, Monitor, UserPlus, Trash2, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ParsedExcelData } from '@/lib/types';
import { ZONE_COLORS } from '@/lib/types';
import { saveUpload, getLatestUpload, subscribeToAllStations, type StationSummary } from '@/lib/firestore';
import { useAuth } from '@/components/authProvider';
import { getAllUsers, createAccount, updateUserRole, deleteAccount, canManageAccounts, type UserInfo, type UserRole } from '@/lib/auth';

export default function AdminPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('skw');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedExcelData | null>(null);
  const [savedUploadId, setSavedUploadId] = useState<string | null>(null);
  const [stationStats, setStationStats] = useState<StationSummary[]>([]);
  const [existingUpload, setExistingUpload] = useState<{ fileName: string; totalOrders: number; totalQuantity: number; uniqueProducts: number; uniqueWaybills: number } | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('worker');
  const [accountMsg, setAccountMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { user: currentUser } = useAuth();

  /** 기존 업로드 기록 로드 */
  useEffect(() => {
    (async () => {
      const upload = await getLatestUpload();
      if (upload) {
        setExistingUpload(upload);
        setSavedUploadId(upload.id);
      }
    })();
  }, []);

  /** 계정 목록 로드 */
  useEffect(() => {
    if (canManageAccounts(currentUser)) {
      loadUsers();
    }
  }, [currentUser]);

  const loadUsers = async () => {
    const userList = await getAllUsers();
    setUsers(userList);
  };

  const handleCreateAccount = async () => {
    if (!newUsername.trim() || !newPassword.trim() || !newName.trim()) {
      setAccountMsg({ type: 'error', text: '모든 항목을 입력해주세요.' });
      return;
    }
    const result = await createAccount(newUsername.trim(), newPassword, newName.trim(), newRole, currentUser?.username || '');
    if (result.success) {
      setAccountMsg({ type: 'success', text: `${newName} 계정이 생성되었습니다.` });
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      setNewRole('worker');
      await loadUsers();
    } else {
      setAccountMsg({ type: 'error', text: result.error || '생성 실패' });
    }
  };

  const handleDeleteAccount = async (username: string) => {
    if (!confirm(`${username} 계정을 삭제하시겠습니까?`)) return;
    const result = await deleteAccount(username);
    if (result.success) {
      setAccountMsg({ type: 'success', text: '계정이 삭제되었습니다.' });
      await loadUsers();
    } else {
      setAccountMsg({ type: 'error', text: result.error || '삭제 실패' });
    }
  };

  const handleRoleChange = async (username: string, role: UserRole) => {
    const result = await updateUserRole(username, role);
    if (result.success) {
      setAccountMsg({ type: 'success', text: '역할이 변경되었습니다.' });
      await loadUsers();
    } else {
      setAccountMsg({ type: 'error', text: result.error || '변경 실패' });
    }
  };

  /** 스테이션 현황 실시간 구독 */
  useEffect(() => {
    const unsubscribe = subscribeToAllStations((stats) => {
      setStationStats(stats);
    });
    return () => unsubscribe();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setParsedData(null);
      setSavedUploadId(null);
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', password);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '업로드 실패');
      }

      setParsedData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, [file, password]);

  /** Firebase에 데이터 저장 */
  const handleSaveToFirebase = useCallback(async () => {
    if (!parsedData) return;

    setSaving(true);
    setError(null);

    try {
      const uploadId = await saveUpload(parsedData);
      setSavedUploadId(uploadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Firebase 저장 실패');
    } finally {
      setSaving(false);
    }
  }, [parsedData]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setError(null);
      setParsedData(null);
      setSavedUploadId(null);
    }
  }, []);

  return (
    <main className="min-h-screen bg-black p-6">
      <div className="max-w-6xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-400" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">관리자</h1>
            <p className="text-gray-500">엑셀 업로드 및 스테이션 현황 모니터링</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 좌측: 엑셀 업로드 */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">출고 엑셀 업로드</h2>

            {/* 드래그앤드롭 영역 */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer
                ${file ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 hover:border-gray-500 bg-gray-900/30'}`}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".xls,.xlsx"
                onChange={handleFileSelect}
                className="hidden"
              />

              {file ? (
                <div className="flex flex-col items-center gap-3">
                  <FileSpreadsheet className="w-12 h-12 text-blue-400" />
                  <p className="text-lg text-white font-medium">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-12 h-12 text-gray-600" />
                  <p className="text-lg text-gray-400">엑셀 파일을 드래그하거나 클릭하여 선택</p>
                  <p className="text-sm text-gray-600">.xls, .xlsx 파일 지원 (암호화 파일 가능)</p>
                </div>
              )}
            </div>

            {/* 비밀번호 입력 */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                엑셀 비밀번호 (암호화된 파일인 경우)
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* 업로드 버튼 */}
            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className={`w-full py-4 rounded-xl text-lg font-semibold transition-all
                ${!file || loading
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  파싱 중...
                </span>
              ) : (
                '업로드 및 분석'
              )}
            </button>

            {/* 에러 메시지 */}
            {error && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <p className="text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* 우측: 파싱 결과 + 저장 */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">분석 결과</h2>

            {(parsedData || existingUpload) ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <p className="text-green-400 font-medium">
                    {parsedData ? `파싱 완료: ${parsedData.fileName}` : `저장된 데이터: ${existingUpload?.fileName}`}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <StatCard label="총 운송장" value={parsedData?.uniqueWaybills ?? existingUpload?.uniqueWaybills ?? 0} unit="건" />
                  <StatCard label="총 수량" value={parsedData?.totalQuantity ?? existingUpload?.totalQuantity ?? 0} unit="개" />
                  <StatCard label="상품 종류" value={parsedData?.uniqueProducts ?? existingUpload?.uniqueProducts ?? 0} unit="SKU" />
                  <StatCard label="주문 라인" value={parsedData?.orders.length ?? existingUpload?.totalOrders ?? 0} unit="행" />
                </div>

                {/* Firebase 저장 버튼 */}
                {savedUploadId ? (
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                    <Database className="w-5 h-5 text-blue-400" />
                    <div>
                      <p className="text-blue-400 font-medium">데이터 저장 완료</p>
                      <p className="text-xs text-blue-400/60">스테이션에서 운송장 스캔을 시작할 수 있습니다</p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleSaveToFirebase}
                    disabled={saving}
                    className="w-full py-4 rounded-xl text-lg font-semibold bg-green-600 hover:bg-green-700 text-white transition-all disabled:bg-gray-800 disabled:text-gray-600"
                  >
                    {saving ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        저장 중...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Database className="w-5 h-5" />
                        데이터 저장 (스테이션 작업 준비)
                      </span>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-16 rounded-xl border border-gray-800 bg-gray-900/30">
                <FileSpreadsheet className="w-16 h-16 text-gray-700 mb-4" />
                <p className="text-gray-600 text-center">
                  엑셀 파일을 업로드하면<br />분석 결과가 여기에 표시됩니다
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 하단: 스테이션 실시간 현황 */}
        <div className="mt-12">
          <h2 className="text-xl font-semibold text-white mb-6">스테이션 실시간 현황</h2>

          {stationStats.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {stationStats.map((stat) => {
                const stationNum = parseInt(stat.stationId.replace('station-', ''));
                const color = ZONE_COLORS[(stationNum - 1) % ZONE_COLORS.length];
                const progress = stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 0;

                return (
                  <div
                    key={stat.stationId}
                    className="p-4 rounded-xl border"
                    style={{ borderColor: color.primary + '40', backgroundColor: color.background + '20' }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Monitor className="w-4 h-4" style={{ color: color.primary }} />
                      <span className="font-semibold text-white">스테이션 {stationNum}</span>
                    </div>

                    <div className="text-3xl font-bold text-white mb-1">
                      {stat.completed}<span className="text-sm text-gray-500">/{stat.total}</span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-gray-800 mb-2">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${progress}%`, backgroundColor: color.primary }}
                      />
                    </div>

                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{progress}%</span>
                      <span>수량: {stat.totalQty}</span>
                    </div>

                    {stat.hold > 0 && (
                      <div className="mt-2 text-xs px-2 py-1 rounded bg-orange-500/20 text-orange-400 text-center">
                        보충 대기 {stat.hold}건
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 rounded-xl border border-gray-800 bg-gray-900/30 text-center">
              <p className="text-gray-600">아직 작업 중인 스테이션이 없습니다</p>
              <p className="text-gray-700 text-sm mt-1">스테이션에서 운송장 스캔을 시작하면 여기에 실시간으로 표시됩니다</p>
            </div>
          )}
        </div>
        {/* 계정 관리 (마스터/관리자만) */}
        {canManageAccounts(currentUser) && (
          <div className="mt-12">
            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-400" />
              계정 관리
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* 좌측: 새 계정 생성 */}
              <div className="p-6 rounded-xl border border-gray-800 bg-gray-900/30">
                <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-green-400" />
                  새 계정 생성
                </h3>

                <div className="space-y-3">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="아이디"
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="비밀번호"
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                  />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="이름 (예: 홍길동)"
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                  />
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-sm"
                  >
                    <option value="worker">작업자 (스테이션 작업만)</option>
                    <option value="admin">관리자 (업로드 + 계정 관리)</option>
                  </select>
                  <button
                    onClick={handleCreateAccount}
                    className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
                  >
                    계정 생성
                  </button>
                </div>

                {accountMsg && (
                  <div className={`mt-3 p-3 rounded-lg text-sm ${accountMsg.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    {accountMsg.text}
                  </div>
                )}
              </div>

              {/* 우측: 계정 목록 */}
              <div className="p-6 rounded-xl border border-gray-800 bg-gray-900/30">
                <h3 className="text-lg font-medium text-white mb-4">등록된 계정</h3>

                {users.length > 0 ? (
                  <div className="space-y-2">
                    {users.map((u) => (
                      <div
                        key={u.username}
                        className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                            ${u.role === 'master' ? 'bg-yellow-500/20 text-yellow-400' : ''}
                            ${u.role === 'admin' ? 'bg-blue-500/20 text-blue-400' : ''}
                            ${u.role === 'worker' ? 'bg-gray-500/20 text-gray-400' : ''}`}
                          >
                            {u.role === 'master' ? '마스터' : u.role === 'admin' ? '관리자' : '작업자'}
                          </span>
                          <div>
                            <span className="text-white text-sm font-medium">{u.name}</span>
                            <span className="text-gray-500 text-xs ml-2">@{u.username}</span>
                          </div>
                        </div>

                        {u.role !== 'master' && currentUser?.role === 'master' && (
                          <div className="flex items-center gap-2">
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.username, e.target.value as UserRole)}
                              className="px-2 py-1 rounded bg-gray-700 text-gray-300 text-xs border-none focus:outline-none"
                            >
                              <option value="worker">작업자</option>
                              <option value="admin">관리자</option>
                            </select>
                            <button
                              onClick={() => handleDeleteAccount(u.username)}
                              className="p-1.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                              title="계정 삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600 text-sm">등록된 계정이 없습니다.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">
        {value.toLocaleString()}
        <span className="text-sm text-gray-500 ml-1">{unit}</span>
      </p>
    </div>
  );
}
