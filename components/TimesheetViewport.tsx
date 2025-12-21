import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  isScrubbing: boolean;
  onFrameTap: (frame: number) => void;
  onBackgroundClick?: () => void;
  onFirstVisibleColumnChange?: (columnIndex: number) => void;
  onOpenSelectionMenu?: (point: { x: number; y: number }) => void;
  onSelectionChange?: (range: SelectionRange | null) => void;
  onSelectionScrub?: (frame: number, trackId: string) => void;
  onTrackSelect?: (trackId: string) => void;
  onScrubStart?: (frame: number) => void;
  onScrubMove?: (frame: number) => void;
  onScrubEnd?: () => void;
  onZoomChange?: (zoom: number) => void;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const LONG_PRESS_MENU_MS = 700;
const EDGE_SCROLL_SIZE = 32;
const EDGE_SCROLL_MAX_SPEED = 20;
const EDGE_SCROLL_OFFSET = 10;

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
  isScrubbing,
  onFrameTap,
  onBackgroundClick,
  onFirstVisibleColumnChange,
  onOpenSelectionMenu,
  onSelectionChange,
  onSelectionScrub,
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
  const pinchStateRef = useRef<{
    startDistance: number;
    startZoom: number;
    startCenter: { x: number; y: number };
    mode: 'pan' | 'zoom' | null;
  } | null>(null);
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
  const [wrapCue, setWrapCue] = useState<'up' | 'down' | null>(null);
  const wrapCueRef = useRef<'up' | 'down' | null>(null);
  const autoScrollRef = useRef<{
    rafId: number | null;
    pointerX: number;
    pointerY: number;
    pointerType: string;
  }>({ rafId: null, pointerX: 0, pointerY: 0, pointerType: 'mouse' });
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionScrubRef = useRef(onSelectionScrub);
  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in window);
  }, []);
  const isZoomed = zoom > 1;
  const isAutoScrollEnabled = isAutoScrollActive || isScrubbing;
  const allowSingleFingerPan = !isIOS && !isZoomed;
  const touchActionValue: React.CSSProperties['touchAction'] = isZoomed ? 'none' : isIOS ? 'pan-x pan-y' : 'none';

  useEffect(() => {
    selectionRangeRef.current = selection;
  }, [selection]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    onSelectionScrubRef.current = onSelectionScrub;
  }, [onSelectionScrub]);

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
    const baseWidth = Math.round(columnWidth * 0.1);
    const minWidth = Math.max(44, Math.round(columnWidth * 0.08));
    const maxWidth = Math.max(64, Math.round(columnWidth * 0.14));
    return clamp(baseWidth, minWidth, maxWidth);
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

  const scrollMetricsRef = useRef({
    columnWidth,
    rowHeight,
    columnHeight,
    framesPerColumn,
    totalColumns,
  });

  useEffect(() => {
    scrollMetricsRef.current = {
      columnWidth,
      rowHeight,
      columnHeight,
      framesPerColumn,
      totalColumns,
    };
  }, [columnHeight, columnWidth, framesPerColumn, rowHeight, totalColumns]);

  const scrollToFrame = useCallback(
    (
      frame: number,
      options?: {
        behavior?: ScrollBehavior;
        marginScale?: number;
      }
    ) => {
      const el = scrollRef.current;
      if (!el || columnWidth <= 0 || rowHeight <= 0) return;

      const columnIndex = Math.floor(frame / framesPerColumn);
      const rowIndex = frame % framesPerColumn;
      const columnLeft = columnIndex * columnWidth;
      const columnRight = columnLeft + columnWidth;
      const rowTop = rowIndex * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const viewportWidth = el.clientWidth;
      const viewportHeight = el.clientHeight;

      const marginScale = options?.marginScale ?? 1;
      const baseMarginX = Math.min(columnWidth * 0.12, 48);
      const baseMarginY = Math.min(rowHeight * 2.2, 56);
      const marginX = baseMarginX * marginScale;
      const marginY = baseMarginY * marginScale;

      let nextLeft = el.scrollLeft;
      let nextTop = el.scrollTop;

      if (columnLeft < nextLeft + marginX) {
        nextLeft = Math.max(0, columnLeft - marginX);
      } else if (columnRight > nextLeft + viewportWidth - marginX) {
        nextLeft = Math.max(0, columnRight - viewportWidth + marginX);
      }

      if (rowTop < nextTop + marginY) {
        nextTop = Math.max(0, rowTop - marginY);
      } else if (rowBottom > nextTop + viewportHeight - marginY) {
        nextTop = Math.max(0, rowBottom - viewportHeight + marginY);
      }

      if (nextLeft !== el.scrollLeft || nextTop !== el.scrollTop) {
        el.scrollTo({ left: nextLeft, top: nextTop, behavior: options?.behavior ?? 'smooth' });
      }
    },
    [columnWidth, framesPerColumn, rowHeight]
  );

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
    if (!isAutoScrollEnabled) {
      lastAutoSheetRef.current = null;
      return;
    }
    const el = scrollRef.current;
    if (!el || columnWidth <= 0 || rowHeight <= 0) return;

    if (!isZoomed) {
      const sheetIndex = Math.floor(currentFrame / framesPerSheet);
      if (lastAutoSheetRef.current === sheetIndex) return;
      lastAutoSheetRef.current = sheetIndex;

      // 再生中/スクラブ中にシート境界へ到達したら自動スクロール
      const targetLeft = sheetIndex * COLUMNS_PER_SHEET * columnWidth;
      const behavior: ScrollBehavior = isScrubbing ? 'auto' : 'smooth';
      el.scrollTo({ left: targetLeft, behavior });
      return;
    }

    lastAutoSheetRef.current = null;

    const marginScale = isScrubbing ? 1.8 : 1.5;
    scrollToFrame(currentFrame, { behavior: 'auto', marginScale });
  }, [
    columnWidth,
    currentFrame,
    framesPerSheet,
    isAutoScrollEnabled,
    isScrubbing,
    isZoomed,
    rowHeight,
    scrollToFrame,
  ]);

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

  const getTrackTarget = useCallback((target: EventTarget | null): { frame: number; trackId: string } | null => {
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
  }, []);

  const getTrackAtPoint = useCallback(
    (x: number, y: number): { frame: number; trackId: string } | null => {
      const el = document.elementFromPoint(x, y);
      return getTrackTarget(el);
    },
    [getTrackTarget]
  );

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

  const updateWrapCue = useCallback((next: 'up' | 'down' | null) => {
    if (wrapCueRef.current === next) return;
    wrapCueRef.current = next;
    setWrapCue(next);
  }, []);

  const updateSelectionAtPoint = useCallback(
    (clientX: number, clientY: number, pointerType: string) => {
      if (selectionAnchorRef.current === null) return;
      const target = getTrackAtPoint(clientX, clientY);
      if (!target) return;
      const range = { startFrame: selectionAnchorRef.current, endFrame: target.frame };
      selectionRangeRef.current = range;
      onSelectionChangeRef.current?.(range);
      if (pointerType === 'touch' && target.trackId) {
        onSelectionScrubRef.current?.(target.frame, target.trackId);
      }
    },
    [getTrackAtPoint]
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current.rafId !== null) {
      cancelAnimationFrame(autoScrollRef.current.rafId);
      autoScrollRef.current.rafId = null;
    }
    updateWrapCue(null);
  }, [updateWrapCue]);

  const runAutoScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !isSelectingRef.current) {
      stopAutoScroll();
      return;
    }

    const rect = el.getBoundingClientRect();
    const { pointerX, pointerY, pointerType } = autoScrollRef.current;
    const edge = EDGE_SCROLL_SIZE;

    let dirX = 0;
    let dirY = 0;
    let speedX = 0;
    let speedY = 0;

    if (pointerX < rect.left + edge) {
      dirX = -1;
      speedX = ((rect.left + edge - pointerX) / edge) * EDGE_SCROLL_MAX_SPEED;
    } else if (pointerX > rect.right - edge) {
      dirX = 1;
      speedX = ((pointerX - (rect.right - edge)) / edge) * EDGE_SCROLL_MAX_SPEED;
    }

    if (pointerY < rect.top + edge) {
      dirY = -1;
      speedY = ((rect.top + edge - pointerY) / edge) * EDGE_SCROLL_MAX_SPEED;
    } else if (pointerY > rect.bottom - edge) {
      dirY = 1;
      speedY = ((pointerY - (rect.bottom - edge)) / edge) * EDGE_SCROLL_MAX_SPEED;
    }

    if (dirX === 0 && dirY === 0) {
      stopAutoScroll();
      return;
    }

    const { columnWidth, columnHeight, rowHeight, framesPerColumn, totalColumns } = scrollMetricsRef.current;
    const maxScrollTop = Math.max(0, columnHeight - el.clientHeight);
    const maxScrollLeft = Math.max(0, totalColumns * columnWidth - el.clientWidth);

    let nextLeft = el.scrollLeft;
    let nextTop = el.scrollTop;
    let wrapDirection: 'up' | 'down' | null = null;
    let didWrap = false;

    if (dirY > 0) {
      if (el.scrollTop < maxScrollTop - 0.5) {
        nextTop = Math.min(maxScrollTop, el.scrollTop + speedY);
      } else if (el.scrollLeft < maxScrollLeft - 0.5) {
        nextLeft = Math.min(maxScrollLeft, el.scrollLeft + columnWidth);
        nextTop = 0;
        wrapDirection = 'down';
        didWrap = true;
      }
    } else if (dirY < 0) {
      if (el.scrollTop > 0.5) {
        nextTop = Math.max(0, el.scrollTop - speedY);
      } else if (el.scrollLeft > 0.5) {
        nextLeft = Math.max(0, el.scrollLeft - columnWidth);
        nextTop = maxScrollTop;
        wrapDirection = 'up';
        didWrap = true;
      }
    }

    if (!didWrap && dirX !== 0) {
      nextLeft = clamp(el.scrollLeft + dirX * speedX, 0, maxScrollLeft);
    }

    if (nextLeft !== el.scrollLeft) el.scrollLeft = nextLeft;
    if (nextTop !== el.scrollTop) el.scrollTop = nextTop;

    let cue: 'up' | 'down' | null = null;
    if (dirY > 0 && el.scrollTop >= maxScrollTop - 0.5 && el.scrollLeft < maxScrollLeft - 0.5) {
      cue = 'down';
    } else if (dirY < 0 && el.scrollTop <= 0.5 && el.scrollLeft > 0.5) {
      cue = 'up';
    }
    updateWrapCue(cue);

    const edgeOffset = Math.min(EDGE_SCROLL_OFFSET, Math.max(2, rowHeight * 0.4));
    let effectiveX = pointerX;
    let effectiveY = pointerY;
    if (dirX !== 0) {
      effectiveX = dirX > 0 ? rect.right - edgeOffset : rect.left + edgeOffset;
    }
    if (wrapDirection === 'down') {
      effectiveY = rect.top + edgeOffset;
    } else if (wrapDirection === 'up') {
      effectiveY = rect.bottom - edgeOffset;
    } else if (dirY !== 0) {
      effectiveY = dirY > 0 ? rect.bottom - edgeOffset : rect.top + edgeOffset;
    }

    if (framesPerColumn > 0 && rowHeight > 0) {
      updateSelectionAtPoint(effectiveX, effectiveY, pointerType);
    }

    autoScrollRef.current.rafId = requestAnimationFrame(runAutoScroll);
  }, [stopAutoScroll, updateSelectionAtPoint, updateWrapCue]);

  const startAutoScroll = useCallback((clientX: number, clientY: number, pointerType: string) => {
    autoScrollRef.current.pointerX = clientX;
    autoScrollRef.current.pointerY = clientY;
    autoScrollRef.current.pointerType = pointerType;
    if (autoScrollRef.current.rafId === null) {
      autoScrollRef.current.rafId = requestAnimationFrame(runAutoScroll);
    }
  }, [runAutoScroll]);

  const isFrameInSelection = (frame: number): boolean => {
    const range = selectionRangeRef.current;
    if (!range) return false;
    const start = Math.min(range.startFrame, range.endFrame);
    const end = Math.max(range.startFrame, range.endFrame);
    return frame >= start && frame <= end;
  };

  const isSelectionHit = (frame: number, trackId: string | null): boolean => {
    if (!isFrameInSelection(frame)) return false;
    if (editTarget === 'all') return true;
    if (!trackId) return false;
    return trackId === editTarget;
  };

  const openSelectionMenu = (point: { x: number; y: number }, target: { frame: number; trackId: string } | null) => {
    if (!onOpenSelectionMenu || !target) return;
    const hitSelection = isSelectionHit(target.frame, target.trackId);
    if (!hitSelection) {
      const range = { startFrame: target.frame, endFrame: target.frame };
      selectionRangeRef.current = range;
      onSelectionChange?.(range);
    }
    if (target.trackId) onTrackSelect?.(target.trackId);
    onOpenSelectionMenu(point);
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
    stopAutoScroll();
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

  const startLongPressMenu = (
    e: React.PointerEvent,
    target: { frame: number; trackId: string } | null
  ) => {
    if (e.pointerType !== 'touch') return;
    if (!onOpenSelectionMenu || !target) return;
    longPressPointRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      openSelectionMenu({ x: e.clientX, y: e.clientY }, target);
      pendingTapRef.current = null;
      selectionAnchorRef.current = null;
      scrubPendingRef.current = null;
      isSelectingRef.current = false;
      longPressPointRef.current = null;
      longPressTimerRef.current = null;
    }, LONG_PRESS_MENU_MS);
  };

  useEffect(() => {
    return () => clearLongPressTimer();
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onOpenSelectionMenu) return;
    const target = getTrackTarget(e.target);
    if (!target) return;
    e.preventDefault();
    openSelectionMenu({ x: e.clientX, y: e.clientY }, target);
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
          pinchStateRef.current = {
            startDistance: pinchInfo.distance,
            startZoom: zoom,
            startCenter: pinchInfo.center,
            mode: null,
          };
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
      if (e.pointerType === 'touch') {
        if (target.frame === currentFrame) {
          scrubPendingRef.current = { frame: target.frame, x: e.clientX, y: e.clientY };
          isScrubbingRef.current = false;
        }
        pendingTapRef.current = {
          frame: target.frame,
          trackId: target.trackId,
          pointerType: e.pointerType,
          x: e.clientX,
          y: e.clientY,
        };
        selectionAnchorRef.current = target.frame;
        startLongPressMenu(e, target);
        return;
      }
      return;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointersRef.current.has(e.pointerId)) {
      updatePointer(e);
    }

    if (isPinchingRef.current) {
      const pinchState = pinchStateRef.current;
      const pinchInfo = getPinchInfo();
      if (!pinchState || !pinchInfo || pinchState.startDistance <= 0) return;

      if (!pinchState.mode) {
        const distanceDelta = Math.abs(pinchInfo.distance - pinchState.startDistance);
        const centerDelta = Math.hypot(
          pinchInfo.center.x - pinchState.startCenter.x,
          pinchInfo.center.y - pinchState.startCenter.y
        );
        const zoomThreshold = isZoomed ? 16 : 10;
        const panThreshold = 8;

        if (distanceDelta >= zoomThreshold) {
          pinchState.mode = 'zoom';
        } else if (centerDelta >= panThreshold) {
          pinchState.mode = 'pan';
        }
      }

      if (pinchState.mode === 'pan') {
        const panStart = pinchPanStartRef.current;
        const el = scrollRef.current;
        if (panStart && el) {
          const dx = pinchInfo.center.x - panStart.centerX;
          const dy = pinchInfo.center.y - panStart.centerY;
          el.scrollLeft = panStart.scrollLeft - dx;
          el.scrollTop = panStart.scrollTop - dy;
        }
        e.preventDefault();
        return;
      }

      if (!pinchState.mode) {
        e.preventDefault();
        return;
      }

      const nextZoom = Math.min(
        maxZoom,
        Math.max(minZoom, pinchState.startZoom * (pinchInfo.distance / pinchState.startDistance))
      );

      const zoomDelta = Math.abs(nextZoom - zoom);
      const el = scrollRef.current;

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
        pendingTapRef.current = null;
        selectionAnchorRef.current = null;
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
      if (e.pointerType === 'touch' && onSelectionScrub) {
        onSelectionScrub(target.frame, target.trackId);
      }
      startAutoScroll(e.clientX, e.clientY, e.pointerType);
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

    if (isScrubbingRef.current) {
      onScrubEnd?.();
      isScrubbingRef.current = false;
      scrubPendingRef.current = null;
      pendingTapRef.current = null;
      selectionAnchorRef.current = null;
      return;
    }

    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      selectionAnchorRef.current = null;
      pendingTapRef.current = null;
      stopAutoScroll();
      return;
    }

    if (scrubPendingRef.current && !pending) {
      onFrameTap(scrubPendingRef.current.frame);
      scrubPendingRef.current = null;
      return;
    }

    if (scrubPendingRef.current) {
      scrubPendingRef.current = null;
    }

    if (!pending) {
      selectionAnchorRef.current = null;
      return;
    }

    const hadSelection = selectionRangeRef.current !== null;
    const hitSelection = isSelectionHit(pending.frame, pending.trackId);
    if (hadSelection && !hitSelection) {
      selectionRangeRef.current = null;
      onSelectionChange?.(null);
    }

    if (pending.pointerType !== 'mouse' && !hitSelection) {
      const range = { startFrame: pending.frame, endFrame: pending.frame };
      selectionRangeRef.current = range;
      onSelectionChange?.(range);
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
    <div className="relative h-full w-full bg-gray-100 select-none">
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
      {wrapCue === 'up' && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-[11px] text-gray-600 shadow-sm">
          ↑ 続き
        </div>
      )}
      {wrapCue === 'down' && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-[11px] text-gray-600 shadow-sm">
          ↓ 続き
        </div>
      )}
    </div>
  );
};
