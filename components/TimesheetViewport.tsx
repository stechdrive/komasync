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
  zoom: number;
  minZoom: number;
  maxZoom: number;
  isAutoScrollActive: boolean;
  onFrameTap: (frame: number) => void;
  onBackgroundClick?: () => void;
  onFirstVisibleColumnChange?: (columnIndex: number) => void;
  onOpenContextMenu?: (point: { x: number; y: number }) => void;
  onSelectionChange?: (range: SelectionRange | null) => void;
  onSelectionEnd?: (range: SelectionRange | null, point: { x: number; y: number }) => void;
  onTrackSelect?: (trackId: string) => void;
  onScrubStart?: (frame: number) => void;
  onScrubMove?: (frame: number) => void;
  onScrubEnd?: () => void;
  onZoomChange?: (zoom: number) => void;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const LONG_PRESS_MENU_MS = 700;

export const TimesheetViewport: React.FC<TimesheetViewportProps> = ({
  tracks,
  currentFrame,
  editTarget,
  selection,
  fps,
  zoom,
  minZoom,
  maxZoom,
  isAutoScrollActive,
  onFrameTap,
  onBackgroundClick,
  onFirstVisibleColumnChange,
  onOpenContextMenu,
  onSelectionChange,
  onSelectionEnd,
  onTrackSelect,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  onZoomChange,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFirstVisibleColRef = useRef<number | null>(null);
  const lastAutoSheetRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressPointRef = useRef<{ x: number; y: number } | null>(null);
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
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const pinchPanStartRef = useRef<{ centerX: number; centerY: number; scrollLeft: number; scrollTop: number } | null>(
    null
  );
  const isPinchingRef = useRef(false);
  const zoomAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    contentX: number;
    contentY: number;
  } | null>(null);
  const prevMetricsRef = useRef<{ columnWidth: number; rowHeight: number } | null>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const isSelectingRef = useRef(false);
  const selectionRangeRef = useRef<SelectionRange | null>(selection);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in window);
  }, []);
  const isZoomed = zoom > 1;
  const allowSingleFingerPan = !isIOS && !isZoomed;
  const touchActionValue: React.CSSProperties['touchAction'] = isZoomed ? 'none' : isIOS ? 'pan-x pan-y' : 'none';

  useEffect(() => {
    selectionRangeRef.current = selection;
  }, [selection]);

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

  const baseColumnWidth = useMemo(() => {
    if (viewportWidth <= 0) return 1;
    return Math.max(1, viewportWidth / 2);
  }, [viewportWidth]);

  const columnWidth = useMemo(() => {
    return Math.max(1, baseColumnWidth * zoom);
  }, [baseColumnWidth, zoom]);

  const rulerWidth = useMemo(() => {
    return clamp(Math.round(columnWidth * 0.25), 36, 56);
  }, [columnWidth]);

  const rowHeight = useMemo(() => {
    if (viewportHeight <= 0) return 0;
    return Math.max(1, (viewportHeight / framesPerColumn) * zoom);
  }, [framesPerColumn, viewportHeight, zoom]);

  const trackVolumeMax = useMemo(() => {
    const maxMap = new Map<string, number>();
    tracks.forEach((track) => {
      let max = 0;
      track.frames.forEach((frame) => {
        if (frame.volume > max) max = frame.volume;
      });
      maxMap.set(track.id, max);
    });
    return maxMap;
  }, [tracks]);

  const columnHeight = useMemo(() => {
    return framesPerColumn * rowHeight;
  }, [framesPerColumn, rowHeight]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      prevMetricsRef.current = { columnWidth, rowHeight };
      return;
    }

    const prev = prevMetricsRef.current;
    prevMetricsRef.current = { columnWidth, rowHeight };
    if (!prev || prev.columnWidth <= 0 || prev.rowHeight <= 0) return;
    if (prev.columnWidth === columnWidth && prev.rowHeight === rowHeight) return;

    const scaleX = columnWidth / prev.columnWidth;
    const scaleY = rowHeight / prev.rowHeight;
    const rect = el.getBoundingClientRect();
    const anchor = zoomAnchorRef.current;

    const centerX = el.scrollLeft + rect.width / 2;
    const centerY = el.scrollTop + rect.height / 2;
    const anchorContentX = anchor?.contentX ?? centerX;
    const anchorContentY = anchor?.contentY ?? centerY;
    const anchorClientX = anchor?.clientX ?? rect.left + rect.width / 2;
    const anchorClientY = anchor?.clientY ?? rect.top + rect.height / 2;

    const nextScrollLeft = anchorContentX * scaleX - (anchorClientX - rect.left);
    const nextScrollTop = anchorContentY * scaleY - (anchorClientY - rect.top);

    zoomAnchorRef.current = null;
    requestAnimationFrame(() => {
      el.scrollTo({ left: nextScrollLeft, top: nextScrollTop });
    });
  }, [columnWidth, rowHeight]);

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

  const updatePointer = (e: React.PointerEvent) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const removePointer = (pointerId: number) => {
    activePointersRef.current.delete(pointerId);
  };

  const getPinchInfo = (): { distance: number; center: { x: number; y: number } } | null => {
    const points = Array.from(activePointersRef.current.values());
    if (points.length < 2) return null;
    const [p1, p2] = points;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const distance = Math.hypot(dx, dy);
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    return { distance, center };
  };

  const cancelPointerInteraction = () => {
    clearLongPressTimer();
    longPressPointRef.current = null;
    pendingTapRef.current = null;
    scrubPendingRef.current = null;
    stopPan();
    if (isScrubbingRef.current) onScrubEnd?.();
    isScrubbingRef.current = false;
    isSelectingRef.current = false;
    selectionAnchorRef.current = null;
  };

  const stopPinch = () => {
    isPinchingRef.current = false;
    pinchStateRef.current = null;
    pinchPanStartRef.current = null;
  };

  const startPan = (e: React.PointerEvent) => {
    if (!allowSingleFingerPan) return;
    const el = scrollRef.current;
    if (!el) return;
    isPanningRef.current = true;
    panPointerIdRef.current = e.pointerId;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    scrubPendingRef.current = null;
    pendingTapRef.current = null;
    selectionAnchorRef.current = null;
    clearLongPressTimer();
    longPressPointRef.current = null;
  };

  const updatePan = (e: React.PointerEvent) => {
    if (!allowSingleFingerPan) return;
    if (!isPanningRef.current || panPointerIdRef.current !== e.pointerId) return;
    const el = scrollRef.current;
    const start = panStartRef.current;
    if (!el || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    el.scrollLeft = start.scrollLeft - dx;
    el.scrollTop = start.scrollTop - dy;
    e.preventDefault();
  };

  const stopPan = () => {
    isPanningRef.current = false;
    panPointerIdRef.current = null;
    panStartRef.current = null;
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPressMenu = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !onOpenContextMenu) return;
    longPressPointRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      onOpenContextMenu({ x: e.clientX, y: e.clientY });
      pendingTapRef.current = null;
      selectionAnchorRef.current = null;
      longPressPointRef.current = null;
      longPressTimerRef.current = null;
    }, LONG_PRESS_MENU_MS);
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
    updatePointer(e);
    const scrollEl = scrollRef.current;
    if (allowSingleFingerPan && e.pointerType !== 'mouse' && scrollEl?.setPointerCapture) {
      scrollEl.setPointerCapture(e.pointerId);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: scrollEl.scrollLeft,
        scrollTop: scrollEl.scrollTop,
      };
    }
    if (activePointersRef.current.size >= 2) {
      stopPan();
      if (!isPinchingRef.current && onZoomChange) {
        const pinchInfo = getPinchInfo();
        if (pinchInfo && pinchInfo.distance > 0) {
          isPinchingRef.current = true;
          pinchStateRef.current = { startDistance: pinchInfo.distance, startZoom: zoom };
          if (scrollEl) {
            pinchPanStartRef.current = {
              centerX: pinchInfo.center.x,
              centerY: pinchInfo.center.y,
              scrollLeft: scrollEl.scrollLeft,
              scrollTop: scrollEl.scrollTop,
            };
          }
          cancelPointerInteraction();
        }
      }
      return;
    }

    const rulerTarget = getRulerTarget(e.target);
    const target = getTrackTarget(e.target);
    pendingTapRef.current = null;
    scrubPendingRef.current = null;
    selectionAnchorRef.current = null;
    clearLongPressTimer();
    longPressPointRef.current = null;

    if (rulerTarget) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
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

    if (target) {
      if (e.pointerType === 'touch' && target.frame === currentFrame) {
        scrubPendingRef.current = { frame: target.frame, x: e.clientX, y: e.clientY };
        isScrubbingRef.current = false;
        return;
      }
      if (e.pointerType === 'touch') {
        pendingTapRef.current = {
          frame: target.frame,
          trackId: target.trackId,
          pointerType: e.pointerType,
          x: e.clientX,
          y: e.clientY,
        };
        selectionAnchorRef.current = target.frame;
        startLongPressMenu(e);
        return;
      }
      return;
    }

    startLongPressMenu(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointersRef.current.has(e.pointerId)) {
      updatePointer(e);
    }

    if (isPinchingRef.current) {
      const pinchState = pinchStateRef.current;
      const pinchInfo = getPinchInfo();
      if (!pinchState || !pinchInfo || pinchState.startDistance <= 0) return;

      const nextZoom = Math.min(
        maxZoom,
        Math.max(minZoom, pinchState.startZoom * (pinchInfo.distance / pinchState.startDistance))
      );

      const zoomDelta = Math.abs(nextZoom - zoom);
      const panStart = pinchPanStartRef.current;
      const el = scrollRef.current;
      if (panStart && el && zoomDelta < 0.02) {
        const dx = pinchInfo.center.x - panStart.centerX;
        const dy = pinchInfo.center.y - panStart.centerY;
        el.scrollLeft = panStart.scrollLeft - dx;
        el.scrollTop = panStart.scrollTop - dy;
        e.preventDefault();
        return;
      }

      if (zoomDelta < 0.0001) {
        e.preventDefault();
        return;
      }

      if (el) {
        const rect = el.getBoundingClientRect();
        const contentX = el.scrollLeft + (pinchInfo.center.x - rect.left);
        const contentY = el.scrollTop + (pinchInfo.center.y - rect.top);
        zoomAnchorRef.current = {
          clientX: pinchInfo.center.x,
          clientY: pinchInfo.center.y,
          contentX,
          contentY,
        };
        pinchPanStartRef.current = {
          centerX: pinchInfo.center.x,
          centerY: pinchInfo.center.y,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
        };
      }

      onZoomChange?.(nextZoom);
      e.preventDefault();
      return;
    }

    if (isPanningRef.current && panPointerIdRef.current === e.pointerId) {
      if (!allowSingleFingerPan) {
        stopPan();
      } else {
        updatePan(e);
      }
      return;
    }

    if (scrubPendingRef.current || isScrubbingRef.current) {
      const pending = scrubPendingRef.current;
      if (pending) {
        const dx = e.clientX - pending.x;
        const dy = e.clientY - pending.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 4) return;
        if (e.pointerType === 'touch' && Math.abs(dy) < Math.abs(dx) && allowSingleFingerPan) {
          startPan(e);
          updatePan(e);
          return;
        }

        isScrubbingRef.current = true;
        scrubPendingRef.current = null;
        clearLongPressTimer();
        longPressPointRef.current = null;
        onScrubStart?.(pending.frame);
      }

      if (isScrubbingRef.current) {
        if (e.pointerType === 'touch') {
          e.preventDefault();
        }
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
      if (distance > 8) {
        clearLongPressTimer();
        longPressPointRef.current = null;
      }
    }

    const pendingTouch = pendingTapRef.current;
    if (
      pendingTouch &&
      pendingTouch.pointerType === 'touch' &&
      selectionAnchorRef.current !== null &&
      !isSelectingRef.current
    ) {
      const dx = e.clientX - pendingTouch.x;
      const dy = e.clientY - pendingTouch.y;
      if (Math.hypot(dx, dy) > 6) {
        if (Math.abs(dx) > Math.abs(dy) && allowSingleFingerPan) {
          startPan(e);
          updatePan(e);
          return;
        }
        isSelectingRef.current = true;
        pendingTapRef.current = null;
        clearLongPressTimer();
        longPressPointRef.current = null;
        if (pendingTouch.trackId) onTrackSelect?.(pendingTouch.trackId);
      }
    }

    if (isSelectingRef.current) {
      const target = getTrackAtPoint(e.clientX, e.clientY);
      if (!target || selectionAnchorRef.current === null) return;
      if (e.pointerType === 'touch') {
        e.preventDefault();
      }
      const range = { startFrame: selectionAnchorRef.current, endFrame: target.frame };
      selectionRangeRef.current = range;
      onSelectionChange?.(range);
      return;
    }

    if (
      allowSingleFingerPan &&
      e.pointerType !== 'mouse' &&
      !pendingTapRef.current &&
      !scrubPendingRef.current &&
      panStartRef.current
    ) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      if (Math.hypot(dx, dy) > 6) {
        startPan(e);
        updatePan(e);
        return;
      }
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
    const initialRange = { startFrame: pending.frame, endFrame: pending.frame };
    selectionRangeRef.current = initialRange;
    onSelectionChange?.(initialRange);
    const target = getTrackAtPoint(e.clientX, e.clientY);
    if (target) {
      const nextRange = { startFrame: pending.frame, endFrame: target.frame };
      selectionRangeRef.current = nextRange;
      onSelectionChange?.(nextRange);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    removePointer(e.pointerId);
    const scrollEl = scrollRef.current;
    if (scrollEl?.hasPointerCapture?.(e.pointerId)) {
      scrollEl.releasePointerCapture(e.pointerId);
    }
    if (isPinchingRef.current) {
      if (activePointersRef.current.size < 2) {
        stopPinch();
      }
      stopPan();
      return;
    }

    clearLongPressTimer();
    longPressPointRef.current = null;
    const pending = pendingTapRef.current;

    if (isPanningRef.current && panPointerIdRef.current === e.pointerId) {
      stopPan();
      pendingTapRef.current = null;
      selectionAnchorRef.current = null;
      return;
    }

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
      const selectionRange = selectionRangeRef.current;
      if (selectionRange && onSelectionEnd) {
        onSelectionEnd(selectionRange, { x: e.clientX, y: e.clientY });
      }
      selectionAnchorRef.current = null;
      pendingTapRef.current = null;
      return;
    }

    if (!pending) {
      selectionAnchorRef.current = null;
      return;
    }

    onFrameTap(pending.frame);
    if (pending.trackId) onTrackSelect?.(pending.trackId);
    pendingTapRef.current = null;
    selectionAnchorRef.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    removePointer(e.pointerId);
    const scrollEl = scrollRef.current;
    if (scrollEl?.hasPointerCapture?.(e.pointerId)) {
      scrollEl.releasePointerCapture(e.pointerId);
    }
    if (isPinchingRef.current) {
      if (activePointersRef.current.size < 2) {
        stopPinch();
      }
      cancelPointerInteraction();
      return;
    }
    cancelPointerInteraction();
  };

  return (
    <div className="h-full w-full bg-gray-100 select-none">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-x-auto overflow-y-auto snap-x snap-proximity overscroll-x-contain overscroll-y-contain cursor-default"
        onClick={handleBackdropClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        style={{ touchAction: touchActionValue }}
      >
        <div className="flex" style={{ width: `${totalColumns * columnWidth}px`, height: `${columnHeight}px` }}>
          {leftSpacerWidth > 0 && (
            <div className="shrink-0" style={{ width: `${leftSpacerWidth}px`, height: `${columnHeight}px` }} />
          )}

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
              columnHeight={columnHeight}
              rulerWidth={rulerWidth}
              rowHeight={rowHeight}
              trackVolumeMax={trackVolumeMax}
              touchAction={touchActionValue}
            />
          ))}

          {rightSpacerWidth > 0 && (
            <div className="shrink-0" style={{ width: `${rightSpacerWidth}px`, height: `${columnHeight}px` }} />
          )}
        </div>
      </div>
    </div>
  );
};
