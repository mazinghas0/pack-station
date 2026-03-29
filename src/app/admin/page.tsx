'use client';

import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ParsedExcelData } from '@/lib/types';

export default function AdminPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('skw');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedExcelData | null>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setParsedData(null);
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setError(null);
      setParsedData(null);
    }
  }, []);

  return (
    <main className="min-h-screen bg-black p-6">
      {/* 헤더 */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-400" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">관리자</h1>
            <p className="text-gray-500">엑셀 업로드 및 스테이션 관리</p>
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

          {/* 우측: 파싱 결과 */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">분석 결과</h2>

            {parsedData ? (
              <div className="space-y-4">
                {/* 요약 카드 */}
                <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <p className="text-green-400 font-medium">파싱 완료: {parsedData.fileName}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <StatCard label="총 운송장" value={parsedData.uniqueWaybills} unit="건" />
                  <StatCard label="총 수량" value={parsedData.totalQuantity} unit="개" />
                  <StatCard label="상품 종류" value={parsedData.uniqueProducts} unit="SKU" />
                  <StatCard label="주문 라인" value={parsedData.orders.length} unit="행" />
                </div>

                {/* 스테이션 분배 미리보기 */}
                <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
                  <h3 className="text-sm text-gray-400 mb-3">스테이션 분배 예상 (100건/스테이션)</h3>
                  <div className="space-y-2">
                    {Array.from({ length: Math.min(6, Math.ceil(parsedData.uniqueWaybills / 100)) }).map((_, i) => {
                      const start = i * 100 + 1;
                      const end = Math.min((i + 1) * 100, parsedData.uniqueWaybills);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 w-24 text-center">
                            스테이션 {i + 1}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-gray-800">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${((end - start + 1) / 100) * 100}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-400 w-16 text-right">{end - start + 1}건</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 배치 시작 버튼 */}
                <button
                  className="w-full py-4 rounded-xl text-lg font-semibold bg-green-600 hover:bg-green-700 text-white transition-all"
                  onClick={() => {
                    /** TODO: Firebase에 저장 후 스테이션 페이지로 이동 */
                    alert('Firebase 연결 후 활성화됩니다. (1단계 완료 후 2단계에서 구현)');
                  }}
                >
                  배치 생성 및 스테이션 분배
                </button>
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
