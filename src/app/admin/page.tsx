'use client';

import { useState, useCallback, useEffect } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Database, Shield, BookOpen, Clock, Trash2, BarChart2, LayoutDashboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ParsedExcelData, UploadSummary, DailyBriefing } from '@/lib/types';
import { ZONE_COLORS } from '@/lib/types';
import { saveUpload, getActiveUpload, getRecentUploads, setActiveUpload, subscribeToAllStations, generateDailyBriefing, getDailyBriefings, cleanupOldDailyReports, autoAssignToStation, getDataStats, deleteUploadBatch, settleUploadBatches, type StationSummary } from '@/lib/firestore';
import { useAuth } from '@/components/authProvider';
import { canManageAccounts, canDeleteData } from '@/lib/auth';
import AccountModal from '@/components/accountModal';
import StationGridCard from '@/components/stationGridCard';
import UploadPanel from '@/components/uploadPanel';
import AutoAssignCard from '@/components/autoAssignCard';
import RecentBatchesCard from '@/components/recentBatchesCard';

export default function AdminPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState(process.env.NEXT_PUBLIC_EXCEL_DEFAULT_PASSWORD || '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedExcelData | null>(null);
  const [savedUploadId, setSavedUploadId] = useState<string | null>(null);
  const [stationStats, setStationStats] = useState<StationSummary[]>([]);
  const [existingUpload, setExistingUpload] = useState<{ fileName: string; totalOrders: number; totalQuantity: number; uniqueProducts: number; uniqueWaybills: number } | null>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<UploadSummary[]>([]);
  const [briefings, setBriefings] = useState<DailyBriefing[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'briefing' | 'data'>('dashboard');
  const [selectedUploadIds, setSelectedUploadIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [closingDay, setClosingDay] = useState(false);
  const [autoAssignConfig, setAutoAssignConfig] = useState([
    { stationId: 'station-1', label: '스테이션 1', count: 99 },
    { stationId: 'station-2', label: '스테이션 2', count: 99 },
  ]);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [dataStats, setDataStats] = useState<{ cells: number; orders: number; uploads: number; oldestReport: string | null } | null>(null);
  const [uploadCollapsed, setUploadCollapsed] = useState(true);
  const { user: currentUser } = useAuth();

  /** 활성 배차 + 최근 업로드 목록 + 브리핑 로드 / 24시간 만료 데이터 백그라운드 정리 */
  useEffect(() => {
    (async () => {
      const [active, recent, briefs] = await Promise.all([
        getActiveUpload(),
        getRecentUploads(),
        getDailyBriefings(),
      ]);
      if (active) {
        setExistingUpload(active);
        setSavedUploadId(active.id);
        setActiveUploadId(active.id);
      }
      setRecentUploads(recent);
      setBriefings(briefs);
      cleanupOldDailyReports().catch(() => {});
      getDataStats().then(setDataStats).catch(() => {});
    })();
  }, []);

  /** 스테이션 현황 실시간 구독 — 활성 배차 기준 */
  useEffect(() => {
    if (!activeUploadId) return;
    const unsubscribe = subscribeToAllStations(activeUploadId, (stats) => {
      setStationStats(stats);
    });
    return () => unsubscribe();
  }, [activeUploadId]);

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

  const handleActivateUpload = useCallback(async (uploadId: string, fileName: string) => {
    try {
      await setActiveUpload(uploadId, fileName);
      setActiveUploadId(uploadId);
      const upload = recentUploads.find((u) => u.id === uploadId);
      if (upload) {
        setExistingUpload(upload);
        setSavedUploadId(uploadId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '배차 활성화 실패 — 다시 시도해주세요');
    }
  }, [recentUploads]);

  const handleSaveToFirebase = useCallback(async () => {
    if (!parsedData) return;
    if (stationStats.some((s) => s.total > 0)) {
      const ok = confirm(
        '현재 스테이션에 작업 중인 데이터가 있습니다.\n새 배차를 저장하면 스테이션 작업 화면이 새 배차로 전환됩니다.\n계속하시겠습니까?'
      );
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const uploadId = await saveUpload(parsedData);
      setSavedUploadId(uploadId);
      setActiveUploadId(uploadId);
      const recent = await getRecentUploads();
      setRecentUploads(recent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Firebase 저장 실패');
    } finally {
      setSaving(false);
    }
  }, [parsedData, stationStats]);

  const handleCloseDay = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ok = confirm(
      `오늘(${today}) 작업을 마감하시겠습니까?\n모든 배차 데이터가 정리되고 데일리 브리핑이 저장됩니다.`
    );
    if (!ok) return;
    setClosingDay(true);
    setError(null);
    try {
      const briefing = await generateDailyBriefing(today);
      setBriefings((prev) => [briefing, ...prev]);
      setRecentUploads([]);
      setExistingUpload(null);
      setSavedUploadId(null);
      setActiveUploadId(null);
      setActiveTab('briefing');
    } catch (err) {
      setError(err instanceof Error ? err.message : '마감 처리 실패 — 다시 시도해주세요');
    } finally {
      setClosingDay(false);
    }
  }, []);

  const handleAutoAssign = useCallback(async () => {
    if (!activeUploadId) return;
    setAutoAssigning(true);
    setAutoAssignResult(null);
    try {
      let totalAssigned = 0;
      for (const cfg of autoAssignConfig) {
        if (cfg.count <= 0) continue;
        const result = await autoAssignToStation(activeUploadId, cfg.stationId, cfg.count);
        totalAssigned += result.assigned;
      }
      setAutoAssignResult(`완료: 총 ${totalAssigned}건 자동 배차되었습니다.`);
    } catch (err) {
      setAutoAssignResult(`오류: ${err instanceof Error ? err.message : '자동 배차 실패'}`);
    } finally {
      setAutoAssigning(false);
    }
  }, [activeUploadId, autoAssignConfig]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedUploadIds.size === 0) return;
    const ok = confirm(`선택한 ${selectedUploadIds.size}개 배차 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
    if (!ok) return;
    setDeleting(true);
    setError(null);
    const targets = Array.from(selectedUploadIds);
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of targets) {
      try {
        await deleteUploadBatch(id);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : '삭제 실패' });
      }
    }
    try {
      const recent = await getRecentUploads();
      setRecentUploads(recent);
      setSelectedUploadIds(new Set(failed.map((f) => f.id)));
      if (activeUploadId && succeeded.includes(activeUploadId)) {
        setActiveUploadId(null);
        setExistingUpload(null);
        setSavedUploadId(null);
      }
      getDataStats().then(setDataStats).catch(() => {});
      if (failed.length > 0) {
        setError(`${succeeded.length}건 성공, ${failed.length}건 실패 — ${failed[0].error}`);
      }
    } finally {
      setDeleting(false);
    }
  }, [selectedUploadIds, activeUploadId]);

  const handleSettleAndDelete = useCallback(async () => {
    if (selectedUploadIds.size === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const ok = confirm(`선택한 ${selectedUploadIds.size}개 배차를 정산하고 삭제하시겠습니까?`);
    if (!ok) return;
    setDeleting(true);
    setError(null);
    const targets = Array.from(selectedUploadIds);
    try {
      await settleUploadBatches(targets, today);
      const [recent, briefs] = await Promise.all([getRecentUploads(), getDailyBriefings()]);
      setRecentUploads(recent);
      setBriefings(briefs);
      setSelectedUploadIds(new Set());
      if (activeUploadId && targets.includes(activeUploadId)) {
        setActiveUploadId(null);
        setExistingUpload(null);
        setSavedUploadId(null);
      }
      getDataStats().then(setDataStats).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : '정산 실패 — 다시 시도해주세요');
    } finally {
      setDeleting(false);
    }
  }, [selectedUploadIds, activeUploadId]);

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
    <main className="min-h-screen bg-black p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 — 컴팩트 한 줄 */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-white leading-tight">관리자 대시보드</h1>
            {dataStats && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                <span>셀 <span className={`font-semibold ${dataStats.cells > 500 ? 'text-orange-400' : 'text-gray-300'}`}>{dataStats.cells.toLocaleString()}</span></span>
                <span>주문 <span className="font-semibold text-gray-300">{dataStats.orders.toLocaleString()}</span></span>
                <span>배차 <span className="font-semibold text-gray-300">{dataStats.uploads}</span></span>
                {activeUploadId && existingUpload && (
                  <span className="text-blue-400 truncate max-w-[200px]">● {existingUpload.fileName}</span>
                )}
              </div>
            )}
          </div>

          {canManageAccounts(currentUser) && (
            <button
              onClick={() => setShowAccountModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors text-sm"
            >
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">계정</span>
            </button>
          )}

          <button
            onClick={handleCloseDay}
            disabled={closingDay || recentUploads.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-600/20 hover:bg-orange-600/40 border border-orange-500/30 text-orange-400 hover:text-orange-300 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {closingDay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
            <span className="hidden sm:inline">{closingDay ? '마감 중' : '오늘 마감'}</span>
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mb-4 border-b border-gray-800">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'dashboard'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            대시보드
          </button>
          <button
            onClick={() => setActiveTab('briefing')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'briefing'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            데일리 브리핑
            {briefings.length > 0 && (
              <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400">
                {briefings.length}
              </span>
            )}
          </button>
          {canDeleteData(currentUser) && (
            <button
              onClick={() => setActiveTab('data')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === 'data'
                  ? 'border-red-500 text-red-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Database className="w-4 h-4" />
              데이터 관리
            </button>
          )}
        </div>

        {/* 대시보드 탭 — Bento 레이아웃 */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 좌측 2/3 — 스테이션 실시간 현황 */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold text-white">스테이션 실시간 현황</h2>
                {stationStats.length > 0 && (
                  <span className="text-xs text-gray-500">
                    {stationStats.filter((s) => s.total > 0).length} / {stationStats.length} 가동
                  </span>
                )}
              </div>

              {stationStats.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {stationStats.map((stat) => (
                    <StationGridCard
                      key={stat.stationId}
                      stat={stat}
                      onNavigate={(num) => router.push(`/station/${num}`)}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-10 rounded-xl border border-gray-800 bg-gray-900/30 text-center">
                  <p className="text-gray-500 text-sm">작업 중인 스테이션이 없습니다</p>
                  <p className="text-gray-700 text-xs mt-1">엑셀 업로드 후 스캔을 시작하면 실시간 표시됩니다</p>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-red-400 text-xs">{error}</p>
                </div>
              )}
            </div>

            {/* 우측 1/3 — 자동 배차 + 업로드 + 최근 기록 */}
            <div className="space-y-3">
              <AutoAssignCard
                activeUploadId={activeUploadId}
                config={autoAssignConfig}
                onConfigChange={setAutoAssignConfig}
                onRun={handleAutoAssign}
                running={autoAssigning}
                result={autoAssignResult}
              />

              <UploadPanel
                collapsed={uploadCollapsed}
                onToggleCollapsed={() => setUploadCollapsed((v) => !v)}
                file={file}
                password={password}
                onFileSelect={handleFileSelect}
                onPasswordChange={setPassword}
                onUpload={handleUpload}
                onSaveToFirebase={handleSaveToFirebase}
                onDrop={handleDrop}
                parsedData={parsedData}
                existingUpload={existingUpload}
                savedUploadId={savedUploadId}
                loading={loading}
                saving={saving}
                error={error}
              />

              <RecentBatchesCard
                uploads={recentUploads}
                activeUploadId={activeUploadId}
                onActivate={handleActivateUpload}
                maxRows={3}
              />
            </div>
          </div>
        )}

        {/* 데이터 관리 탭 — 마스터 전용 */}
        {activeTab === 'data' && canDeleteData(currentUser) && (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/60">
                <p className="text-sm font-medium text-gray-300">배차 목록</p>
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 accent-red-500"
                    checked={selectedUploadIds.size === recentUploads.length && recentUploads.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedUploadIds(new Set(recentUploads.map((u) => u.id)));
                      } else {
                        setSelectedUploadIds(new Set());
                      }
                    }}
                  />
                  전체 선택
                </label>
              </div>
              {recentUploads.length === 0 ? (
                <div className="p-8 text-center text-gray-600 text-sm">배차 데이터가 없습니다</div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {recentUploads.map((u) => (
                    <label key={u.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-800/40 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-red-500 shrink-0"
                        checked={selectedUploadIds.has(u.id)}
                        onChange={(e) => {
                          const next = new Set(selectedUploadIds);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          setSelectedUploadIds(next);
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">{u.fileName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          운송장 {u.uniqueWaybills}건 · 상품 {u.totalQuantity}개
                          {u.id === activeUploadId && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">활성</span>
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-gray-600 shrink-0">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString('ko-KR') : ''}
                      </p>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {selectedUploadIds.size > 0 && (
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleSettleAndDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600/20 hover:bg-orange-600/40 border border-orange-500/30 text-orange-400 text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
                  정산 후 삭제 ({selectedUploadIds.size}개)
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  선택 삭제 ({selectedUploadIds.size}개)
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* 데일리 브리핑 탭 */}
        {activeTab === 'briefing' && (
          <div className="space-y-6">
            {briefings.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-16 rounded-xl border border-gray-800 bg-gray-900/30">
                <BookOpen className="w-16 h-16 text-gray-700 mb-4" />
                <p className="text-gray-600 text-center">
                  데일리 브리핑이 없습니다<br />
                  <span className="text-sm text-gray-700">오늘 마감 버튼을 눌러 하루 작업을 마감하면 여기에 기록됩니다</span>
                </p>
              </div>
            ) : (
              briefings.map((b) => (
                <div key={b.date} className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
                    <div className="flex items-center gap-3">
                      <BookOpen className="w-5 h-5 text-orange-400" />
                      <span className="text-lg font-semibold text-white">{b.date}</span>
                    </div>
                    <div className="flex gap-4 text-sm text-gray-400">
                      <span>운송장 <strong className="text-white">{b.totals.waybills.toLocaleString()}건</strong></span>
                      <span>수량 <strong className="text-white">{b.totals.quantity.toLocaleString()}개</strong></span>
                      <span>배차 <strong className="text-white">{b.totals.batchCount}회</strong></span>
                    </div>
                  </div>

                  {b.batches.length > 0 && (
                    <div className="px-6 py-4 border-b border-gray-800">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">배차 내역</p>
                      <div className="space-y-2">
                        {b.batches.map((batch) => (
                          <div key={batch.uploadId} className="flex items-center justify-between text-sm">
                            <span className="text-gray-300 truncate max-w-xs">{batch.fileName}</span>
                            <div className="flex gap-4 text-gray-500 shrink-0">
                              <span>{batch.totalWaybills.toLocaleString()}건</span>
                              <span>{batch.totalQuantity.toLocaleString()}개</span>
                              <span>{batch.totalSku} SKU</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {b.stations.length > 0 && (
                    <div className="px-6 py-4">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">스테이션별 실적</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {b.stations.map((s) => {
                          const stationNum = parseInt(s.stationId.replace('station-', ''));
                          const color = ZONE_COLORS[(stationNum - 1) % ZONE_COLORS.length];
                          return (
                            <div
                              key={s.stationId}
                              className="p-3 rounded-lg border text-sm"
                              style={{ borderColor: color.primary + '40', backgroundColor: color.background + '20' }}
                            >
                              <p className="font-semibold text-white mb-2" style={{ color: color.primary }}>
                                스테이션 {stationNum}
                              </p>
                              <p className="text-gray-300">{s.processedWaybills.toLocaleString()}건</p>
                              <p className="text-gray-400 text-xs">{s.totalQuantity.toLocaleString()}개</p>
                              {s.holdCount > 0 && (
                                <p className="text-orange-400 text-xs">보류 {s.holdCount}건</p>
                              )}
                              {s.workDurationMinutes !== null && (
                                <p className="text-gray-500 text-xs mt-1">
                                  {Math.floor(s.workDurationMinutes / 60) > 0
                                    ? `${Math.floor(s.workDurationMinutes / 60)}시간 ${s.workDurationMinutes % 60}분`
                                    : `${s.workDurationMinutes}분`}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <AccountModal
          isOpen={showAccountModal}
          onClose={() => setShowAccountModal(false)}
          currentUsername={currentUser?.username || ''}
          currentRole={currentUser?.role || 'worker'}
        />
      </div>
    </main>
  );
}
