'use client';

import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Database, ChevronDown, ChevronUp } from 'lucide-react';
import type { ParsedExcelData } from '@/lib/types';

interface ExistingUpload {
  fileName: string;
  totalOrders: number;
  totalQuantity: number;
  uniqueProducts: number;
  uniqueWaybills: number;
}

interface UploadPanelProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  file: File | null;
  password: string;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPasswordChange: (pw: string) => void;
  onUpload: () => void;
  onSaveToFirebase: () => void;
  onDrop: (e: React.DragEvent) => void;
  parsedData: ParsedExcelData | null;
  existingUpload: ExistingUpload | null;
  savedUploadId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export default function UploadPanel(props: UploadPanelProps) {
  const { collapsed, onToggleCollapsed, file, password, parsedData, existingUpload, savedUploadId, loading, saving, error } = props;

  const waybills = parsedData?.uniqueWaybills ?? existingUpload?.uniqueWaybills ?? 0;
  const totalQty = parsedData?.totalQuantity ?? existingUpload?.totalQuantity ?? 0;
  const skuCount = parsedData?.uniqueProducts ?? existingUpload?.uniqueProducts ?? 0;
  const hasData = parsedData || existingUpload;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors"
      >
        <Upload className="w-4 h-4 text-gray-400" />
        <span className="flex-1 text-left text-sm font-semibold text-white">
          엑셀 업로드
        </span>
        {hasData && (
          <span className="text-xs text-gray-500 truncate max-w-[140px]">
            {parsedData?.fileName ?? existingUpload?.fileName}
          </span>
        )}
        {collapsed ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {!collapsed && (
        <div className="p-4 space-y-4 border-t border-gray-800">
          <div
            onDrop={props.onDrop}
            onDragOver={(e) => e.preventDefault()}
            className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer
              ${file ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 hover:border-gray-500 bg-gray-900/30'}`}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".xls,.xlsx"
              onChange={props.onFileSelect}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="w-7 h-7 text-blue-400 shrink-0" />
                <div className="min-w-0 text-left">
                  <p className="text-sm text-white font-medium truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 text-gray-500">
                <Upload className="w-6 h-6" />
                <p className="text-sm">엑셀 파일 드래그 또는 클릭</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => props.onPasswordChange(e.target.value)}
              placeholder="비밀번호 (암호화 파일)"
              className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={props.onUpload}
              disabled={!file || loading}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-800 disabled:text-gray-600"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '분석'}
            </button>
          </div>

          {hasData && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-xs">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <p className="text-green-400 truncate">
                  {parsedData ? `파싱 완료` : `저장된 데이터`}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-gray-900 border border-gray-800">
                  <p className="text-xs text-gray-500">운송장</p>
                  <p className="text-lg font-bold text-white">{waybills.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-lg bg-gray-900 border border-gray-800">
                  <p className="text-xs text-gray-500">수량</p>
                  <p className="text-lg font-bold text-white">{totalQty.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-lg bg-gray-900 border border-gray-800">
                  <p className="text-xs text-gray-500">SKU</p>
                  <p className="text-lg font-bold text-white">{skuCount.toLocaleString()}</p>
                </div>
              </div>

              {savedUploadId ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs">
                  <Database className="w-4 h-4 text-blue-400 shrink-0" />
                  <p className="text-blue-400">저장 완료 — 스캔 가능</p>
                </div>
              ) : parsedData ? (
                <button
                  onClick={props.onSaveToFirebase}
                  disabled={saving}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-700 text-white transition-all disabled:bg-gray-800 disabled:text-gray-600"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      저장 중...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Database className="w-4 h-4" />
                      데이터 저장
                    </span>
                  )}
                </button>
              ) : null}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
