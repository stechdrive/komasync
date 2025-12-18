import React, { useMemo } from 'react';
import { FrameData, Track } from '../types';

interface TimesheetGridProps {
  tracks: Track[];
  activeTrackId: string;
  currentFrame: number;
  selectedFrames: Set<number>;
  fps: number;
  rowHeight: number;
  onSeek: (frame: number, e: React.MouseEvent) => void;
  // Drag selection
  isSelectionMode: boolean;
  onDragStart: (frame: number) => void;
  onDragEnter: (frame: number) => void;
  onDragEnd: () => void;
  // New prop for background click
  onBackgroundClick?: () => void;
}

const SECONDS_PER_COLUMN = 3;
const FRAMES_PER_SECOND = 24;
const FRAMES_PER_COLUMN = SECONDS_PER_COLUMN * FRAMES_PER_SECOND; // 72
const COLUMNS_PER_SHEET = 2; // Standard Japanese layout often has 6s per page (2 cols)
const FRAMES_PER_SHEET = FRAMES_PER_COLUMN * COLUMNS_PER_SHEET; // 144

export const TimesheetGrid: React.FC<TimesheetGridProps> = ({ 
  tracks,
  activeTrackId,
  currentFrame, 
  selectedFrames,
  fps, 
  rowHeight, 
  onSeek,
  isSelectionMode,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onBackgroundClick
}) => {
  
  // Find maximum length to determine how many sheets we need
  const maxFrames = Math.max(0, ...tracks.map(t => t.frames.length));

  // Group frames into sheets and columns
  const sheets = useMemo(() => {
    // Ensure we have at least one sheet even if empty
    const totalSheets = Math.max(1, Math.ceil(maxFrames / FRAMES_PER_SHEET));
    const sheetData = [];
    
    for (let s = 0; s < totalSheets; s++) {
      const cols = [];
      for (let c = 0; c < COLUMNS_PER_SHEET; c++) {
        const startFrame = (s * FRAMES_PER_SHEET) + (c * FRAMES_PER_COLUMN);
        
        // Prepare frame data for each track in this column range
        const trackCols = tracks.map(track => {
            const trackFrames = track.frames.slice(startFrame, startFrame + FRAMES_PER_COLUMN);
            return {
                track,
                frames: trackFrames
            };
        });

        cols.push({ startFrame, trackCols });
      }
      sheetData.push({ index: s, cols });
    }
    return sheetData;
  }, [tracks, maxFrames]);

  // Dimensions
  const TRACK_COL_WIDTH = 30; // Slimmer columns for multi-track
  const RULER_WIDTH = 40;
  const HEADER_HEIGHT = 40;
  const FOOTER_HEIGHT = 20;
  
  // Dynamic calculation based on track count
  const TOTAL_TRACKS_WIDTH = tracks.length * TRACK_COL_WIDTH;
  const COL_BLOCK_WIDTH = RULER_WIDTH + TOTAL_TRACKS_WIDTH;
  const SHEET_WIDTH = COL_BLOCK_WIDTH * COLUMNS_PER_SHEET;

  // Handler to detect clicks specifically on the container/gap, not strictly on children
  const handleBackdropClick = (e: React.MouseEvent) => {
    // Check if the click target is the container itself, preventing triggers when clicking inside sheets
    if (e.target === e.currentTarget) {
        onBackgroundClick?.();
    }
  };

  return (
    <div 
        className="flex-1 overflow-y-auto bg-gray-100 p-2 md:p-8 shadow-inner select-none overscroll-y-contain cursor-default"
        onClick={handleBackdropClick}
    >
      <div 
        className="flex flex-col md:flex-row md:flex-wrap items-center md:items-start md:justify-center gap-2 md:gap-8 pb-24 md:pb-8"
        onClick={handleBackdropClick}
      >
        {sheets.map((sheet) => (
          <div 
            key={sheet.index} 
            className="bg-white shadow-lg border border-gray-400 relative box-content shrink-0 transition-all duration-300 ease-out"
            style={{ 
               width: `${SHEET_WIDTH}px`, 
               height: `${FRAMES_PER_COLUMN * rowHeight + HEADER_HEIGHT + FOOTER_HEIGHT}px`
            }}
          >
            {/* Header */}
            <div 
                className="border-b-2 border-gray-800 flex items-center justify-center font-bold bg-gray-50 text-sm tracking-widest box-border"
                style={{ height: `${HEADER_HEIGHT}px` }}
            >
              シート {sheet.index + 1}
            </div>

            <div className="flex">
              {sheet.cols.map((col, colIndex) => {
                const rulerStart = (colIndex * FRAMES_PER_COLUMN) + 1;

                return (
                  <div key={colIndex} className="flex border-r-2 border-gray-400 last:border-r-0">
                     {/* Ruler */}
                     <div 
                       className="border-r border-gray-300 flex flex-col text-xs text-gray-500 bg-gray-50 select-none overflow-hidden"
                       style={{ width: `${RULER_WIDTH}px` }}
                     >
                        {Array.from({ length: FRAMES_PER_COLUMN }).map((_, i) => {
                          const frameNum = rulerStart + i;
                          const isSecond = (i + 1) % 24 === 0;
                          const isHalfSecond = (i + 1) % 12 === 0;
                          
                          let borderClass = 'border-b border-gray-200';
                          if (isSecond) borderClass = 'border-b-2 border-gray-400 text-black font-bold';
                          else if (isHalfSecond) borderClass = 'border-b border-gray-300';

                          return (
                            <div 
                             key={i} 
                             className={`flex items-center justify-center ${borderClass} box-border`}
                             style={{ height: `${rowHeight}px`, fontSize: rowHeight < 12 ? '8px' : '10px' }}
                            >
                              {rowHeight > 6 && frameNum}
                            </div>
                          );
                        })}
                     </div>

                     {/* Track Columns */}
                     {col.trackCols.map((trackCol, tIndex) => (
                         <div 
                            key={trackCol.track.id}
                            className={`relative border-r border-gray-200 last:border-r-0`}
                            style={{ width: `${TRACK_COL_WIDTH}px` }}
                         >
                            {/* Track Header/Label (Optional, purely visual at top maybe?) */}
                            
                            {Array.from({ length: FRAMES_PER_COLUMN }).map((_, i) => {
                                const globalFrameIndex = col.startFrame + i;
                                const frameData = trackCol.frames[i];
                                const isSecond = (i + 1) % 24 === 0;
                                const isHalfSecond = (i + 1) % 12 === 0;

                                // Boundary Logic
                                const isPastEnd = globalFrameIndex >= maxFrames;
                                const isEndBoundary = globalFrameIndex === maxFrames;

                                let borderClass = 'border-b border-gray-200';
                                if (isSecond) borderClass = 'border-b-2 border-gray-800';
                                else if (isHalfSecond) borderClass = 'border-b border-gray-400';

                                const isActive = frameData?.isSpeech;
                                const isCurrent = globalFrameIndex === currentFrame;
                                const isSelected = selectedFrames.has(globalFrameIndex);
                                const isTrackActive = trackCol.track.id === activeTrackId;

                                // Styling logic
                                let bgClass = '';
                                if (isCurrent) bgClass = 'bg-yellow-200';
                                else if (isSelected && isTrackActive) bgClass = 'bg-blue-200'; // Selection only visible on active track
                                else if (isSelected) bgClass = 'bg-blue-50'; // Dim selection on inactive tracks
                                else if (isTrackActive) bgClass = 'bg-white hover:bg-gray-50';
                                else bgClass = 'bg-gray-50 opacity-60';

                                // Override background for "Void" area (outside duration)
                                if (isPastEnd && !isCurrent && !isSelected) {
                                    bgClass = 'bg-slate-100/80';
                                }

                                return (
                                <div 
                                    key={i}
                                    onClick={(e) => !isSelectionMode && onSeek(globalFrameIndex, e)}
                                    // Pointer events mostly relevant for active track, but allow seeking globally
                                    onPointerDown={(e) => {
                                        if (isSelectionMode) {
                                            e.preventDefault();
                                            onDragStart(globalFrameIndex);
                                        }
                                    }}
                                    onPointerEnter={() => {
                                        if (isSelectionMode) onDragEnter(globalFrameIndex);
                                    }}
                                    onPointerUp={isSelectionMode ? onDragEnd : undefined}
                                    
                                    className={`relative cursor-pointer transition-colors ${borderClass} ${bgClass} box-border`}
                                    style={{ 
                                    height: `${rowHeight}px`,
                                    touchAction: isSelectionMode ? 'none' : 'auto' 
                                    }}
                                >
                                    {/* Duration End Indicator */}
                                    {isEndBoundary && (
                                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-400 z-10 pointer-events-none overflow-visible"></div>
                                    )}

                                    {/* VAD Visualization Bar */}
                                    {isActive && (
                                    <div className={`absolute top-0 bottom-0 left-1/2 w-4 -ml-2 rounded-sm pointer-events-none opacity-60 bg-${trackCol.track.color}-500`} />
                                    )}
                                </div>
                                );
                            })}
                         </div>
                     ))}
                  </div>
                );
              })}
            </div>
            
            {/* Footer Info */}
            <div 
                className="absolute bottom-0 w-full text-center text-[10px] text-gray-400 bg-white border-t border-gray-100 z-10 flex items-center justify-center"
                style={{ height: `${FOOTER_HEIGHT}px` }}
            >
               6秒 (144コマ)
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};