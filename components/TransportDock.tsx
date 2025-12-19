import React from 'react';
import { CheckSquare, Mic, Pause, Play, Plus, StopCircle } from 'lucide-react';
import { RecordingState, Track } from '@/types';
import { getTrackTheme } from '@/domain/trackTheme';
import { EditTarget } from '@/domain/editTypes';

type TransportDockProps = {
  recordingState: RecordingState;
  hasAudio: boolean;
  tracks: Track[];
  recordTrackId: string;
  editTarget: EditTarget;
  isSelectionMode: boolean;
  onSelectTarget: (target: EditTarget) => void;
  onToggleSelectionMode: () => void;
  onInsertOneFrame: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onPlay: () => void;
  onPause: () => void;
};

export const TransportDock: React.FC<TransportDockProps> = ({
  recordingState,
  hasAudio,
  tracks,
  recordTrackId,
  editTarget,
  isSelectionMode,
  onSelectTarget,
  onToggleSelectionMode,
  onInsertOneFrame,
  onStartRecording,
  onStopRecording,
  onPlay,
  onPause,
}) => {
  const isRecording = recordingState === RecordingState.RECORDING;
  const isPlaying = recordingState === RecordingState.PLAYING;
  const isBusy = recordingState === RecordingState.PROCESSING;

  const canRecordToggle = !isBusy;
  const canPlayToggle = hasAudio && !isBusy && !isRecording;

  return (
    <div className="safe-area-bottom bg-white border-t border-gray-200">
      <div className="px-3 pt-2 pb-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!canRecordToggle}
          onClick={isRecording ? onStopRecording : onStartRecording}
          className={`flex-1 h-12 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all active:scale-[0.98] ${
            isRecording ? 'border-red-500 bg-red-50 text-red-600' : 'border-gray-200 bg-white text-gray-700'
          } ${!canRecordToggle ? 'opacity-50' : 'hover:border-indigo-400 hover:bg-indigo-50'}`}
        >
          {isRecording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          <div className="flex flex-col items-start leading-none">
            <div className="text-sm">{isRecording ? '停止' : isBusy ? '処理中…' : '録音'}</div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">REC T{recordTrackId}</div>
          </div>
        </button>

        <button
          type="button"
          disabled={!canPlayToggle}
          onClick={isPlaying ? onPause : onPlay}
          className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-colors ${
            canPlayToggle ? 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-700' : 'opacity-50 border-gray-200'
          }`}
          title={isPlaying ? '一時停止' : '再生'}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={onToggleSelectionMode}
          className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-colors ${
            isSelectionMode ? 'bg-blue-600 text-white border-blue-500' : 'border-gray-200 text-gray-500 hover:bg-gray-100'
          }`}
          title="選択"
        >
          <CheckSquare className="w-5 h-5" />
        </button>

        <button
          type="button"
          disabled={isBusy || isRecording || isPlaying}
          onClick={onInsertOneFrame}
          className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-colors ${
            isBusy || isRecording || isPlaying
              ? 'opacity-50 border-gray-200'
              : 'border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
          }`}
          title="+1f（無音挿入）"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex bg-gray-100 p-1 rounded-lg gap-1">
          <button
            type="button"
            onClick={() => onSelectTarget('all')}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-all border-b-2 ${
              editTarget === 'all'
                ? 'bg-white shadow-sm text-gray-800 border-gray-500'
                : 'text-gray-400 border-transparent hover:bg-gray-200 hover:text-gray-600'
            }`}
          >
            全
          </button>
          {tracks.map((track) => {
            const isActive = editTarget === track.id;
            const theme = getTrackTheme(track.id);
            return (
              <button
                key={track.id}
                type="button"
                onClick={() => onSelectTarget(track.id)}
                className={`flex-1 py-2 rounded-md text-xs font-bold transition-all border-b-2 ${
                  isActive ? `bg-white shadow-sm ${theme.activeTextClass} ${theme.activeBorderClass}` : 'text-gray-400 border-transparent hover:bg-gray-200 hover:text-gray-600'
                }`}
              >
                T{track.id}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
