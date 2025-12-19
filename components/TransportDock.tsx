import React from 'react';
import { Mic, Pause, Play, Plus, StopCircle } from 'lucide-react';
import { RecordingState } from '@/types';

type TransportDockProps = {
  recordingState: RecordingState;
  hasAudio: boolean;
  recordTrackId: string;
  isMicReady: boolean;
  isMicPreparing: boolean;
  isAllTracks: boolean;
  vadThresholdScale: number;
  vadThresholdValue: number;
  onChangeVadThresholdScale: (scale: number) => void;
  onToggleAllTracks: () => void;
  onInsertOneFrame: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onPlay: () => void;
  onPause: () => void;
};

export const TransportDock: React.FC<TransportDockProps> = ({
  recordingState,
  hasAudio,
  recordTrackId,
  isMicReady,
  isMicPreparing,
  isAllTracks,
  vadThresholdScale,
  vadThresholdValue,
  onChangeVadThresholdScale,
  onToggleAllTracks,
  onInsertOneFrame,
  onStartRecording,
  onStopRecording,
  onPlay,
  onPause,
}) => {
  const isRecording = recordingState === RecordingState.RECORDING;
  const isPlaying = recordingState === RecordingState.PLAYING;
  const isBusy = recordingState === RecordingState.PROCESSING;
  const isPreparing = isMicPreparing && !isRecording;
  const thresholdPercent = Math.round(vadThresholdScale * 100);

  const canRecordToggle = !isBusy && !isPreparing;
  const canPlayToggle = hasAudio && !isBusy && !isRecording;
  const micDotClass = isRecording
    ? 'bg-red-500'
    : isPreparing
      ? 'bg-amber-400'
      : isMicReady
        ? 'bg-green-500'
        : 'bg-gray-300';

  return (
    <div className="safe-area-bottom bg-white border-t border-gray-200">
      <div className="px-3 pt-2 pb-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!canRecordToggle}
          onClick={isRecording ? onStopRecording : onStartRecording}
          className={`flex-1 h-14 sm:h-12 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all active:scale-[0.98] ${
            isRecording
              ? 'border-red-500 bg-red-50 text-red-600'
              : isPreparing
                ? 'border-amber-400 bg-amber-50 text-amber-700'
                : 'border-gray-200 bg-white text-gray-700'
          } ${!canRecordToggle ? 'opacity-50' : 'hover:border-indigo-400 hover:bg-indigo-50'}`}
        >
          {isRecording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          <div className="flex flex-col items-start leading-none">
            <div className="text-sm">
              {isRecording ? '停止' : isPreparing ? '準備中…' : isBusy ? '処理中…' : '録音'}
            </div>
            <div className="text-xs sm:text-[10px] text-gray-500 font-mono mt-0.5 flex items-center gap-1">
              <span className={`inline-block w-2 h-2 rounded-full ${micDotClass}`} />
              REC T{recordTrackId}
            </div>
          </div>
        </button>

        <button
          type="button"
          disabled={!canPlayToggle}
          onClick={isPlaying ? onPause : onPlay}
          className={`w-14 h-14 sm:w-12 sm:h-12 rounded-xl border flex items-center justify-center transition-colors ${
            canPlayToggle ? 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-700' : 'opacity-50 border-gray-200'
          }`}
          title={isPlaying ? '一時停止' : '再生'}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>

        <div className="h-14 sm:h-12 w-[110px] sm:w-[92px] rounded-xl border border-gray-200 bg-white px-2 py-1 flex flex-col justify-center">
          <div className="flex items-center justify-between text-[9px] text-gray-500 leading-none">
            <span>閾値</span>
            <span className="font-mono text-[9px]">{vadThresholdValue.toFixed(3)}</span>
          </div>
          <input
            type="range"
            min="50"
            max="150"
            step="1"
            value={thresholdPercent}
            onChange={(e) => onChangeVadThresholdScale(parseInt(e.target.value, 10) / 100)}
            className="mt-1 w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            aria-label="音声検出の閾値"
          />
        </div>

        <button
          type="button"
          onClick={onToggleAllTracks}
          className={`w-14 h-14 sm:w-12 sm:h-12 rounded-xl border flex items-center justify-center transition-colors font-bold ${
            isAllTracks ? 'bg-blue-600 text-white border-blue-500' : 'border-gray-200 text-gray-500 hover:bg-gray-100'
          }`}
          title="全トラック"
        >
          全
        </button>

        <button
          type="button"
          disabled={isBusy || isRecording || isPlaying}
          onClick={onInsertOneFrame}
          className={`w-14 h-14 sm:w-12 sm:h-12 rounded-xl border flex items-center justify-center transition-colors ${
            isBusy || isRecording || isPlaying
              ? 'opacity-50 border-gray-200'
              : 'border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
          }`}
          title="+1f（無音挿入）"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

    </div>
  );
};
