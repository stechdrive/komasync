import React from 'react';
import { Mic, Minus, Pause, Play, Plus, StopCircle } from 'lucide-react';
import { RecordingState } from '@/types';
import { useLongPressTooltip } from '@/hooks/useLongPressTooltip';
import { LongPressTooltip } from '@/components/LongPressTooltip';
import type { Translator } from '@/domain/i18n';

type MobileInteractionMode = 'navigate' | 'select';

type TransportDockProps = {
  recordingState: RecordingState;
  hasAudio: boolean;
  recordTrackId: string;
  isMicReady: boolean;
  isMicPreparing: boolean;
  isAllTracks: boolean;
  mobileInteractionMode: MobileInteractionMode;
  t: Translator;
  onChangeMobileInteractionMode: (mode: MobileInteractionMode) => void;
  onToggleAllTracks: () => void;
  onInsertOneFrame: () => void;
  onDeleteOneFrame: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onPlay: () => void;
  onPause: () => void;
  onMarkSpeechFrame: () => void;
  onMarkNonSpeechFrame: () => void;
};

export const TransportDock: React.FC<TransportDockProps> = ({
  recordingState,
  hasAudio,
  recordTrackId,
  isMicReady,
  isMicPreparing,
  isAllTracks,
  mobileInteractionMode,
  t,
  onChangeMobileInteractionMode,
  onToggleAllTracks,
  onInsertOneFrame,
  onDeleteOneFrame,
  onStartRecording,
  onStopRecording,
  onPlay,
  onPause,
  onMarkSpeechFrame,
  onMarkNonSpeechFrame,
}) => {
  const isRecording = recordingState === RecordingState.RECORDING;
  const isPlaying = recordingState === RecordingState.PLAYING;
  const isBusy = recordingState === RecordingState.PROCESSING;
  const isPreparing = isMicPreparing && !isRecording;

  const canRecordToggle = !isBusy && !isPreparing;
  const canPlayToggle = hasAudio && !isBusy && !isRecording;
  const canStepFrame = !isBusy && !isRecording && !isPlaying;
  const micDotClass = isRecording
    ? 'bg-red-500'
    : isPreparing
      ? 'bg-amber-400'
      : isMicReady
        ? 'bg-green-500'
        : 'bg-gray-300';
  const { tooltip, getTooltipProps } = useLongPressTooltip();
  const tooltipProps = getTooltipProps({ placement: 'top' });
  const recordIndicator = t('transport.recordTrackIndicator', { track: recordTrackId });

  return (
    <div className="safe-area-bottom touch-no-select bg-white border-t border-gray-200">
      <div className="sm:hidden overflow-x-auto overscroll-x-contain px-3 py-2">
        <div className="flex min-w-max items-center gap-2">
          <div className="flex shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => onChangeMobileInteractionMode('navigate')}
              {...tooltipProps}
              className={`min-w-[3rem] h-[var(--control-size)] rounded-lg px-3 text-[var(--ui-sm)] font-bold transition-colors ${
                mobileInteractionMode === 'navigate'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600'
              }`}
              title={t('transport.navigateTitle')}
            >
              {t('transport.navigateLabel')}
            </button>
            <button
              type="button"
              onClick={() => onChangeMobileInteractionMode('select')}
              {...tooltipProps}
              className={`min-w-[3rem] h-[var(--control-size)] rounded-lg px-3 text-[var(--ui-sm)] font-bold transition-colors ${
                mobileInteractionMode === 'select'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600'
              }`}
              title={t('transport.selectTitle')}
            >
              {t('transport.selectLabel')}
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleAllTracks}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors font-bold shrink-0 ${
              isAllTracks ? 'bg-blue-600 text-white border-blue-500' : 'border-gray-200 text-gray-500 hover:bg-gray-100'
            }`}
            title={t('transport.allTracksTitle')}
          >
            {t('transport.allTracksLabel')}
          </button>

          <button
            type="button"
            disabled={!canStepFrame}
            onClick={onMarkSpeechFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors font-bold shrink-0 ${
              canStepFrame
                ? 'border-gray-200 text-emerald-600 hover:border-indigo-400 hover:bg-indigo-50'
                : 'opacity-50 border-gray-200'
            }`}
            title={t('transport.markSpeechTitle')}
          >
            {t('transport.markSpeechLabel')}
          </button>

          <button
            type="button"
            disabled={!canStepFrame}
            onClick={onMarkNonSpeechFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors font-bold shrink-0 ${
              canStepFrame
                ? 'border-gray-200 text-gray-500 hover:border-indigo-400 hover:bg-indigo-50'
                : 'opacity-50 border-gray-200'
            }`}
            title={t('transport.markNonSpeechTitle')}
          >
            {t('transport.markNonSpeechLabel')}
          </button>

          <button
            type="button"
            disabled={isBusy || isRecording || isPlaying}
            onClick={onDeleteOneFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              isBusy || isRecording || isPlaying
                ? 'opacity-50 border-gray-200'
                : 'border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
            }`}
            title={t('transport.deleteFrameTitle')}
          >
            <Minus className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>

          <button
            type="button"
            disabled={isBusy || isRecording || isPlaying}
            onClick={onInsertOneFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              isBusy || isRecording || isPlaying
                ? 'opacity-50 border-gray-200'
                : 'border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
            }`}
            title={t('transport.insertFrameTitle')}
          >
            <Plus className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
        </div>
      </div>

      <div className="hidden sm:block px-3 py-2">
        <div className="flex flex-wrap items-center content-start gap-x-2 gap-y-2">
          <button
            type="button"
            disabled={!canRecordToggle}
            onClick={isRecording ? onStopRecording : onStartRecording}
            {...tooltipProps}
            className={`h-[var(--record-h)] min-w-[12rem] sm:min-w-0 sm:flex-1 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all active:scale-[0.98] shrink-0 ${
              isRecording
                ? 'border-red-500 bg-red-50 text-red-600'
                : isPreparing
                  ? 'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-700'
            } ${!canRecordToggle ? 'opacity-50' : 'hover:border-indigo-400 hover:bg-indigo-50'}`}
          >
            {isRecording ? (
              <StopCircle className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            ) : (
              <Mic className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            )}
            <div className="flex flex-col items-start leading-none">
              <div className="text-[var(--ui-sm)]">
                {isRecording
                  ? t('transport.recordStop')
                  : isPreparing
                    ? t('transport.recordPreparing')
                    : isBusy
                      ? t('transport.recordProcessing')
                      : t('transport.recordStart')}
              </div>
              <div className="text-[var(--ui-xs)] text-gray-500 font-mono mt-0.5 flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${micDotClass}`} />
                {recordIndicator}
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={!canPlayToggle}
            onClick={isPlaying ? onPause : onPlay}
            {...tooltipProps}
            className={`w-[calc(var(--control-size)*1.8)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              canPlayToggle ? 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-700' : 'opacity-50 border-gray-200'
            }`}
            title={isPlaying ? t('transport.pauseTitle') : t('transport.playTitle')}
          >
            {isPlaying ? (
              <Pause className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            ) : (
              <Play className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            )}
          </button>

          <button
            type="button"
            onClick={onToggleAllTracks}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors font-bold shrink-0 ${
              isAllTracks ? 'bg-blue-600 text-white border-blue-500' : 'border-gray-200 text-gray-500 hover:bg-gray-100'
            }`}
            title={t('transport.allTracksTitle')}
          >
            {t('transport.allTracksLabel')}
          </button>

          <button
            type="button"
            disabled={!canStepFrame}
            onClick={onMarkSpeechFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors font-bold shrink-0 ${
              canStepFrame
                ? 'border-gray-200 text-emerald-600 hover:border-indigo-400 hover:bg-indigo-50'
                : 'opacity-50 border-gray-200'
            }`}
            title={t('transport.markSpeechTitle')}
          >
            {t('transport.markSpeechLabel')}
          </button>

          <button
            type="button"
            disabled={!canStepFrame}
            onClick={onMarkNonSpeechFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors font-bold shrink-0 ${
              canStepFrame
                ? 'border-gray-200 text-gray-500 hover:border-indigo-400 hover:bg-indigo-50'
                : 'opacity-50 border-gray-200'
            }`}
            title={t('transport.markNonSpeechTitle')}
          >
            {t('transport.markNonSpeechLabel')}
          </button>

          <button
            type="button"
            disabled={isBusy || isRecording || isPlaying}
            onClick={onDeleteOneFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              isBusy || isRecording || isPlaying
                ? 'opacity-50 border-gray-200'
                : 'border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
            }`}
            title={t('transport.deleteFrameTitle')}
          >
            <Minus className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>

          <button
            type="button"
            disabled={isBusy || isRecording || isPlaying}
            onClick={onInsertOneFrame}
            {...tooltipProps}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              isBusy || isRecording || isPlaying
                ? 'opacity-50 border-gray-200'
                : 'border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
            }`}
            title={t('transport.insertFrameTitle')}
          >
            <Plus className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
        </div>
      </div>

      <LongPressTooltip tooltip={tooltip} />
    </div>
  );
};
