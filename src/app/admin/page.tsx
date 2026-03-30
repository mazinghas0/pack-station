'use client';

import { useState, useCallback, useEffect } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, ArrowLeft, Loader2, Database, Monitor, Shield, BookOpen, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ParsedExcelData, UploadSummary, DailyBriefing } from '@/lib/types';
import { ZONE_COLORS } from '@/lib/types';
import { saveUpload, getActiveUpload, getRecentUploads, setActiveUpload, subscribeToAllStations, generateDailyBriefing, getDailyBriefings, cleanupExpiredUploads, cleanupOldDailyReports, autoAssignToStation, getDataStats, type StationSummary } from '@/lib/firestore';
import { useAuth } from '@/components/authProvider';
import { canManageAccounts } from '@/lib/auth';
import AccountModal from '@/components/accountModal';

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
  const [activeTab, setActiveTab] = useState<'upload' | 'briefing'>('upload');
  const [closingDay, setClosingDay] = useState(false);
  const [autoAssignConfig, setAutoAssignConfig] = useState([
    { stationId: 'station-1', label: '스테이션 1', count: 99 },
    { stationId: 'station-2', label: '스테이션 2', count: 99 },
  ]);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [dataStats, setDataStats] = useState<{ cells: number; orders: number; uploads: number; oldestReport: string | null } | null>(null);
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
      cleanupExpiredUploads().catch(() => {}); // 백그라운드 실행, 오류 무시
      cleanupOldDailyReports().catch(() => {}); // 30일 초과 브리핑 정리
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

  /** 이전 배차 활성화 */
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

  /** Firebase에 데이터 저장 */
  const handleSaveToFirebase = useCallback(async () => {
    if (!parsedData) return;

    /** 진행 중인 배차가 있을 경우 경고 */
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

  /** 하루 마감 — 브리핑 생성 후 모든 원본 데이터 삭제 */
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

  /** 자동 배차 — 미배차 운송장을 스테이션별로 지정 건수만큼 자동 셀 배정 */
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
      <div className="max-w-6xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-wrap items-center gap-3 md:gap-4 mb-6 md:mb-8">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-white">관리자</h1>
            <p className="text-gray-500 text-sm md:text-base">엑셀 업로드 및 스테이션 현황 모니터링</p>
          </div>

          {canManageAccounts(currentUser) && (
            <button
              onClick={() => setShowAccountModal(true)}
              className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors text-sm"
            >
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">계정 관리</span>
              <span className="sm:hidden">계정</span>
            </button>
          )}

          <button
            onClick={handleCloseDay}
            disabled={closingDay || recentUploads.length === 0}
            className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg bg-orange-600/20 hover:bg-orange-600/40 border border-orange-500/30 text-orange-400 hover:text-orange-300 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {closingDay ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Clock className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{closingDay ? '마감 중...' : '오늘 마감'}</span>
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mb-6 border-b border-gray-800">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'upload'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <Upload className="w-4 h-4" />
            배차 관리
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
        </div>

        {activeTab === 'upload' && (<>
        {/* Firestore 데이터 현황 */}
        {dataStats && (
          <div className="flex flex-wrap gap-3 mb-6 p-4 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="flex items-center gap-2 text-sm">
              <Database className="w-4 h-4 text-gray-500" />
              <span className="text-gray-500">DB 현황</span>
            </div>
            <div className="flex flex-wrap gap-4 ml-auto">
              <span className="text-sm text-gray-400">
                셀 <span className={`font-bold ${dataStats.cells > 500 ? 'text-orange-400' : 'text-white'}`}>{dataStats.cells.toLocaleString()}</span>건
              </span>
              <span className="text-sm text-gray-400">
                주문 <span className="font-bold text-white">{dataStats.orders.toLocaleString()}</span>건
              </span>
              <span className="text-sm text-gray-400">
                배차 <span className="font-bold text-white">{dataStats.uploads}</span>개
              </span>
              {dataStats.oldestReport && (
                <span className="text-sm text-gray-400">
                  마지막 마감 <span className="font-bold text-white">{dataStats.oldestReport}</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
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
                type="password"
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

                <div className="grid grid-cols-2 gap-3 md:gap-4">
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

          <div className="mt-8 md:mt-12">
            <h2 className="text-lg md:text-xl font-semibold text-white mb-4 md:mb-6">스테이션 실시간 현황</h2>

            {stationStats.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
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
                        <span className="font-semibold text-white flex-1">스테이션 {stationNum}</span>
                        <button
                          onClick={() => router.push(`/station/${stationNum}`)}
                          className="text-xs px-2 py-0.5 rounded hover:opacity-80 transition-opacity font-medium"
                          style={{ backgroundColor: color.primary + '30', color: color.primary }}
                        >
                          이동
                        </button>
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

          {/* 배차 기록 */}
          <div className="mt-8 md:mt-12">
            <h2 className="text-lg md:text-xl font-semibold text-white mb-4 md:mb-6">배차 기록</h2>
            {recentUploads.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/50">
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">파일명</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium">운송장</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium">수량</th>
                      <th className="text-center px-4 py-3 text-gray-500 font-medium">활성화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentUploads.map((upload) => {
                      const isActive = upload.id === activeUploadId;
                      return (
                        <tr key={upload.id} className="border-b border-gray-800/50 hover:bg-gray-900/30">
                          <td className="px-4 py-3 text-white">
                            {isActive && (
                              <span className="mr-2 text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">활성</span>
                            )}
                            {upload.fileName}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-300">{upload.uniqueWaybills.toLocaleString()}건</td>
                          <td className="px-4 py-3 text-right text-gray-300">{upload.totalQuantity.toLocaleString()}개</td>
                          <td className="px-4 py-3 text-center">
                            {isActive ? (
                              <span className="text-xs text-gray-600">현재 배차</span>
                            ) : (
                              <button
                                onClick={() => handleActivateUpload(upload.id, upload.fileName)}
                                className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-blue-600/30 text-gray-400 hover:text-blue-300 transition-colors"
                              >
                                활성화
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 rounded-xl border border-gray-800 bg-gray-900/30 text-center">
                <p className="text-gray-600">업로드 기록이 없습니다</p>
              </div>
            )}
          </div>
          {/* 자동 배차 */}
          <div className="mt-8 md:mt-12">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg md:text-xl font-semibold text-white">자동 배차</h2>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-500">사전 배치 / 테스트용</span>
            </div>

            {!activeUploadId ? (
              <div className="p-6 rounded-xl border border-gray-800 bg-gray-900/30 text-center">
                <p className="text-gray-600 text-sm">활성 배차가 없습니다. 먼저 엑셀을 업로드하세요.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-5 space-y-4">
                <p className="text-sm text-gray-500">
                  미배차 운송장을 스캔 없이 스테이션에 바로 배정합니다. 이미 배차된 운송장은 건너뜁니다.
                </p>

                {/* 스테이션별 건수 설정 */}
                <div className="space-y-3">
                  {autoAssignConfig.map((cfg, i) => (
                    <div key={cfg.stationId} className="flex items-center gap-3">
                      <span className="text-sm text-gray-300 w-24 shrink-0">{cfg.label}</span>
                      <input
                        type="number"
                        min={0}
                        max={9999}
                        value={cfg.count}
                        onChange={(e) => {
                          const next = [...autoAssignConfig];
                          next[i] = { ...cfg, count: Math.max(0, Number(e.target.value)) };
                          setAutoAssignConfig(next);
                        }}
                        className="w-24 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-sm text-gray-500">건</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleAutoAssign}
                  disabled={autoAssigning}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:bg-gray-800 disabled:text-gray-600"
                >
                  {autoAssigning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      배차 중...
                    </>
                  ) : (
                    '자동 배차 실행'
                  )}
                </button>

                {autoAssignResult && (
                  <p className={`text-sm ${autoAssignResult.startsWith('오류') ? 'text-red-400' : 'text-green-400'}`}>
                    {autoAssignResult}
                  </p>
                )}
              </div>
            )}
          </div>
        </>)}

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
                  {/* 날짜 헤더 */}
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

                  {/* 배차별 요약 */}
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

                  {/* 스테이션별 작업 시간 */}
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

        {/* 계정 관리 모달 */}
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
