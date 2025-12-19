import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Track } from '@/types';
import { getFramesPerColumn, getFramesPerSheet, COLUMNS_PER_SHEET } from '@/domain/timesheet';
import { TimesheetColumn } from '@/components/TimesheetColumn';
import { EditTarget, SelectionRange } from '@/domain/editTypes';

type TimesheetViewportProps = {
  tracks: Track[];
  currentFrame: number;
  editTarget: EditTarget;
  selection: SelectionRange | null;
  fps: number;
  isAutoScrollActive: boolean;
  onFrameTap: (frame: number) => void;
  onBackgroundClick?: () => void;
  onFirstVisibleColumnChange?: (columnIndex: number) => void;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const TimesheetViewport: React.FC<TimesheetViewportProps> = ({
  tracks,
  currentFrame,
  editTarget,
  selection,
  fps,
  isAutoScrollActive,
  onFrameTap,
  onBackgroundClick,
  onFirstVisibleColumnChange,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFirstVisibleColRef = useRef<number | null>(null);
  const lastAutoSheetRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const framesPerColumn = getFramesPerColumn(fps);
  const framesPerSheet = getFramesPerSheet(fps);
  const maxFrames = Math.max(0, ...tracks.map((t) => t.frames.length));
  const virtualMaxFrames = Math.max(maxFrames, currentFrame + 1);
  const totalColumns = Math.max(2, Math.ceil(virtualMaxFrames / framesPerColumn));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      setViewportWidth(rect?.width ?? 0);
      setViewportHeight(rect?.height ?? 0);
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      setScrollLeft(el.scrollLeft);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const columnWidth = useMemo(() => {
    if (viewportWidth <= 0) return 1;
    return Math.max(1, Math.floor(viewportWidth / 2));
  }, [viewportWidth]);

  const rulerWidth = useMemo(() => {
    return clamp(Math.round(columnWidth * 0.25), 36, 56);
  }, [columnWidth]);

  const rowHeight = useMemo(() => {
    if (viewportHeight <= 0) return 0;
    return viewportHeight / framesPerColumn;
  }, [framesPerColumn, viewportHeight]);

  useEffect(() => {
    if (!isAutoScrollActive) {
      lastAutoSheetRef.current = null;
      return;
    }
    const el = scrollRef.current;
    if (!el || columnWidth <= 0) return;

    const sheetIndex = Math.floor(currentFrame / framesPerSheet);
    if (lastAutoSheetRef.current === sheetIndex) return;
    lastAutoSheetRef.current = sheetIndex;

    // 再生中にシート境界へ到達したら自動スクロール
    const targetLeft = sheetIndex * COLUMNS_PER_SHEET * columnWidth;
    el.scrollTo({ left: targetLeft, behavior: 'smooth' });
  }, [columnWidth, currentFrame, framesPerSheet, isAutoScrollActive]);

  useEffect(() => {
    if (!onFirstVisibleColumnChange) return;
    const firstVisible = Math.floor(scrollLeft / columnWidth);
    if (lastFirstVisibleColRef.current === firstVisible) return;
    lastFirstVisibleColRef.current = firstVisible;
    onFirstVisibleColumnChange(firstVisible);
  }, [columnWidth, onFirstVisibleColumnChange, scrollLeft]);

  const { renderStartColumn, renderEndColumn } = useMemo(() => {
    if (columnWidth <= 0) return { renderStartColumn: 0, renderEndColumn: Math.min(totalColumns - 1, 1) };

    const firstVisible = Math.floor(scrollLeft / columnWidth);
    const overscan = 2;
    const visibleCount = 2;

    const start = Math.max(0, firstVisible - overscan);
    const end = Math.min(totalColumns - 1, firstVisible + (visibleCount - 1) + overscan);
    return { renderStartColumn: start, renderEndColumn: end };
  }, [columnWidth, scrollLeft, totalColumns]);

  const visibleColumnIndices = useMemo(() => {
    const cols: number[] = [];
    for (let i = renderStartColumn; i <= renderEndColumn; i++) cols.push(i);
    return cols;
  }, [renderStartColumn, renderEndColumn]);

  const leftSpacerWidth = renderStartColumn * columnWidth;
  const rightSpacerWidth = Math.max(0, totalColumns - renderEndColumn - 1) * columnWidth;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onBackgroundClick?.();
  };

  return (
    <div className="h-full w-full bg-gray-100 select-none">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-x-auto overflow-y-hidden snap-x snap-proximity overscroll-x-contain cursor-default"
        onClick={handleBackdropClick}
      >
        <div className="h-full flex" style={{ width: `${totalColumns * columnWidth}px` }}>
          {leftSpacerWidth > 0 && <div className="shrink-0 h-full" style={{ width: `${leftSpacerWidth}px` }} />}

          {visibleColumnIndices.map((columnIndex) => (
            <TimesheetColumn
              key={columnIndex}
              columnIndex={columnIndex}
              startFrame={columnIndex * framesPerColumn}
              fps={fps}
              tracks={tracks}
              editTarget={editTarget}
              cursorFrame={currentFrame}
              selection={selection}
              maxFrames={maxFrames}
              columnWidth={columnWidth}
              rulerWidth={rulerWidth}
              rowHeight={rowHeight}
              onFrameTap={onFrameTap}
            />
          ))}

          {rightSpacerWidth > 0 && <div className="shrink-0 h-full" style={{ width: `${rightSpacerWidth}px` }} />}
        </div>
      </div>
    </div>
  );
};
