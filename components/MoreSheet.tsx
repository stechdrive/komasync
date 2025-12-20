import React, { useState } from 'react';
import { FileAudio, Headphones, ImageDown, Mic, Upload, X } from 'lucide-react';
import { Track } from '@/types';
import { VuMeter } from '@/components/VuMeter';
import { APP_NAME, APP_VERSION } from '@/domain/appMeta';
import { getVadTuning, VadPreset } from '@/services/vad';
import type { SileroVadError, SileroVadStatus } from '@/services/sileroVadEngine';

type MoreSheetProps = {
  isOpen: boolean;
  tracks: Track[];
  recordTrackId: string;
  vadPreset: VadPreset;
  vadStability: number;
  vadThresholdScale: number;
  isVadAuto: boolean;
  vadEngineStatus: SileroVadStatus;
  vadEngineError: SileroVadError;
  inputRms: number;
  playWhileRecording: boolean;
  onClose: () => void;
  onExportAudio: () => void;
  onExportSheetImagesCurrent: () => void;
  onExportSheetImagesAll: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onChangeVadPreset: (preset: VadPreset) => void;
  onChangeVadStability: (stability01: number) => void;
  onToggleVadAuto: (nextValue: boolean) => void;
  onChangeVadThresholdScale: (scale: number) => void;
  onCommitVadThresholdScale: () => void;
  onTogglePlayWhileRecording: () => void;
};

// onnxruntime-web と同じ判定用バイト列で WASM 機能を確認する。
const isSimdSupported = (): boolean => {
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.validate !== 'function') return false;
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253,
        12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11,
      ])
    );
  } catch {
    return false;
  }
};

// onnxruntime-web と同じ判定用バイト列でスレッド対応を確認する。
const isThreadSupported = (): boolean => {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  try {
    if (typeof MessageChannel !== 'undefined') {
      new MessageChannel().port1.postMessage(new SharedArrayBuffer(1));
    }
  } catch {
    return false;
  }
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.validate !== 'function') return false;
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65,
        0, 254, 16, 2, 0, 26, 11,
      ])
    );
  } catch {
    return false;
  }
};

