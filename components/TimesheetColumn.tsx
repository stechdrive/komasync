import React, { useMemo } from 'react';
import { Track } from '@/types';
import { getFramesPerColumn, COLUMNS_PER_SHEET } from '@/domain/timesheet';
import { getTrackTheme } from '@/domain/trackTheme';
import { EditTarget, SelectionRange } from '@/domain/editTypes';

type TimesheetColumnProps = {
  columnIndex: number;
  startFrame: number;
  fps: number;
  tracks: Track[];
  editTarget: EditTarget;
  cursorFrame: number;
  selection: SelectionRange | null;
  maxFrames: number;
  columnWidth: number;
  rulerWidth: number;
  onFrameTap: (frame: number) => void;
};

const getRowBorderClass = (rowIndex: number, fps: number, isRuler: boolean): string => {
  const frameInSecond = rowIndex + 1;
  const isSecond = frameInSecond % fps === 0;
  const half = Math.floor(fps / 2);
  const isHalfSecond = half > 0 ? frameInSecond % half === 0 : false;

  if (isSecond) return isRuler ? 'border-b-2 border-gray-400 text-black font-bold' : 'border-b-2 border-gray-800';
  if (isHalfSecond) return isRuler ? 'border-b border-gray-300' : 'border-b border-gray-400';
  return 'border-b border-gray-200';
};

export const TimesheetColumn: React.FC<TimesheetColumnProps> = ({
  columnIndex,
  startFrame,
  fps,
  tracks,
  editTarget,
  cursorFrame,
  selection,
  maxFrames,
  columnWidth,
  rulerWidth,
  onFrameTap,
}) => {
  const framesPerColumn = getFramesPerColumn(fps);
  const sheetIndex = Math.floor(columnIndex / COLUMNS_PER_SHEET);
  const selectionStart = selection ? Math.min(selection.startFrame, selection.endFrame) : null;
  const selectionEnd = selection ? Math.max(selection.startFrame, selection.endFrame) : null;

  const columnBoundaryClass = useMemo(() => {
    if (columnIndex === 0) return 'border-l-0';
    if (columnIndex % COLUMNS_PER_SHEET === 0) return 'border-l-4 border-gray-600';
    return 'border-l border-gray-300';
  }, [columnIndex]);

  return (
    <div
      className={`relative shrink-0 h-full snap-start ${columnBoundaryClass}`}
      style={{ width: `${columnWidth}px` }}
    >
      {columnIndex % COLUMNS_PER_SHEET === 0 && (
        <div className="absolute top-1 left-1 z-20 pointer-events-none">
          <div className="bg-white/80 backdrop-blur rounded px-1.5 py-0.5 text-[10px] font-bold text-gray-700 border border-gray-200">
            シート {sheetIndex + 1}
          </div>
        </div>
      )}

      <div
        className="h-full grid"
        style={{
          gridTemplateRows: `repeat(${framesPerColumn}, minmax(0, 1fr))`,
          gridTemplateColumns: `${rulerWidth}px repeat(${tracks.length}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: framesPerColumn }).map((_, rowIndex) => {
          const globalFrameIndex = startFrame + rowIndex;
          const frameNumInColumn = rowIndex + 1;

          const isPastEnd = globalFrameIndex >= maxFrames;
          const isEndBoundary = globalFrameIndex === maxFrames;
          const isCurrent = globalFrameIndex === cursorFrame;

          const isInSelection =
            selectionStart !== null && selectionEnd !== null
              ? globalFrameIndex >= selectionStart && globalFrameIndex <= selectionEnd
              : false;

          const rulerBorder = getRowBorderClass(rowIndex, fps, true);

          return (
            <React.Fragment key={rowIndex}>
              {/* ルーラー */}
              <div
                className={`flex items-center justify-center text-[10px] text-gray-500 bg-gray-50 select-none overflow-hidden ${rulerBorder} border-r border-gray-300`}
                style={{ fontSize: frameNumInColumn % fps === 0 ? '10px' : '9px' }}
                onClick={() => onFrameTap(globalFrameIndex)}
              >
                {frameNumInColumn % fps === 0 ? frameNumInColumn : ''}
              </div>

              {/* トラック */}
              {tracks.map((track) => {
                const frameData = track.frames[globalFrameIndex];
                const isSpeech = Boolean(frameData?.isSpeech);
                const isTargetTrack = editTarget === 'all' || editTarget === track.id;

                const borderClass = getRowBorderClass(rowIndex, fps, false);

                let bgClass = '';
                if (isCurrent) bgClass = 'bg-yellow-200';
                else if (isInSelection && isTargetTrack) bgClass = 'bg-blue-200';
                else if (isInSelection) bgClass = 'bg-blue-50';
                else if (isTargetTrack) bgClass = 'bg-white';
                else bgClass = 'bg-gray-50 opacity-60';

                if (isPastEnd && !isCurrent && !isInSelection) bgClass = 'bg-slate-100/80';

                return (
                  <div
                    key={track.id}
                    data-frame-index={globalFrameIndex}
                    data-track-id={track.id}
                    onClick={() => onFrameTap(globalFrameIndex)}
                    className={`relative cursor-pointer ${borderClass} ${bgClass} border-r border-gray-200 box-border`}
                    style={{
                      touchAction: 'pan-x',
                    }}
                  >
                    {isEndBoundary && (
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-400 z-10 pointer-events-none overflow-visible" />
                    )}

                    {isSpeech && (
                      <div
                        className={`absolute top-0 bottom-0 left-1/2 w-4 -ml-2 rounded-sm pointer-events-none opacity-60 ${getTrackTheme(track.id).vadBarClass}`}
                      />
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
