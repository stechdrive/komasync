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
  onOpenContextMenu?: (point: { x: number; y: number }) => void;
  onSelectionChange?: (range: SelectionRange | null) => void;
  onTrackSelect?: (trackId: string) => void;
  onScrubStart?: (frame: number) => void;
  onScrubMove?: (frame: number) => void;
  onScrubEnd?: () => void;
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
  onOpenContextMenu,
  onSelectionChange,
  onTrackSelect,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFirstVisibleColRef = useRef<number | null>(null);
  const lastAutoSheetRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressPointRef = useRef<{ x: number; y: number } | null>(null);
  const longPressActionRef = useRef<'selection' | 'menu' | null>(null);
  const longPressTargetRef = useRef<{ frame: number; trackId: string | null } | null>(null);
  const longPressActiveRef = useRef(false);
  const pendingTapRef = useRef<{
    frame: number;
    trackId: string | null;
    pointerType: string;
    x: number;
    y: number;
  } | null>(null);
  const scrubPendingRef = useRef<{
    frame: number;
    x: number;
    y: number;
  } | null>(null);
  const isScrubbingRef = useRef(false);
  const selectionAnchorRef = useRef<number | null>(null);
  const isSelectingRef = useRef(false);
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

  const getTrackTarget = (target: EventTarget | null): { frame: number; trackId: string } | null => {
    if (!(target instanceof HTMLElement)) return null;
    const cell = target.closest<HTMLElement>('[data-frame-index][data-track-id]');
    if (!cell) return null;
    const frameAttr = cell.dataset.frameIndex;
    if (!frameAttr) return null;
    const frame = Number(frameAttr);
    if (Number.isNaN(frame)) return null;
    const trackId = cell.dataset.trackId;
    if (!trackId) return null;
    return { frame, trackId };
  };

  const getTrackAtPoint = (x: number, y: number): { frame: number; trackId: string } | null => {
    const el = document.elementFromPoint(x, y);
    return getTrackTarget(el);
  };

  const getRulerTarget = (target: EventTarget | null): { frame: number } | null => {
    if (!(target instanceof HTMLElement)) return null;
    const cell = target.closest<HTMLElement>('[data-frame-index][data-ruler]');
    if (!cell) return null;
    const frameAttr = cell.dataset.frameIndex;
    if (!frameAttr) return null;
    const frame = Number(frameAttr);
    if (Number.isNaN(frame)) return null;
    return { frame };
  };

  const getScrubFrameAtPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    if (!(el instanceof HTMLElement)) return null;
    const cell = el.closest<HTMLElement>('[data-frame-index]');
    if (!cell) return null;
    const frameAttr = cell.dataset.frameIndex;
    if (!frameAttr) return null;
    const frame = Number(frameAttr);
    if (Number.isNaN(frame)) return null;
    return frame;
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearLongPressTimer();
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();
    onOpenContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const rulerTarget = getRulerTarget(e.target);
    const target = getTrackTarget(e.target);
    pendingTapRef.current = null;
    scrubPendingRef.current = null;
    longPressActionRef.current = null;
    longPressTargetRef.current = null;
    longPressActiveRef.current = false;

    if (rulerTarget) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearLongPressTimer();
      longPressPointRef.current = null;
      scrubPendingRef.current = { frame: rulerTarget.frame, x: e.clientX, y: e.clientY };
      isScrubbingRef.current = false;
      return;
    }

    if (e.pointerType === 'mouse') {
      if (e.button !== 0 || !target) return;
      pendingTapRef.current = {
        frame: target.frame,
        trackId: target.trackId,
        pointerType: e.pointerType,
        x: e.clientX,
        y: e.clientY,
      };
      return;
    }

    if (e.pointerType !== 'touch') return;
    longPressPointRef.current = { x: e.clientX, y: e.clientY };

    if (target) {
      pendingTapRef.current = {
        frame: target.frame,
        trackId: target.trackId,
        pointerType: e.pointerType,
        x: e.clientX,
        y: e.clientY,
      };
      longPressActionRef.current = 'selection';
      longPressTargetRef.current = target;
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        longPressActiveRef.current = true;
        pendingTapRef.current = null;
        if (target.trackId) onTrackSelect?.(target.trackId);
        longPressTimerRef.current = null;
      }, 420);
      return;
    }

    if (!onOpenContextMenu) return;
    longPressActionRef.current = 'menu';
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      onOpenContextMenu({ x: e.clientX, y: e.clientY });
      longPressActionRef.current = null;
      longPressTimerRef.current = null;
    }, 520);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (scrubPendingRef.current || isScrubbingRef.current) {
      const pending = scrubPendingRef.current;
      if (pending) {
        const dx = e.clientX - pending.x;
        const dy = e.clientY - pending.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 4) return;
        if (e.pointerType === 'touch' && Math.abs(dy) < Math.abs(dx)) {
          scrubPendingRef.current = null;
          return;
        }

        isScrubbingRef.current = true;
        scrubPendingRef.current = null;
        onScrubStart?.(pending.frame);
      }

      if (isScrubbingRef.current) {
        const frame = getScrubFrameAtPoint(e.clientX, e.clientY);
        if (frame !== null) onScrubMove?.(frame);
      }
      return;
    }

    const point = longPressPointRef.current;
    if (point) {
      const dx = e.clientX - point.x;
      const dy = e.clientY - point.y;
      const distance = Math.hypot(dx, dy);
      if (e.pointerType === 'touch') {
        if (!longPressActiveRef.current && distance > 8) {
          clearLongPressTimer();
          longPressPointRef.current = null;
          longPressActionRef.current = null;
          longPressTargetRef.current = null;
          pendingTapRef.current = null;
        }

        if (
          longPressActiveRef.current &&
          longPressActionRef.current === 'selection' &&
          !isSelectingRef.current &&
          distance > 6
        ) {
          const anchorFrame = longPressTargetRef.current?.frame;
          if (anchorFrame !== null && anchorFrame !== undefined) {
            selectionAnchorRef.current = anchorFrame;
            isSelectingRef.current = true;
            if (longPressTargetRef.current?.trackId) onTrackSelect?.(longPressTargetRef.current.trackId);
            const target = getTrackAtPoint(e.clientX, e.clientY);
            const endFrame = target?.frame ?? anchorFrame;
            onSelectionChange?.({ startFrame: anchorFrame, endFrame });
            longPressPointRef.current = null;
          }
        }
      } else if (distance > 8) {
        clearLongPressTimer();
        longPressPointRef.current = null;
      }
    }

    if (isSelectingRef.current) {
      const target = getTrackAtPoint(e.clientX, e.clientY);
      if (!target || selectionAnchorRef.current === null) return;
      onSelectionChange?.({ startFrame: selectionAnchorRef.current, endFrame: target.frame });
      return;
    }

    if (e.pointerType === 'touch') return;

    const pending = pendingTapRef.current;
    if (!pending || pending.pointerType !== 'mouse') return;
    const dx = e.clientX - pending.x;
    const dy = e.clientY - pending.y;
    if (Math.hypot(dx, dy) < 4) return;

    selectionAnchorRef.current = pending.frame;
    isSelectingRef.current = true;
    if (pending.trackId) onTrackSelect?.(pending.trackId);
    onSelectionChange?.({ startFrame: pending.frame, endFrame: pending.frame });
    const target = getTrackAtPoint(e.clientX, e.clientY);
    if (target) {
      onSelectionChange?.({ startFrame: pending.frame, endFrame: target.frame });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    clearLongPressTimer();
    longPressPointRef.current = null;
    const pending = pendingTapRef.current;
    const longPressAction = longPressActionRef.current;
    const longPressActive = longPressActiveRef.current;

    if (scrubPendingRef.current) {
      onFrameTap(scrubPendingRef.current.frame);
      scrubPendingRef.current = null;
      return;
    }

    if (isScrubbingRef.current) {
      onScrubEnd?.();
      isScrubbingRef.current = false;
      return;
    }

    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      selectionAnchorRef.current = null;
      pendingTapRef.current = null;
      longPressActionRef.current = null;
      longPressActiveRef.current = false;
      return;
    }

    if (longPressActive && longPressAction === 'selection') {
      if (onOpenContextMenu) onOpenContextMenu({ x: e.clientX, y: e.clientY });
      pendingTapRef.current = null;
      longPressActionRef.current = null;
      longPressActiveRef.current = false;
      selectionAnchorRef.current = null;
      return;
    }

    if (!pending) {
      selectionAnchorRef.current = null;
      longPressActionRef.current = null;
      longPressActiveRef.current = false;
      return;
    }

    onFrameTap(pending.frame);
    if (pending.trackId) onTrackSelect?.(pending.trackId);
    pendingTapRef.current = null;
    longPressActionRef.current = null;
    longPressActiveRef.current = false;
  };

  const handlePointerCancel = () => {
    clearLongPressTimer();
    longPressPointRef.current = null;
    pendingTapRef.current = null;
    scrubPendingRef.current = null;
    if (isScrubbingRef.current) onScrubEnd?.();
    isScrubbingRef.current = false;
    isSelectingRef.current = false;
    selectionAnchorRef.current = null;
    longPressActionRef.current = null;
    longPressActiveRef.current = false;
  };

  return (
    <div className="h-full w-full bg-gray-100 select-none">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-x-auto overflow-y-hidden snap-x snap-proximity overscroll-x-contain cursor-default"
        onClick={handleBackdropClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
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
            />
          ))}

          {rightSpacerWidth > 0 && <div className="shrink-0 h-full" style={{ width: `${rightSpacerWidth}px` }} />}
        </div>
      </div>
    </div>
  );
};