export const MoreSheet: React.FC<MoreSheetProps> = ({
  isOpen,
  tracks,
  recordTrackId,
  vadPreset,
  vadStability,
  vadThresholdScale,
  isVadAuto,
  vadEngineStatus,
  vadEngineError,
  inputRms,
  playWhileRecording,
  onClose,
  onExportAudio,
  onExportSheetImagesCurrent,
  onExportSheetImagesAll,
  onFileUpload,
  onChangeVadPreset,
  onChangeVadStability,
  onToggleVadAuto,
  onChangeVadThresholdScale,
  onCommitVadThresholdScale,
  onTogglePlayWhileRecording,
}) => {
  const [isVadDetailsOpen, setIsVadDetailsOpen] = useState(false);
  if (!isOpen) return null;

  const activeTrackName = tracks.find((t) => t.id === recordTrackId)?.name ?? `Track ${recordTrackId}`;
  const vadTuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
  const stabilityPercent = Math.round(vadStability * 100);
  const thresholdPercent = Math.round(vadThresholdScale * 100);
  const isSileroActive = vadEngineStatus === 'silero';
  const thresholdValueClass = isSileroActive ? 'text-blue-600' : 'text-gray-600';
  const vadEngineLabel =
    vadEngineStatus === 'silero' ? 'Silero' : vadEngineStatus === 'fallback' ? 'Fallback' : '未判定';
  const vadEngineClass =
    vadEngineStatus === 'silero'
      ? 'text-blue-600'
      : vadEngineStatus === 'fallback'
        ? 'text-gray-600'
        : 'text-gray-400';
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
  const isCrossOriginIsolated = typeof window !== 'undefined' && window.crossOriginIsolated;
  const hasSharedArrayBuffer = typeof window !== 'undefined' && 'SharedArrayBuffer' in window;
  const supportsSimd = isSimdSupported();
  const supportsThreads = isThreadSupported();
  const serviceWorkerControlled =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller);
  const diagValueClass = (value: boolean): string => (value ? 'text-blue-600' : 'text-gray-500');
  const autoCaption = isVadAuto
    ? '6コマ以上の録音があると自動で最適化'
    : '手動で感度と途切れにくさを調整できます';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute inset-x-0 bottom-0 safe-area-bottom">
        <div className="bg-white rounded-t-2xl shadow-xl border-t border-gray-200 max-h-[calc(var(--app-height)-var(--topbar-h)-var(--dock-h))] overflow-hidden flex flex-col">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <div className="font-bold text-[var(--ui-sm)] text-gray-800">その他</div>
            <button
              type="button"
              onClick={onClose}
              className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-gray-100"
              title="閉じる"
            >
              <X className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
          </div>

          <div className="p-4 overflow-y-auto min-h-0 flex-1 space-y-4 text-[var(--ui-sm)] text-gray-700">
            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">書き出し</div>
              <button
                type="button"
                onClick={onExportAudio}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700"
              >
                <FileAudio className="w-5 h-5" />
                トラック別WAVをZIPでダウンロード
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onExportSheetImagesCurrent}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700"
                >
                  <ImageDown className="w-5 h-5" />
                  表示中
                </button>
                <button
                  type="button"
                  onClick={onExportSheetImagesAll}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700"
                >
                  <ImageDown className="w-5 h-5" />
                  全シート
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">アップロード</div>
              <label className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700 cursor-pointer">
                <Upload className="w-5 h-5" />
                {activeTrackName} に音声を読み込む
                <input type="file" accept="audio/*" onChange={onFileUpload} className="hidden" />
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">セリフ検出</div>

              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[var(--ui-sm)] text-gray-700">自動調整</div>
                  <button
                    type="button"
                    onClick={() => onToggleVadAuto(!isVadAuto)}
                    className="w-[var(--control-size)] h-[var(--control-size)] flex items-center justify-center"
                    aria-pressed={isVadAuto}
                    aria-label="セリフ検出の自動調整"
                  >
                    <div
                      className={`relative w-10 h-6 rounded-full transition-colors ${
                        isVadAuto ? 'bg-indigo-600' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          isVadAuto ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </button>
                </div>
                <div className="text-[var(--ui-xs)] text-gray-500">{autoCaption}</div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[var(--ui-sm)] text-gray-700">
                    <Mic className="w-5 h-5 text-gray-500 shrink-0" /> 入力レベル
                  </div>
                  <div className="font-mono text-[var(--ui-xs)] text-gray-600">
                    {inputRms.toFixed(3)} / th{' '}
                    <span className={thresholdValueClass}>{vadTuning.startThreshold.toFixed(3)}</span>
                  </div>
                </div>

                <VuMeter value={inputRms} threshold={vadTuning.startThreshold} />

                <div className="flex items-center justify-between">
                  <div className="text-[var(--ui-xs)] text-gray-600">詳細設定</div>
                  <button
                    type="button"
                    onClick={() => setIsVadDetailsOpen((prev) => !prev)}
                    className="text-[var(--ui-xs)] text-indigo-600 font-bold hover:text-indigo-800"
                  >
                    {isVadDetailsOpen ? '閉じる' : '開く'}
                  </button>
                </div>

                {isVadDetailsOpen && (
                  <div className={`space-y-3 ${isVadAuto ? 'opacity-60' : ''}`}>
                    {isVadAuto && (
                      <div className="text-[var(--ui-xs)] text-gray-500">
                        自動調整中は詳細設定を変更できません。
                      </div>
                    )}
                    <div className="text-[var(--ui-xs)] text-gray-500 space-y-1">
                      <div>
                        開発用: VADエンジン <span className={`font-mono ${vadEngineClass}`}>{vadEngineLabel}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
                        <span className={diagValueClass(isCrossOriginIsolated)}>
                          COI:{isCrossOriginIsolated ? 'OK' : 'NG'}
                        </span>
                        <span className={diagValueClass(isSecureContext)}>
                          Secure:{isSecureContext ? 'OK' : 'NG'}
                        </span>
                        <span className={diagValueClass(hasSharedArrayBuffer)}>
                          SAB:{hasSharedArrayBuffer ? 'OK' : 'NG'}
                        </span>
                        <span className={diagValueClass(supportsSimd)}>SIMD:{supportsSimd ? 'OK' : 'NG'}</span>
                        <span className={diagValueClass(supportsThreads)}>Threads:{supportsThreads ? 'OK' : 'NG'}</span>
                        <span className={diagValueClass(serviceWorkerControlled)}>
                          SW:{serviceWorkerControlled ? 'OK' : 'NG'}
                        </span>
                      </div>
                      {vadEngineError && (
                        <div className="text-[var(--ui-xs)] text-gray-500">
                          VADエラー: <span className="font-mono text-rose-600 break-all">{vadEngineError}</span>
                        </div>
                      )}
                    </div>

                    <div className="text-[var(--ui-xs)] text-gray-600">
                      セリフ検出：感度
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="range"
                          min="50"
                          max="150"
                          step="1"
                          value={thresholdPercent}
                          onChange={(e) => onChangeVadThresholdScale(parseInt(e.target.value, 10) / 100)}
                          onPointerUp={onCommitVadThresholdScale}
                          onPointerCancel={onCommitVadThresholdScale}
                          onBlur={onCommitVadThresholdScale}
                          disabled={isVadAuto}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 disabled:cursor-default"
                          aria-label="セリフ検出感度"
                        />
                        <div className="w-12 text-right font-mono text-[var(--ui-xs)] text-gray-600">{thresholdPercent}%</div>
                      </div>
                    </div>

                    <div className="text-[var(--ui-xs)] text-gray-600">
                      セリフ検出：途切れにくさ
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={stabilityPercent}
                          onChange={(e) => onChangeVadStability(parseInt(e.target.value, 10) / 100)}
                          disabled={isVadAuto}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 disabled:cursor-default"
                        />
                        <div className="w-10 text-right font-mono text-[var(--ui-xs)] text-gray-600">{stabilityPercent}</div>
                      </div>
                    </div>

                    <label className="text-[var(--ui-xs)] text-gray-600">
                      環境
                      <select
                        value={vadPreset}
                        onChange={(e) => onChangeVadPreset(e.target.value as VadPreset)}
                        disabled={isVadAuto}
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-[var(--ui-sm)] disabled:bg-gray-100"
                      >
                        <option value="quiet">静か</option>
                        <option value="normal">普通</option>
                        <option value="noisy">騒がしい</option>
                      </select>
                    </label>

                    <div className="text-[var(--ui-xs)] text-gray-500">
                      hold {vadTuning.holdFrames}f / end {vadTuning.endThreshold.toFixed(3)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">録音</div>
              <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl border border-gray-200">
                <div className="flex items-center gap-2 text-[var(--ui-sm)] text-gray-700">
                  <Headphones className="w-5 h-5 text-gray-500" /> 録音中の再生
                </div>
                <button
                  type="button"
                  onClick={onTogglePlayWhileRecording}
                  className="w-[var(--control-size)] h-[var(--control-size)] flex items-center justify-center"
                >
                  <div
                    className={`relative w-10 h-6 rounded-full transition-colors ${
                      playWhileRecording ? 'bg-indigo-600' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                        playWhileRecording ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </button>
              </div>
              <div className="text-[var(--ui-xs)] text-gray-500">
                既存トラックを聞きながら録音する場合にON（遅延が気になる場合はOFF）
              </div>
            </div>

            <div className="pt-2 text-center text-[var(--ui-xs)] text-gray-400">
              {APP_NAME} v{APP_VERSION}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
