import React, { useEffect, useState } from 'react';
import { FileAudio, Headphones, ImageDown, Mic, Upload, X } from 'lucide-react';
import { InputTestState, Track } from '@/types';
import { VuMeter } from '@/components/VuMeter';
import { APP_NAME, APP_VERSION } from '@/domain/appMeta';
import { getVadTuning, VadPreset } from '@/services/vad';
import type { SileroVadError, SileroVadStatus } from '@/services/sileroVadEngine';
import type { Language, Translator } from '@/domain/i18n';

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
  inputRmsRef: React.MutableRefObject<number>;
  inputGainDb: number;
  isLimiterEnabled: boolean;
  inputTestState: InputTestState;
  isInputTestBusy: boolean;
  isInputConfigLocked: boolean;
  language: Language;
  t: Translator;
  playWhileRecording: boolean;
  onClose: () => void;
  onExportAudio: () => void;
  onExportSheetImagesCurrent: () => void;
  onExportSheetImagesAll: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStartInputTest: () => void;
  onChangeInputGainDb: (value: number) => void;
  onToggleLimiter: (nextValue: boolean) => void;
  onChangeLanguage: (nextLanguage: Language) => void;
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

const formatDb = (value: number, digits: number = 1): string => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)} dB`;
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
  inputRmsRef,
  inputGainDb,
  isLimiterEnabled,
  inputTestState,
  isInputTestBusy,
  isInputConfigLocked,
  language,
  t,
  playWhileRecording,
  onClose,
  onExportAudio,
  onExportSheetImagesCurrent,
  onExportSheetImagesAll,
  onFileUpload,
  onStartInputTest,
  onChangeInputGainDb,
  onToggleLimiter,
  onChangeLanguage,
  onChangeVadPreset,
  onChangeVadStability,
  onToggleVadAuto,
  onChangeVadThresholdScale,
  onCommitVadThresholdScale,
  onTogglePlayWhileRecording,
}) => {
  const [isVadDetailsOpen, setIsVadDetailsOpen] = useState(false);
  const [inputRms, setInputRms] = useState(0);
  useEffect(() => {
    if (!isOpen) {
      setInputRms(0);
      return;
    }

    let rafId = 0;
    const tick = () => {
      const nextValue = inputRmsRef.current;
      setInputRms((prev) => (prev === nextValue ? prev : nextValue));
      rafId = window.requestAnimationFrame(tick);
    };

    setInputRms(inputRmsRef.current);
    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [isOpen, inputRmsRef]);

  if (!isOpen) return null;

  const activeTrackName = tracks.find((t) => t.id === recordTrackId)?.name ?? t('app.trackFallback', { track: recordTrackId });
  const vadTuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
  const stabilityPercent = Math.round(vadStability * 100);
  const thresholdPercent = Math.round(vadThresholdScale * 100);
  const isSileroActive = vadEngineStatus === 'silero';
  const thresholdValueClass = isSileroActive ? 'text-blue-600' : 'text-gray-600';
  const vadEngineLabel =
    vadEngineStatus === 'silero'
      ? t('more.vadEngineSilero')
      : vadEngineStatus === 'fallback'
        ? t('more.vadEngineFallback')
        : t('more.vadEngineUnknown');
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
  const diagOk = t('more.diagOk');
  const diagNg = t('more.diagNg');
  const diagStatus = (value: boolean): string => (value ? diagOk : diagNg);
  const autoCaption = isVadAuto ? t('more.vadAutoCaptionOn') : t('more.vadAutoCaptionOff');
  const gainLabel = formatDb(inputGainDb, 1);
  const testProgress = Math.min(1, Math.max(0, inputTestState.progress));
  const testStatusClass =
    inputTestState.status === 'error'
      ? 'text-rose-600'
      : inputTestState.status === 'success'
        ? 'text-blue-600'
        : 'text-gray-600';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute inset-x-0 bottom-0 safe-area-bottom">
        <div className="bg-white rounded-t-2xl shadow-xl border-t border-gray-200 max-h-[calc(var(--app-height)-var(--topbar-h)-var(--dock-h))] overflow-hidden flex flex-col">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <div className="font-bold text-[var(--ui-sm)] text-gray-800">{t('more.title')}</div>
            <button
              type="button"
              onClick={onClose}
              className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-gray-100"
              title={t('more.close')}
            >
              <X className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
          </div>

          <div className="p-4 overflow-y-auto min-h-0 flex-1 space-y-4 text-[var(--ui-sm)] text-gray-700">
            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('more.exportSection')}</div>
              <button
                type="button"
                onClick={onExportAudio}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700"
              >
                <FileAudio className="w-5 h-5" />
                {t('more.exportAudio')}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onExportSheetImagesCurrent}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700"
                >
                  <ImageDown className="w-5 h-5" />
                  {t('more.exportCurrent')}
                </button>
                <button
                  type="button"
                  onClick={onExportSheetImagesAll}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700"
                >
                  <ImageDown className="w-5 h-5" />
                  {t('more.exportAll')}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('more.uploadSection')}</div>
              <label className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700 cursor-pointer">
                <Upload className="w-5 h-5" />
                {t('more.uploadLabel', { track: activeTrackName })}
                <input type="file" accept="audio/*" onChange={onFileUpload} className="hidden" />
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('more.inputOptimizeSection')}</div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-3">
                <div className="text-[var(--ui-xs)] text-gray-600">{t('more.inputOptimizeDescription')}</div>

                <button
                  type="button"
                  onClick={onStartInputTest}
                  disabled={isInputTestBusy || isInputConfigLocked}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-[var(--ui-sm)] text-gray-700 disabled:opacity-60 disabled:cursor-default"
                >
                  <Mic className="w-5 h-5" />
                  {isInputTestBusy ? t('more.inputTestRunning') : t('more.inputTestStart')}
                </button>

                <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${Math.round(testProgress * 100)}%` }}
                  />
                </div>

                {inputTestState.message && (
                  <div className={`text-[var(--ui-xs)] ${testStatusClass}`}>{inputTestState.message}</div>
                )}

                {inputTestState.status === 'success' && (
                  <div className="text-[var(--ui-xs)] text-gray-500">
                    {t('more.inputTestResult', {
                      recommended: formatDb(inputTestState.recommendedGainDb ?? inputGainDb, 1),
                      applied: formatDb(inputTestState.appliedGainDb ?? inputGainDb, 1),
                    })}
                  </div>
                )}

                <div className="text-[var(--ui-xs)] text-gray-600">
                  {t('more.inputGainLabel')}
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="range"
                      min="-18"
                      max="18"
                      step="1"
                      value={Math.round(inputGainDb)}
                      onChange={(e) => onChangeInputGainDb(parseInt(e.target.value, 10))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      aria-label={t('more.inputGainLabel')}
                    />
                    <div className="w-14 text-right font-mono text-[var(--ui-xs)] text-gray-600">{gainLabel}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-[var(--ui-xs)] text-gray-600">{t('more.limiterLabel')}</div>
                  <button
                    type="button"
                    onClick={() => onToggleLimiter(!isLimiterEnabled)}
                    className="w-[var(--control-size)] h-[var(--control-size)] flex items-center justify-center"
                    disabled={isInputConfigLocked}
                    aria-pressed={isLimiterEnabled}
                    aria-label={t('more.limiterAria')}
                  >
                    <div
                      className={`relative w-10 h-6 rounded-full transition-colors ${
                        isLimiterEnabled ? 'bg-indigo-600' : 'bg-gray-300'
                      } ${isInputConfigLocked ? 'opacity-60' : ''}`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          isLimiterEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </button>
                </div>
                <div className="text-[var(--ui-xs)] text-gray-500">
                  {t('more.limiterHelp')}
                </div>
                {isInputConfigLocked && (
                  <div className="text-[var(--ui-xs)] text-gray-500">{t('more.limiterLocked')}</div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('more.vadSection')}</div>

              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[var(--ui-sm)] text-gray-700">{t('more.vadAuto')}</div>
                  <button
                    type="button"
                    onClick={() => onToggleVadAuto(!isVadAuto)}
                    className="w-[var(--control-size)] h-[var(--control-size)] flex items-center justify-center"
                    aria-pressed={isVadAuto}
                    aria-label={t('more.vadAutoAria')}
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
                    <Mic className="w-5 h-5 text-gray-500 shrink-0" /> {t('more.inputLevel')}
                  </div>
                  <div className="font-mono text-[var(--ui-xs)] text-gray-600">
                    {inputRms.toFixed(3)} / th{' '}
                    <span className={thresholdValueClass}>{vadTuning.startThreshold.toFixed(3)}</span>
                  </div>
                </div>

                <VuMeter value={inputRms} threshold={vadTuning.startThreshold} />

                <div className="flex items-center justify-between">
                  <div className="text-[var(--ui-xs)] text-gray-600">{t('more.detailsLabel')}</div>
                  <button
                    type="button"
                    onClick={() => setIsVadDetailsOpen((prev) => !prev)}
                    className="text-[var(--ui-xs)] text-indigo-600 font-bold hover:text-indigo-800"
                  >
                    {isVadDetailsOpen ? t('more.detailsClose') : t('more.detailsOpen')}
                  </button>
                </div>

                {isVadDetailsOpen && (
                  <div className={`space-y-3 ${isVadAuto ? 'opacity-60' : ''}`}>
                    {isVadAuto && (
                      <div className="text-[var(--ui-xs)] text-gray-500">{t('more.detailsLocked')}</div>
                    )}
                    <div className="text-[var(--ui-xs)] text-gray-500 space-y-1">
                      <div>
                        {t('more.vadEngineLabel')}{' '}
                        <span className={`font-mono ${vadEngineClass}`}>{vadEngineLabel}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
                        <span className={diagValueClass(isCrossOriginIsolated)}>
                          {t('more.diagCoi')}:{diagStatus(isCrossOriginIsolated)}
                        </span>
                        <span className={diagValueClass(isSecureContext)}>
                          {t('more.diagSecure')}:{diagStatus(isSecureContext)}
                        </span>
                        <span className={diagValueClass(hasSharedArrayBuffer)}>
                          {t('more.diagSab')}:{diagStatus(hasSharedArrayBuffer)}
                        </span>
                        <span className={diagValueClass(supportsSimd)}>
                          {t('more.diagSimd')}:{diagStatus(supportsSimd)}
                        </span>
                        <span className={diagValueClass(supportsThreads)}>
                          {t('more.diagThreads')}:{diagStatus(supportsThreads)}
                        </span>
                        <span className={diagValueClass(serviceWorkerControlled)}>
                          {t('more.diagSw')}:{diagStatus(serviceWorkerControlled)}
                        </span>
                      </div>
                      {vadEngineError && (
                        <div className="text-[var(--ui-xs)] text-gray-500">
                          {t('more.vadError')}{' '}
                          <span className="font-mono text-rose-600 break-all">{vadEngineError}</span>
                        </div>
                      )}
                    </div>

                    <div className="text-[var(--ui-xs)] text-gray-600">
                      {t('more.vadSensitivity')}
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
                          aria-label={t('more.vadSensitivity')}
                        />
                        <div className="w-12 text-right font-mono text-[var(--ui-xs)] text-gray-600">{thresholdPercent}%</div>
                      </div>
                    </div>

                    <div className="text-[var(--ui-xs)] text-gray-600">
                      {t('more.vadStability')}
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
                      {t('more.environmentLabel')}
                      <select
                        value={vadPreset}
                        onChange={(e) => onChangeVadPreset(e.target.value as VadPreset)}
                        disabled={isVadAuto}
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-[var(--ui-sm)] disabled:bg-gray-100"
                      >
                        <option value="quiet">{t('more.environmentQuiet')}</option>
                        <option value="normal">{t('more.environmentNormal')}</option>
                        <option value="noisy">{t('more.environmentNoisy')}</option>
                      </select>
                    </label>

                    <div className="text-[var(--ui-xs)] text-gray-500">
                      {t('more.vadDebugValues', {
                        hold: vadTuning.holdFrames,
                        end: vadTuning.endThreshold.toFixed(3),
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('more.recordingSection')}</div>
              <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl border border-gray-200">
                <div className="flex items-center gap-2 text-[var(--ui-sm)] text-gray-700">
                  <Headphones className="w-5 h-5 text-gray-500" /> {t('more.playWhileRecording')}
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
                {t('more.playWhileRecordingHelp')}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('more.languageSection')}</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChangeLanguage('ja')}
                  className={`flex-1 min-h-[var(--control-size)] rounded-xl border px-3 py-2 text-[var(--ui-sm)] font-bold ${
                    language === 'ja'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}
                >
                  {t('more.languageJapanese')}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeLanguage('en')}
                  className={`flex-1 min-h-[var(--control-size)] rounded-xl border px-3 py-2 text-[var(--ui-sm)] font-bold ${
                    language === 'en'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}
                >
                  {t('more.languageEnglish')}
                </button>
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
