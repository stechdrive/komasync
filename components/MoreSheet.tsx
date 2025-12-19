import React from 'react';
import { FileAudio, Headphones, ImageDown, Mic, Upload, X } from 'lucide-react';
import { Track } from '@/types';
import { VuMeter } from '@/components/VuMeter';
import { getVadTuning, VadPreset } from '@/services/vad';

type MoreSheetProps = {
  isOpen: boolean;
  tracks: Track[];
  recordTrackId: string;
  vadPreset: VadPreset;
  vadStability: number;
  inputRms: number;
  playWhileRecording: boolean;
  onClose: () => void;
  onExportAudio: () => void;
  onExportSheetImagesCurrent: () => void;
  onExportSheetImagesAll: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onChangeVadPreset: (preset: VadPreset) => void;
  onChangeVadStability: (stability01: number) => void;
  onTogglePlayWhileRecording: () => void;
};

export const MoreSheet: React.FC<MoreSheetProps> = ({
  isOpen,
  tracks,
  recordTrackId,
  vadPreset,
  vadStability,
  inputRms,
  playWhileRecording,
  onClose,
  onExportAudio,
  onExportSheetImagesCurrent,
  onExportSheetImagesAll,
  onFileUpload,
  onChangeVadPreset,
  onChangeVadStability,
  onTogglePlayWhileRecording,
}) => {
  if (!isOpen) return null;

  const activeTrackName = tracks.find((t) => t.id === recordTrackId)?.name ?? `Track ${recordTrackId}`;
  const vadTuning = getVadTuning(vadPreset, vadStability);
  const stabilityPercent = Math.round(vadStability * 100);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute inset-x-0 bottom-0 safe-area-bottom">
        <div className="bg-white rounded-t-2xl shadow-xl border-t border-gray-200 max-h-[75vh] overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <div className="font-bold text-gray-800">その他</div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-gray-100"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 overflow-y-auto space-y-4">
            <div className="space-y-2">
              <div className="text-xs text-gray-500">書き出し</div>
              <button
                type="button"
                onClick={onExportAudio}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-gray-700"
              >
                <FileAudio className="w-5 h-5" />
                トラック別WAVをZIPでダウンロード
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onExportSheetImagesCurrent}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-gray-700"
                >
                  <ImageDown className="w-5 h-5" />
                  表示中
                </button>
                <button
                  type="button"
                  onClick={onExportSheetImagesAll}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-gray-700"
                >
                  <ImageDown className="w-5 h-5" />
                  全シート
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-gray-500">アップロード</div>
              <label className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 px-3 py-3 font-bold text-gray-700 cursor-pointer">
                <Upload className="w-5 h-5" />
                {activeTrackName} に音声を読み込む
                <input type="file" accept="audio/*" onChange={onFileUpload} className="hidden" />
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-gray-500">音声検出（途切れにくさ）</div>

              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Mic className="w-5 h-5 text-gray-500 shrink-0" /> 入力レベル
                  </div>
                  <div className="font-mono text-xs text-gray-600">
                    {inputRms.toFixed(3)} / th {vadTuning.startThreshold.toFixed(3)}
                  </div>
                </div>

                <VuMeter value={inputRms} threshold={vadTuning.startThreshold} />

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-gray-600">
                    環境
                    <select
                      value={vadPreset}
                      onChange={(e) => onChangeVadPreset(e.target.value as VadPreset)}
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm"
                    >
                      <option value="quiet">静か</option>
                      <option value="normal">普通</option>
                      <option value="noisy">騒がしい</option>
                    </select>
                  </label>

                  <div className="text-xs text-gray-600">
                    途切れにくさ
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={stabilityPercent}
                        onChange={(e) => onChangeVadStability(parseInt(e.target.value, 10) / 100)}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <div className="w-10 text-right font-mono text-xs text-gray-600">{stabilityPercent}</div>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500">
                  hold {vadTuning.holdFrames}f / end {vadTuning.endThreshold.toFixed(3)}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-gray-500">録音</div>
              <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl border border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Headphones className="w-5 h-5 text-gray-500" /> 録音中の再生
                </div>
                <button
                  type="button"
                  onClick={onTogglePlayWhileRecording}
                  className={`w-10 h-6 rounded-full transition-colors relative ${playWhileRecording ? 'bg-indigo-600' : 'bg-gray-300'}`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      playWhileRecording ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="text-[11px] text-gray-500">
                既存トラックを聞きながら録音する場合にON（遅延が気になる場合はOFF）
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
