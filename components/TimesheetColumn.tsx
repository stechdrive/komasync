import React, { useMemo } from 'react';
import { Track } from '@/types';
import { getFramesPerColumn, COLUMNS_PER_SHEET } from '@/domain/timesheet';
import { formatTimecodeOneBased } from '@/domain/timecode';
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
  rowHeight: number;
  onFrameTap: (frame: number) => void;
};

const getRowBorderClass = (rowIndex: number, fps: number, isRuler: boolean): string => {
  const frameInSecond = rowIndex + 1;
  const isSecond = frameInSecond % fps === 0;
  const half = Math.floor(fps / 2);
  const isHalfSecond = half > 0 ? frameInSecond % half === 0 : false;
  const isSixFrame = frameInSecond % 6 === 0;

  if (isSecond) return isRuler ? 'border-b-2 border-gray-400 text-black font-bold' : 'border-b-2 border-gray-800';
  if (isHalfSecond) return isRuler ? 'border-b border-gray-300' : 'border-b border-gray-500';
  if (isSixFrame) return isRuler ? 'border-b border-gray-200' : 'border-b border-gray-300';
  return isRuler ? 'border-b border-gray-100' : 'border-b border-gray-200';
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
  rowHeight,
  onFrameTap,
}) => {
  const framesPerColumn = getFramesPerColumn(fps);
  const selectionStart = selection ? Math.min(selection.startFrame, selection.endFrame) : null;
  const selectionEnd = selection ? Math.max(selection.startFrame, selection.endFrame) : null;
  const showAllFrameLabels = rowHeight >= 10;
  const rulerFontSize = showAllFrameLabels ? '9px' : '10px';
  const columnOffset = (columnIndex % COLUMNS_PER_SHEET) * framesPerColumn;

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
      <div
        className="h-full grid"
        style={{
          gridTemplateRows: `repeat(${framesPerColumn}, minmax(0, 1fr))`,
          gridTemplateColumns: `${rulerWidth}px repeat(${tracks.length}, minmax(0, 1fr)) ${rulerWidth}px`,
        }}
      >
        {Array.from({ length: framesPerColumn }).map((_, rowIndex) => {
          const globalFrameIndex = startFrame + rowIndex;
          const frameNumInColumn = rowIndex + 1;
          const showFrameLabel = showAllFrameLabels || frameNumInColumn === 1 || frameNumInColumn % 6 === 0;
          const localFrameNumber = columnOffset + frameNumInColumn;
          const globalFrameNumber = globalFrameIndex + 1;

          const isPastEnd = globalFrameIndex >= maxFrames;
          const isEndBoundary = globalFrameIndex === maxFrames;
          const isCurrent = globalFrameIndex === cursorFrame;

          const isInSelection =
            selectionStart !== null && selectionEnd !== null
              ? globalFrameIndex >= selectionStart && globalFrameIndex <= selectionEnd
              : false;

          const rulerBorder = getRowBorderClass(rowIndex, fps, true);
          const rulerTone = isCurrent ? 'bg-yellow-200 text-gray-900 font-bold' : 'bg-gray-50 text-gray-600';

          return (
            <React.Fragment key={rowIndex}>
              {/* ルーラー */}
              <div
                className={`flex items-center justify-center font-mono select-none overflow-hidden ${rulerBorder} ${rulerTone} border-r border-gray-300`}
                style={{ fontSize: rulerFontSize }}
                onClick={() => onFrameTap(globalFrameIndex)}
              >
                {showFrameLabel || isCurrent ? localFrameNumber : ''}
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

              {/* 右ルーラー */}
              <div
                className={`flex items-center justify-center font-mono select-none overflow-hidden ${rulerBorder} ${rulerTone} border-l border-gray-300`}
                style={{ fontSize: rulerFontSize }}
                onClick={() => onFrameTap(globalFrameIndex)}
              >
                {isCurrent
                  ? formatTimecodeOneBased(globalFrameIndex, fps)
                  : showFrameLabel
                    ? globalFrameNumber
                    : ''}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
