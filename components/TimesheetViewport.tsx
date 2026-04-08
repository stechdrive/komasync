import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Track } from '@/types';
import { getFramesPerColumn, getFramesPerSheet, COLUMNS_PER_SHEET } from '@/domain/timesheet';
import { formatTimecodeOneBased } from '@/domain/timecode';
import { TimesheetColumn } from '@/components/TimesheetColumn';
import { EditTarget, SelectionRange, SelectionRanges } from '@/domain/editTypes';
import type { Translator } from '@/domain/i18n';

type TimesheetViewportProps = {
  tracks: Track[];
  currentFrame: number;
  virtualMaxFrames: number;
  editTarget: EditTarget;
  mobileInteractionMode?: 'navigate' | 'select';
  selection: SelectionRanges;
  t: Translator;
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
  onSelectionChange?: (ranges: SelectionRanges) => void;
  onSelectionScrub?: (frame: number, trackId: string) => void;
  onSelectionCommit?: () => void;
  onTrackSelect?: (trackId: string) => void;
  onScrubStart?: (frame: number) => void;
  onScrubMove?: (frame: number) => void;
  onScrubEnd?: () => void;
  onZoomChange?: (zoom: number) => void;
};

type TrackRenderData = Pick<Track, 'id' | 'frames' | 'speechOverrides' | 'waveformReferenceMax'>;
type TrackDataKey = Pick<Track, 'frames' | 'speechOverrides'>;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const LONG_PRESS_MENU_MS = 700;
const EDGE_SCROLL_SIZE = 32;
const EDGE_SCROLL_MAX_SPEED = 20;
const EDGE_SCROLL_MAX_SPEED_MOUSE = 6;
const EDGE_SCROLL_OFFSET = 10;
const OVERSCAN_COLUMNS = 3;
const VISIBLE_COLUMNS = 2;
const MOBILE_PLAYHEAD_LANE_WIDTH = 28;
const MOBILE_PLAYHEAD_LANE_GAP = 8;
const MOBILE_SCRUB_RAIL_WIDTH = 44;
const MOBILE_SCRUB_RAIL_OFFSET = 6;
const MOBILE_SIDEBAR_WIDTH =
  MOBILE_PLAYHEAD_LANE_WIDTH + MOBILE_PLAYHEAD_LANE_GAP + MOBILE_SCRUB_RAIL_WIDTH + MOBILE_SCRUB_RAIL_OFFSET;

const normalizeSelectionRange = (range: SelectionRange): SelectionRange => {
  const startFrame = Math.max(0, Math.floor(Math.min(range.startFrame, range.endFrame)));
  const endFrame = Math.max(startFrame, Math.floor(Math.max(range.startFrame, range.endFrame)));
  return { startFrame, endFrame };
};

const mergeSelectionRanges = (ranges: SelectionRanges): SelectionRanges => {
  if (ranges.length === 0) return [];
  const normalized = ranges
    .map(normalizeSelectionRange)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);

  const merged: SelectionRanges = [{ ...normalized[0] }];
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    const last = merged[merged.length - 1];
    if (current.startFrame <= last.endFrame + 1) {
      last.endFrame = Math.max(last.endFrame, current.endFrame);
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
};

export const TimesheetViewport: React.FC<TimesheetViewportProps> = ({
  tracks,
  currentFrame,
  virtualMaxFrames: virtualMaxFramesProp,
  editTarget,
  mobileInteractionMode = 'navigate',
  selection,
  t,
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
  onSelectionCommit,
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
  const zoomScrollRafRef = useRef<number | null>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const selectionBaseRangesRef = useRef<SelectionRanges>(selection);
  const selectionDragStartFrameRef = useRef<number | null>(null);
  const selectionDragInitialRangesRef = useRef<SelectionRanges>(selection);
  const selectionPreserveInitialRef = useRef(false);
  const selectionTrackIdRef = useRef<string | null>(null);
  const isSelectingRef = useRef(false);
  const selectionRangeRef = useRef<SelectionRanges>(selection);
  const suppressBackdropClickRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const mouseSelectionCursorStateRef = useRef<{
    contentX: number;
    contentY: number;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  const mouseSelectionCursorRef = useRef<HTMLDivElement | null>(null);
  const mobileScrubRailRef = useRef<HTMLDivElement | null>(null);
  const mobileScrubPointerIdRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [isMouseSelectionCursorVisible, setIsMouseSelectionCursorVisible] = useState(false);
  const [isMobileScrubRailActive, setIsMobileScrubRailActive] = useState(false);
  const scrollLeftRef = useRef(0);
  const scrollTopRef = useRef(0);
  const scrollLeftRafRef = useRef<number | null>(null);
  const scrollTopRafRef = useRef<number | null>(null);
  const scrollLeftFlushTimerRef = useRef<number | null>(null);
  const scrollTopFlushTimerRef = useRef<number | null>(null);
  const rectRef = useRef<{
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  } | null>(null);
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
  const updateRectRef = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    rectRef.current = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
    };
  }, []);

  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in window);
  }, []);
  const isZoomed = zoom > 1;
  const isAutoScrollEnabled = isAutoScrollActive || isScrubbing;
  const pointerEdgeEpsilon = isIOS ? 0 : 1;
  const isCoarsePointer = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }, []);
  const getEdgeScrollSpeed = useCallback((distance: number, pointerType: string) => {
    const ratio = clamp(distance / EDGE_SCROLL_SIZE, 0, 1);
    if (pointerType === 'mouse') {
      // マウスの仮想カーソルは行き過ぎやすいので、端ではゆっくり立ち上げる。
      return ratio * ratio * EDGE_SCROLL_MAX_SPEED_MOUSE;
    }
    return ratio * EDGE_SCROLL_MAX_SPEED;
  }, []);

  useEffect(() => {
    selectionRangeRef.current = selection;
    selectionBaseRangesRef.current = selection;
    selectionDragInitialRangesRef.current = selection;
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
  const virtualMaxFrames = Math.max(maxFrames, currentFrame + 1, virtualMaxFramesProp ?? 0);
  const totalColumns = Math.max(2, Math.ceil(virtualMaxFrames / framesPerColumn));
  const isMobileTimesheetLayout = isCoarsePointer && viewportWidth > 0 && viewportWidth < 900;
  const isMobileSelectionMode = isMobileTimesheetLayout && mobileInteractionMode === 'select';
  const visibleColumnCount = isMobileTimesheetLayout ? 1 : VISIBLE_COLUMNS;
  const allowSingleFingerPan = !isIOS && !isZoomed;
  const touchActionValue: React.CSSProperties['touchAction'] = isMobileSelectionMode
    ? 'none'
    : isZoomed
      ? 'none'
      : isIOS
        ? 'pan-x pan-y'
        : 'none';

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setViewportWidth(rect.width);
      setViewportHeight(rect.height);
      updateRectRef();
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const ro = new ResizeObserver(() => updateSize());
    ro.observe(el);

    return () => ro.disconnect();
  }, [updateRectRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    scrollLeftRef.current = el.scrollLeft;
    scrollTopRef.current = el.scrollTop;
    setScrollLeft(el.scrollLeft);
    setScrollTop(el.scrollTop);

    const flushScrollLeft = () => {
      scrollLeftRafRef.current = null;
      setScrollLeft(scrollLeftRef.current);
    };
    const flushScrollTop = () => {
      scrollTopRafRef.current = null;
      setScrollTop(scrollTopRef.current);
    };

    const onScroll = () => {
      scrollLeftRef.current = el.scrollLeft;
      scrollTopRef.current = el.scrollTop;
      updateRectRef();
      if (scrollLeftRafRef.current === null) {
        scrollLeftRafRef.current = window.requestAnimationFrame(flushScrollLeft);
      }
      if (scrollTopRafRef.current === null) {
        scrollTopRafRef.current = window.requestAnimationFrame(flushScrollTop);
      }
      if (scrollLeftFlushTimerRef.current !== null) {
        window.clearTimeout(scrollLeftFlushTimerRef.current);
      }
      if (scrollTopFlushTimerRef.current !== null) {
        window.clearTimeout(scrollTopFlushTimerRef.current);
      }
      scrollLeftFlushTimerRef.current = window.setTimeout(() => {
        scrollLeftFlushTimerRef.current = null;
        setScrollLeft(scrollLeftRef.current);
      }, 0);
      scrollTopFlushTimerRef.current = window.setTimeout(() => {
        scrollTopFlushTimerRef.current = null;
        setScrollTop(scrollTopRef.current);
      }, 0);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (scrollLeftRafRef.current !== null) {
        window.cancelAnimationFrame(scrollLeftRafRef.current);
        scrollLeftRafRef.current = null;
      }
      if (scrollTopRafRef.current !== null) {
        window.cancelAnimationFrame(scrollTopRafRef.current);
        scrollTopRafRef.current = null;
      }
      if (scrollLeftFlushTimerRef.current !== null) {
        window.clearTimeout(scrollLeftFlushTimerRef.current);
        scrollLeftFlushTimerRef.current = null;
      }
      if (scrollTopFlushTimerRef.current !== null) {
        window.clearTimeout(scrollTopFlushTimerRef.current);
        scrollTopFlushTimerRef.current = null;
      }
    };
  }, [updateRectRef]);

  const baseColumnWidth = useMemo(() => {
    if (viewportWidth <= 0) return 1;
    return Math.max(1, viewportWidth / visibleColumnCount);
  }, [viewportWidth, visibleColumnCount]);

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
  const columnHeight = useMemo(() => {
    return framesPerColumn * rowHeight;
  }, [framesPerColumn, rowHeight]);
  const totalContentWidth = useMemo(
    () => (isMobileTimesheetLayout ? columnWidth : totalColumns * columnWidth),
    [columnWidth, isMobileTimesheetLayout, totalColumns]
  );
  const totalContentHeight = useMemo(
    () => (isMobileTimesheetLayout ? totalColumns * columnHeight : columnHeight),
    [columnHeight, isMobileTimesheetLayout, totalColumns]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || columnWidth <= 0) return;
    const maxScrollLeft = Math.max(0, totalContentWidth - el.clientWidth);
    const maxScrollTop = Math.max(0, totalContentHeight - el.clientHeight);
    const currentLeft = el.scrollLeft;
    const currentTop = el.scrollTop;
    const nextLeft = Math.min(currentLeft, maxScrollLeft);
    const nextTop = Math.min(currentTop, maxScrollTop);
    if (nextLeft !== currentLeft) {
      el.scrollLeft = nextLeft;
    }
    if (nextTop !== currentTop) {
      el.scrollTop = nextTop;
    }
    if (scrollLeftRef.current !== nextLeft) {
      scrollLeftRef.current = nextLeft;
      setScrollLeft(nextLeft);
    }
    if (scrollTopRef.current !== nextTop) {
      scrollTopRef.current = nextTop;
      setScrollTop(nextTop);
    }
  }, [columnWidth, totalContentHeight, totalContentWidth]);

  const trackRenderData = useMemo<TrackRenderData[]>(
    () =>
      tracks.map((track) => ({
        id: track.id,
        frames: track.frames,
        speechOverrides: track.speechOverrides,
        waveformReferenceMax: track.waveformReferenceMax,
      })),
    [tracks]
  );

  const trackDataKeys = useMemo<TrackDataKey[]>(
    () =>
      trackRenderData.map((track) => ({
        frames: track.frames,
        speechOverrides: track.speechOverrides,
      })),
    [trackRenderData]
  );

  const trackOrderKey = useMemo(() => trackRenderData.map((track) => track.id).join('|'), [trackRenderData]);

  const trackMaxVolumes = useMemo(() => {
    return trackRenderData.map((track) => track.waveformReferenceMax);
  }, [trackRenderData]);

  const activeTrackId = useMemo(() => (editTarget === 'all' ? null : editTarget), [editTarget]);

  const layoutKey = useMemo(
    () =>
      [
        columnWidth,
        columnHeight,
        rowHeight,
        rulerWidth,
        tracks.length,
        touchActionValue,
        fps,
      ].join('|'),
    [columnHeight, columnWidth, fps, rowHeight, rulerWidth, touchActionValue, tracks.length]
  );

  const scrollMetricsRef = useRef({
    columnWidth,
    rowHeight,
    columnHeight,
    framesPerColumn,
    totalColumns,
    totalContentWidth,
    totalContentHeight,
    isMobileTimesheetLayout,
  });

  useEffect(() => {
    scrollMetricsRef.current = {
      columnWidth,
      rowHeight,
      columnHeight,
      framesPerColumn,
      totalColumns,
      totalContentWidth,
      totalContentHeight,
      isMobileTimesheetLayout,
    };
  }, [columnHeight, columnWidth, framesPerColumn, isMobileTimesheetLayout, rowHeight, totalColumns, totalContentHeight, totalContentWidth]);

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
      const columnLeft = 0;
      const columnRight = columnWidth;
      const rowTop = isMobileTimesheetLayout
        ? columnIndex * columnHeight + rowIndex * rowHeight
        : rowIndex * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const targetColumnLeft = isMobileTimesheetLayout ? 0 : columnIndex * columnWidth;
      const targetColumnRight = targetColumnLeft + columnWidth;
      const viewportWidth = el.clientWidth;
      const viewportHeight = el.clientHeight;

      const marginScale = options?.marginScale ?? 1;
      const baseMarginX = Math.min(columnWidth * 0.12, 48);
      const baseMarginY = Math.min(rowHeight * 2.2, 56);
      const marginX = baseMarginX * marginScale;
      const marginY = baseMarginY * marginScale;

      let nextLeft = el.scrollLeft;
      let nextTop = el.scrollTop;

      if (targetColumnLeft < nextLeft + marginX) {
        nextLeft = Math.max(0, targetColumnLeft - marginX);
      } else if (targetColumnRight > nextLeft + viewportWidth - marginX) {
        nextLeft = Math.max(0, targetColumnRight - viewportWidth + marginX);
      }

      if (rowTop < nextTop + marginY) {
        nextTop = Math.max(0, rowTop - marginY);
      } else if (rowBottom > nextTop + viewportHeight - marginY) {
        nextTop = Math.max(0, rowBottom - viewportHeight + marginY);
      }

      if (nextLeft !== el.scrollLeft || nextTop !== el.scrollTop) {
        const behavior = options?.behavior ?? 'smooth';
        el.scrollTo({ left: nextLeft, top: nextTop, behavior });
        if (behavior === 'auto') {
          scrollLeftRef.current = nextLeft;
          scrollTopRef.current = nextTop;
        }
      }
    },
    [columnHeight, columnWidth, framesPerColumn, isMobileTimesheetLayout, rowHeight]
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
    if (zoomScrollRafRef.current !== null) {
      cancelAnimationFrame(zoomScrollRafRef.current);
    }
    zoomScrollRafRef.current = requestAnimationFrame(() => {
      zoomScrollRafRef.current = null;
      el.scrollTo({ left: nextScrollLeft, top: nextScrollTop });
      scrollLeftRef.current = nextScrollLeft;
      scrollTopRef.current = nextScrollTop;
    });
  }, [columnWidth, rowHeight]);

  useEffect(() => {
    return () => {
      if (zoomScrollRafRef.current !== null) {
        cancelAnimationFrame(zoomScrollRafRef.current);
        zoomScrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isAutoScrollEnabled) {
      lastAutoSheetRef.current = null;
      return;
    }
    const el = scrollRef.current;
    if (!el || columnWidth <= 0 || rowHeight <= 0) return;

    if (!isZoomed && !isMobileTimesheetLayout) {
      const sheetIndex = Math.floor(currentFrame / framesPerSheet);
      if (lastAutoSheetRef.current === sheetIndex) return;
      lastAutoSheetRef.current = sheetIndex;

      // 再生中/スクラブ中にシート境界へ到達したら自動スクロール
      const targetLeft = sheetIndex * COLUMNS_PER_SHEET * columnWidth;
      const behavior: ScrollBehavior = isScrubbing ? 'auto' : 'smooth';
      el.scrollTo({ left: targetLeft, behavior });
      if (behavior === 'auto') {
        scrollLeftRef.current = targetLeft;
      }
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
    isMobileTimesheetLayout,
    isScrubbing,
    isZoomed,
    rowHeight,
    scrollToFrame,
  ]);

  useEffect(() => {
    if (!onFirstVisibleColumnChange) return;
    const firstVisible = isMobileTimesheetLayout
      ? Math.floor(scrollTopRef.current / Math.max(columnHeight, 1))
      : Math.floor(scrollLeftRef.current / columnWidth);
    if (lastFirstVisibleColRef.current === firstVisible) return;
    lastFirstVisibleColRef.current = firstVisible;
    onFirstVisibleColumnChange(firstVisible);
  }, [columnHeight, columnWidth, isMobileTimesheetLayout, onFirstVisibleColumnChange, scrollLeft, scrollTop]);

  const { renderStartColumn, renderEndColumn } = useMemo(() => {
    if (columnWidth <= 0) return { renderStartColumn: 0, renderEndColumn: Math.min(totalColumns - 1, 1) };

    const firstVisible = isMobileTimesheetLayout
      ? Math.floor(scrollTop / Math.max(columnHeight, 1))
      : Math.floor(scrollLeft / columnWidth);
    const overscan = OVERSCAN_COLUMNS;
    const visibleCount = visibleColumnCount;

    const start = Math.max(0, firstVisible - overscan);
    const end = Math.min(totalColumns - 1, firstVisible + (visibleCount - 1) + overscan);
    return { renderStartColumn: start, renderEndColumn: end };
  }, [columnHeight, columnWidth, isMobileTimesheetLayout, scrollLeft, scrollTop, totalColumns, visibleColumnCount]);

  const getRenderRange = useCallback(() => {
    if (columnWidth <= 0) {
      return { start: 0, end: Math.min(totalColumns - 1, 1) };
    }
    const firstVisible = isMobileTimesheetLayout
      ? Math.floor(scrollTopRef.current / Math.max(columnHeight, 1))
      : Math.floor(scrollLeftRef.current / columnWidth);
    const start = Math.max(0, firstVisible - OVERSCAN_COLUMNS);
    const end = Math.min(totalColumns - 1, firstVisible + (visibleColumnCount - 1) + OVERSCAN_COLUMNS);
    return { start, end };
  }, [columnHeight, columnWidth, isMobileTimesheetLayout, totalColumns, visibleColumnCount]);

  const visibleColumnIndices = useMemo(() => {
    const cols: number[] = [];
    for (let i = renderStartColumn; i <= renderEndColumn; i++) cols.push(i);
    return cols;
  }, [renderStartColumn, renderEndColumn]);

  const leftSpacerWidth = isMobileTimesheetLayout ? 0 : renderStartColumn * columnWidth;
  const rightSpacerWidth = isMobileTimesheetLayout ? 0 : Math.max(0, totalColumns - renderEndColumn - 1) * columnWidth;
  const topSpacerHeight = isMobileTimesheetLayout ? renderStartColumn * columnHeight : 0;
  const bottomSpacerHeight = isMobileTimesheetLayout
    ? Math.max(0, totalColumns - renderEndColumn - 1) * columnHeight
    : 0;
  const normalizedSelection = useMemo(() => mergeSelectionRanges(selection), [selection]);
  const currentColumnIndex = Math.max(0, Math.floor(currentFrame / framesPerColumn));
  const currentSheetIndex = Math.floor(currentColumnIndex / COLUMNS_PER_SHEET);
  const currentFrameRailOffset = useMemo(() => {
    if (!isMobileTimesheetLayout || rowHeight <= 0) return null;
    return currentFrame * rowHeight + rowHeight / 2 - scrollTop;
  }, [currentFrame, isMobileTimesheetLayout, rowHeight, scrollTop]);
  const mobileRailTicks = useMemo(() => {
    if (!isMobileTimesheetLayout || rowHeight <= 0 || viewportHeight <= 0) return [];
    const firstFrame = Math.max(0, Math.floor(scrollTop / rowHeight));
    const visibleFrames = Math.ceil(viewportHeight / rowHeight) + 2;
    return Array.from({ length: visibleFrames }, (_, index) => {
      const frame = firstFrame + index;
      const top = frame * rowHeight - scrollTop;
      const frameInSecond = (frame % fps) + 1;
      const half = Math.floor(fps / 2);
      const isSecond = frameInSecond % fps === 0;
      const isHalfSecond = half > 0 ? frameInSecond % half === 0 : false;
      return { frame, top, isSecond, isHalfSecond };
    });
  }, [fps, isMobileTimesheetLayout, rowHeight, scrollTop, viewportHeight]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (suppressBackdropClickRef.current) {
      suppressBackdropClickRef.current = false;
      return;
    }
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

  const getRulerTarget = useCallback((target: EventTarget | null): { frame: number } | null => {
    if (!(target instanceof HTMLElement)) return null;
    const cell = target.closest<HTMLElement>('[data-frame-index][data-ruler]');
    if (!cell) return null;
    const frameAttr = cell.dataset.frameIndex;
    if (!frameAttr) return null;
    const frame = Number(frameAttr);
    if (Number.isNaN(frame)) return null;
    return { frame };
  }, []);

  const getMobileRailFrameAtPoint = useCallback((clientY: number): number | null => {
    const rail = mobileScrubRailRef.current;
    if (!rail || rowHeight <= 0) return null;
    const rect = rail.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const localY = clamp(clientY - rect.top, 0, Math.max(0, rect.height - 1));
    const maxFrame = Math.max(0, totalColumns * framesPerColumn - 1);
    return clamp(Math.floor((scrollTopRef.current + localY) / rowHeight), 0, maxFrame);
  }, [framesPerColumn, rowHeight, totalColumns]);

  const getTrackAtPoint = useCallback(
    (clientX: number, clientY: number): { frame: number; trackId: string } | null => {
      const el = scrollRef.current;
      const rect = rectRef.current;
      if (!el || !rect) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      if (rect.width <= 0 || rect.height <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const edgeEpsilon = pointerEdgeEpsilon;

      if (
        localX < 0 ||
        localY < 0 ||
        localX > rect.width ||
        localY > rect.height ||
        localX <= edgeEpsilon ||
        localX >= rect.width - edgeEpsilon ||
        localY <= edgeEpsilon ||
        localY >= rect.height - edgeEpsilon
      ) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      if (localX > rect.clientWidth || localY > rect.clientHeight) {
        return null;
      }

      if (columnWidth <= 0 || rowHeight <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      const contentX = localX + el.scrollLeft;
      const contentY = localY + el.scrollTop;
      const columnIndex = isMobileTimesheetLayout
        ? Math.floor(contentY / columnHeight)
        : Math.floor(contentX / columnWidth);
      const rowOffsetY = isMobileTimesheetLayout ? contentY - columnIndex * columnHeight : contentY;
      const rowIndex = Math.floor(rowOffsetY / rowHeight);
      const { start: renderStart, end: renderEnd } = getRenderRange();

      if (
        columnIndex < 0 ||
        rowIndex < 0 ||
        columnIndex >= totalColumns ||
        rowIndex >= framesPerColumn ||
        columnIndex < renderStart ||
        columnIndex > renderEnd
      ) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      if (tracks.length <= 0 || columnWidth <= rulerWidth * 2) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      const columnX = isMobileTimesheetLayout ? contentX : contentX - columnIndex * columnWidth;
      const trackAreaWidth = columnWidth - rulerWidth * 2;
      if (trackAreaWidth <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      const trackX = columnX - rulerWidth;
      if (trackX < 0 || trackX >= trackAreaWidth) return null;
      if (trackX <= edgeEpsilon || trackX >= trackAreaWidth - edgeEpsilon) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      const trackColumnWidth = trackAreaWidth / tracks.length;
      if (trackColumnWidth <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getTrackTarget(dom);
      }

      const trackIndex = Math.floor(trackX / trackColumnWidth);
      if (trackIndex < 0 || trackIndex >= tracks.length) return null;

      const frame = columnIndex * framesPerColumn + rowIndex;
      return { frame, trackId: tracks[trackIndex]?.id };
    },
    [
      columnWidth,
      framesPerColumn,
      getRenderRange,
      pointerEdgeEpsilon,
      isMobileTimesheetLayout,
      rowHeight,
      rulerWidth,
      totalColumns,
      tracks,
      getTrackTarget,
    ]
  );

  const getRulerFrameAtPoint = useCallback(
    (clientX: number, clientY: number): { frame: number } | null => {
      const el = scrollRef.current;
      const rect = rectRef.current;
      if (!el || !rect) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getRulerTarget(dom);
      }

      if (rect.width <= 0 || rect.height <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getRulerTarget(dom);
      }

      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const edgeEpsilon = pointerEdgeEpsilon;

      if (
        localX < 0 ||
        localY < 0 ||
        localX > rect.width ||
        localY > rect.height ||
        localX <= edgeEpsilon ||
        localX >= rect.width - edgeEpsilon ||
        localY <= edgeEpsilon ||
        localY >= rect.height - edgeEpsilon
      ) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getRulerTarget(dom);
      }

      if (localX > rect.clientWidth || localY > rect.clientHeight) {
        return null;
      }

      if (columnWidth <= 0 || rowHeight <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getRulerTarget(dom);
      }

      const contentX = localX + el.scrollLeft;
      const contentY = localY + el.scrollTop;
      const columnIndex = isMobileTimesheetLayout
        ? Math.floor(contentY / columnHeight)
        : Math.floor(contentX / columnWidth);
      const rowOffsetY = isMobileTimesheetLayout ? contentY - columnIndex * columnHeight : contentY;
      const rowIndex = Math.floor(rowOffsetY / rowHeight);
      const { start: renderStart, end: renderEnd } = getRenderRange();

      if (
        columnIndex < 0 ||
        rowIndex < 0 ||
        columnIndex >= totalColumns ||
        rowIndex >= framesPerColumn ||
        columnIndex < renderStart ||
        columnIndex > renderEnd
      ) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getRulerTarget(dom);
      }

      const columnX = isMobileTimesheetLayout ? contentX : contentX - columnIndex * columnWidth;
      const leftRulerEdge = rulerWidth;
      const rightRulerEdge = columnWidth - rulerWidth;
      const isInLeftRuler = columnX >= 0 && columnX <= leftRulerEdge;
      const isInRightRuler = columnX >= rightRulerEdge && columnX <= columnWidth;

      if (!isInLeftRuler && !isInRightRuler) return null;
      if (
        Math.abs(columnX - leftRulerEdge) <= edgeEpsilon ||
        Math.abs(columnX - rightRulerEdge) <= edgeEpsilon
      ) {
        const dom = document.elementFromPoint(clientX, clientY);
        return getRulerTarget(dom);
      }

      const frame = columnIndex * framesPerColumn + rowIndex;
      return { frame };
    },
    [
      columnWidth,
      framesPerColumn,
      getRenderRange,
      getRulerTarget,
      isMobileTimesheetLayout,
      pointerEdgeEpsilon,
      rowHeight,
      rulerWidth,
      totalColumns,
    ]
  );

  const getScrubFrameAtPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = scrollRef.current;
      const rect = rectRef.current;
      if (!el || !rect) {
        const dom = document.elementFromPoint(clientX, clientY);
        if (!(dom instanceof HTMLElement)) return null;
        const cell = dom.closest<HTMLElement>('[data-frame-index]');
        if (!cell) return null;
        const frameAttr = cell.dataset.frameIndex;
        if (!frameAttr) return null;
        const frame = Number(frameAttr);
        if (Number.isNaN(frame)) return null;
        return frame;
      }

      if (rect.width <= 0 || rect.height <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        if (!(dom instanceof HTMLElement)) return null;
        const cell = dom.closest<HTMLElement>('[data-frame-index]');
        if (!cell) return null;
        const frameAttr = cell.dataset.frameIndex;
        if (!frameAttr) return null;
        const frame = Number(frameAttr);
        if (Number.isNaN(frame)) return null;
        return frame;
      }

      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const edgeEpsilon = pointerEdgeEpsilon;

      if (
        localX < 0 ||
        localY < 0 ||
        localX > rect.width ||
        localY > rect.height ||
        localX <= edgeEpsilon ||
        localX >= rect.width - edgeEpsilon ||
        localY <= edgeEpsilon ||
        localY >= rect.height - edgeEpsilon
      ) {
        const dom = document.elementFromPoint(clientX, clientY);
        if (!(dom instanceof HTMLElement)) return null;
        const cell = dom.closest<HTMLElement>('[data-frame-index]');
        if (!cell) return null;
        const frameAttr = cell.dataset.frameIndex;
        if (!frameAttr) return null;
        const frame = Number(frameAttr);
        if (Number.isNaN(frame)) return null;
        return frame;
      }

      if (localX > rect.clientWidth || localY > rect.clientHeight) {
        return null;
      }

      if (columnWidth <= 0 || rowHeight <= 0) {
        const dom = document.elementFromPoint(clientX, clientY);
        if (!(dom instanceof HTMLElement)) return null;
        const cell = dom.closest<HTMLElement>('[data-frame-index]');
        if (!cell) return null;
        const frameAttr = cell.dataset.frameIndex;
        if (!frameAttr) return null;
        const frame = Number(frameAttr);
        if (Number.isNaN(frame)) return null;
        return frame;
      }

      const contentX = localX + el.scrollLeft;
      const contentY = localY + el.scrollTop;
      const columnIndex = isMobileTimesheetLayout
        ? Math.floor(contentY / columnHeight)
        : Math.floor(contentX / columnWidth);
      const rowOffsetY = isMobileTimesheetLayout ? contentY - columnIndex * columnHeight : contentY;
      const rowIndex = Math.floor(rowOffsetY / rowHeight);
      const { start: renderStart, end: renderEnd } = getRenderRange();

      if (
        columnIndex < 0 ||
        rowIndex < 0 ||
        columnIndex >= totalColumns ||
        rowIndex >= framesPerColumn ||
        columnIndex < renderStart ||
        columnIndex > renderEnd
      ) {
        const dom = document.elementFromPoint(clientX, clientY);
        if (!(dom instanceof HTMLElement)) return null;
        const cell = dom.closest<HTMLElement>('[data-frame-index]');
        if (!cell) return null;
        const frameAttr = cell.dataset.frameIndex;
        if (!frameAttr) return null;
        const frame = Number(frameAttr);
        if (Number.isNaN(frame)) return null;
        return frame;
      }

      return columnIndex * framesPerColumn + rowIndex;
    },
    [
      columnWidth,
      columnHeight,
      framesPerColumn,
      getRenderRange,
      isMobileTimesheetLayout,
      pointerEdgeEpsilon,
      rowHeight,
      totalColumns,
    ]
  );

  const updateWrapCue = useCallback((next: 'up' | 'down' | null) => {
    if (wrapCueRef.current === next) return;
    wrapCueRef.current = next;
    setWrapCue(next);
  }, []);

  const normalizeMouseSelectionCursor = useCallback(
    (contentX: number, contentY: number) => {
      if (columnWidth <= 0 || columnHeight <= 0) return { contentX: 0, contentY: 0 };

      if (isMobileTimesheetLayout) {
        return {
          contentX: clamp(contentX, 0, Math.max(0, totalContentWidth - 1)),
          contentY: clamp(contentY, 0, Math.max(0, totalContentHeight - 1)),
        };
      }

      const maxContentX = Math.max(0, totalColumns * columnWidth - 1);
      const maxContentY = Math.max(0, columnHeight - 1);
      let nextX = clamp(contentX, 0, maxContentX);
      let nextY = contentY;

      while (nextY < 0) {
        const currentColumnIndex = clamp(Math.floor(nextX / columnWidth), 0, totalColumns - 1);
        if (currentColumnIndex <= 0) {
          nextY = 0;
          break;
        }
        nextY += columnHeight;
        nextX = Math.max(0, nextX - columnWidth);
      }
      while (nextY >= columnHeight) {
        const currentColumnIndex = clamp(Math.floor(nextX / columnWidth), 0, totalColumns - 1);
        if (currentColumnIndex >= totalColumns - 1) {
          nextY = maxContentY;
          break;
        }
        nextY -= columnHeight;
        nextX = Math.min(maxContentX, nextX + columnWidth);
      }

      nextY = clamp(nextY, 0, maxContentY);
      return { contentX: nextX, contentY: nextY };
    },
    [columnHeight, columnWidth, isMobileTimesheetLayout, totalColumns, totalContentHeight, totalContentWidth]
  );

  const updateMouseSelectionCursor = useCallback((contentX: number, contentY: number, lastClientX: number, lastClientY: number) => {
    const normalized = normalizeMouseSelectionCursor(contentX, contentY);
    mouseSelectionCursorStateRef.current = {
      contentX: normalized.contentX,
      contentY: normalized.contentY,
      lastClientX,
      lastClientY,
    };

    const rect = rectRef.current;
    const scrollEl = scrollRef.current;
    const cursorEl = mouseSelectionCursorRef.current;
    if (!rect || !scrollEl || !cursorEl) return;

    const displayX = clamp(normalized.contentX - scrollEl.scrollLeft + rect.left, rect.left + 4, rect.right - 4);
    const displayY = clamp(normalized.contentY - scrollEl.scrollTop + rect.top, rect.top + 4, rect.bottom - 4);

    cursorEl.style.left = `${displayX - rect.left}px`;
    cursorEl.style.top = `${displayY - rect.top}px`;
  }, [normalizeMouseSelectionCursor]);

  const getMouseSelectionTarget = useCallback(
    (contentX: number, contentY: number): { frame: number; trackId: string } | null => {
      if (columnWidth <= 0 || rowHeight <= 0 || tracks.length <= 0 || columnHeight <= 0) return null;

      const normalized = normalizeMouseSelectionCursor(contentX, contentY);
      const columnIndex = isMobileTimesheetLayout
        ? clamp(Math.floor(normalized.contentY / columnHeight), 0, totalColumns - 1)
        : clamp(Math.floor(normalized.contentX / columnWidth), 0, totalColumns - 1);
      const rowOffsetY = isMobileTimesheetLayout
        ? normalized.contentY - columnIndex * columnHeight
        : normalized.contentY;
      const rowIndex = clamp(Math.floor(rowOffsetY / rowHeight), 0, framesPerColumn - 1);
      const columnX = isMobileTimesheetLayout ? normalized.contentX : normalized.contentX - columnIndex * columnWidth;
      const trackAreaWidth = columnWidth - rulerWidth * 2;
      if (trackAreaWidth <= 0) return null;

      const trackX = clamp(columnX - rulerWidth, 0, Math.max(0, trackAreaWidth - 1));
      const trackColumnWidth = trackAreaWidth / tracks.length;
      if (trackColumnWidth <= 0) return null;

      const trackIndex = clamp(Math.floor(trackX / trackColumnWidth), 0, tracks.length - 1);
      const frame = columnIndex * framesPerColumn + rowIndex;
      const trackId = tracks[trackIndex]?.id;
      if (!trackId) return null;
      return { frame, trackId };
    },
    [columnHeight, columnWidth, framesPerColumn, isMobileTimesheetLayout, normalizeMouseSelectionCursor, rowHeight, rulerWidth, totalColumns, tracks]
  );

  const startMouseSelectionCursor = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rectRef.current;
      const scrollEl = scrollRef.current;
      if (!rect || !scrollEl) return;

      const contentX = clientX - rect.left + scrollEl.scrollLeft;
      const contentY = clientY - rect.top + scrollEl.scrollTop;
      setIsMouseSelectionCursorVisible(true);
      updateMouseSelectionCursor(contentX, contentY, clientX, clientY);
    },
    [updateMouseSelectionCursor]
  );

  const stopMouseSelectionCursor = useCallback(() => {
    mouseSelectionCursorStateRef.current = null;
    setIsMouseSelectionCursorVisible(false);
  }, []);

  const syncMouseSelectionCursorToPointer = useCallback(
    (clientX: number, clientY: number) => {
      const current = mouseSelectionCursorStateRef.current;
      if (!current) return;

      const dx = clientX - current.lastClientX;
      const dy = clientY - current.lastClientY;
      updateMouseSelectionCursor(current.contentX + dx, current.contentY + dy, clientX, clientY);
    },
    [updateMouseSelectionCursor]
  );

  useEffect(() => {
    const current = mouseSelectionCursorStateRef.current;
    if (!isMouseSelectionCursorVisible || !current) return;
    updateMouseSelectionCursor(current.contentX, current.contentY, current.lastClientX, current.lastClientY);
  }, [isMouseSelectionCursorVisible, scrollLeft, scrollTop, updateMouseSelectionCursor]);

  const getSelectionTargetAtPoint = useCallback(
    (clientX: number, clientY: number): { frame: number; trackId: string } | null => {
      const directTarget = getTrackAtPoint(clientX, clientY);
      if (directTarget) {
        selectionTrackIdRef.current = directTarget.trackId;
        return directTarget;
      }

      const frame = getScrubFrameAtPoint(clientX, clientY);
      const trackId = selectionTrackIdRef.current;
      if (frame === null || !trackId) return null;
      return { frame, trackId };
    },
    [getScrubFrameAtPoint, getTrackAtPoint]
  );

  const updateSelectionAtPoint = useCallback(
    (clientX: number, clientY: number, pointerType: string) => {
      if (selectionAnchorRef.current === null) return;
      const target =
        pointerType === 'touch'
          ? getSelectionTargetAtPoint(clientX, clientY)
          : getTrackAtPoint(clientX, clientY);
      if (!target) return;
      const nextRanges = buildSelectionRanges(target.frame);
      selectionRangeRef.current = nextRanges;
      onSelectionChangeRef.current?.(nextRanges);
      if (pointerType === 'touch' && target.trackId) {
        onSelectionScrubRef.current?.(target.frame, target.trackId);
      }
    },
    [getSelectionTargetAtPoint, getTrackAtPoint]
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

    if (!rectRef.current) {
      updateRectRef();
    }
    const rect = rectRef.current;
    if (!rect) {
      stopAutoScroll();
      return;
    }
    const { pointerX, pointerY, pointerType } = autoScrollRef.current;
    const edge = EDGE_SCROLL_SIZE;

    let dirX = 0;
    let dirY = 0;
    let speedX = 0;
    let speedY = 0;

    if (pointerX < rect.left + edge) {
      dirX = -1;
      speedX = getEdgeScrollSpeed(rect.left + edge - pointerX, pointerType);
    } else if (pointerX > rect.right - edge) {
      dirX = 1;
      speedX = getEdgeScrollSpeed(pointerX - (rect.right - edge), pointerType);
    }

    if (pointerY < rect.top + edge) {
      dirY = -1;
      speedY = getEdgeScrollSpeed(rect.top + edge - pointerY, pointerType);
    } else if (pointerY > rect.bottom - edge) {
      dirY = 1;
      speedY = getEdgeScrollSpeed(pointerY - (rect.bottom - edge), pointerType);
    }

    if (dirX === 0 && dirY === 0) {
      stopAutoScroll();
      return;
    }

    const {
      columnWidth,
      columnHeight,
      rowHeight,
      framesPerColumn,
      totalColumns,
      totalContentWidth,
      totalContentHeight,
      isMobileTimesheetLayout,
    } = scrollMetricsRef.current;
    const maxScrollTop = Math.max(0, totalContentHeight - el.clientHeight);
    const maxScrollLeft = Math.max(0, totalContentWidth - el.clientWidth);

    let nextLeft = el.scrollLeft;
    let nextTop = el.scrollTop;
    let wrapDirection: 'up' | 'down' | null = null;
    let didWrap = false;

    if (dirY > 0) {
      if (el.scrollTop < maxScrollTop - 0.5) {
        nextTop = Math.min(maxScrollTop, el.scrollTop + speedY);
      } else if (!isMobileTimesheetLayout && el.scrollLeft < maxScrollLeft - 0.5) {
        nextLeft = Math.min(maxScrollLeft, el.scrollLeft + columnWidth);
        nextTop = 0;
        wrapDirection = 'down';
        didWrap = true;
      }
    } else if (dirY < 0) {
      if (el.scrollTop > 0.5) {
        nextTop = Math.max(0, el.scrollTop - speedY);
      } else if (!isMobileTimesheetLayout && el.scrollLeft > 0.5) {
        nextLeft = Math.max(0, el.scrollLeft - columnWidth);
        nextTop = maxScrollTop;
        wrapDirection = 'up';
        didWrap = true;
      }
    }

    if (!didWrap && dirX !== 0) {
      nextLeft = clamp(el.scrollLeft + dirX * speedX, 0, maxScrollLeft);
    }

    if (nextLeft !== el.scrollLeft) {
      el.scrollLeft = nextLeft;
      scrollLeftRef.current = nextLeft;
    }
    if (nextTop !== el.scrollTop) {
      el.scrollTop = nextTop;
      scrollTopRef.current = nextTop;
    }

    let cue: 'up' | 'down' | null = null;
    if (!isMobileTimesheetLayout && dirY > 0 && el.scrollTop >= maxScrollTop - 0.5 && el.scrollLeft < maxScrollLeft - 0.5) {
      cue = 'down';
    } else if (!isMobileTimesheetLayout && dirY < 0 && el.scrollTop <= 0.5 && el.scrollLeft > 0.5) {
      cue = 'up';
    }
    updateWrapCue(cue);

    if (pointerType === 'mouse') {
      const currentCursor = mouseSelectionCursorStateRef.current;
      if (currentCursor) {
        updateMouseSelectionCursor(
          currentCursor.contentX + dirX * speedX,
          currentCursor.contentY + dirY * speedY,
          currentCursor.lastClientX,
          currentCursor.lastClientY
        );
        const target = getMouseSelectionTarget(currentCursor.contentX + dirX * speedX, currentCursor.contentY + dirY * speedY);
        if (selectionAnchorRef.current !== null && target) {
          const nextRanges = buildSelectionRanges(target.frame);
          selectionRangeRef.current = nextRanges;
          onSelectionChangeRef.current?.(nextRanges);
        }
      }
    } else if (framesPerColumn > 0 && rowHeight > 0) {
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
      updateSelectionAtPoint(effectiveX, effectiveY, pointerType);
    }

    if (pointerType === 'mouse') {
      autoScrollRef.current.rafId = null;
      updateWrapCue(null);
      return;
    }

    autoScrollRef.current.rafId = requestAnimationFrame(runAutoScroll);
  }, [getEdgeScrollSpeed, getMouseSelectionTarget, rowHeight, stopAutoScroll, updateMouseSelectionCursor, updateRectRef, updateSelectionAtPoint, updateWrapCue]);

  const startAutoScroll = useCallback((clientX: number, clientY: number, pointerType: string) => {
    autoScrollRef.current.pointerX = clientX;
    autoScrollRef.current.pointerY = clientY;
    autoScrollRef.current.pointerType = pointerType;
    if (autoScrollRef.current.rafId === null) {
      autoScrollRef.current.rafId = requestAnimationFrame(runAutoScroll);
    }
  }, [runAutoScroll]);

  const isFrameInSelection = (frame: number): boolean => {
    return selectionRangeRef.current.some((range) => frame >= range.startFrame && frame <= range.endFrame);
  };

  const isSelectionHit = (frame: number, trackId: string | null): boolean => {
    if (!isFrameInSelection(frame)) return false;
    if (editTarget === 'all') return true;
    if (!trackId) return false;
    return trackId === editTarget;
  };

  const getSelectionBaseRangesForDraft = useCallback(
    (
      frame: number,
      trackId: string | null,
      append: boolean
    ): { anchorFrame: number; baseRanges: SelectionRanges; preserveInitial: boolean } => {
      const currentRanges = selectionRangeRef.current;
      if (isSelectionHit(frame, trackId)) {
        const hitIndex = currentRanges.findIndex((range) => frame >= range.startFrame && frame <= range.endFrame);
        if (hitIndex >= 0) {
          const hitRange = currentRanges[hitIndex];
          const distanceToStart = Math.abs(frame - hitRange.startFrame);
          const distanceToEnd = Math.abs(hitRange.endFrame - frame);
          return {
            anchorFrame: distanceToStart <= distanceToEnd ? hitRange.endFrame : hitRange.startFrame,
            baseRanges: currentRanges.filter((_, index) => index !== hitIndex),
            preserveInitial: true,
          };
        }
      }
      return {
        anchorFrame: frame,
        baseRanges: append ? currentRanges : [],
        preserveInitial: false,
      };
    },
    [isSelectionHit]
  );

  const buildSelectionRanges = (targetFrame: number): SelectionRanges => {
    const dragStartFrame = selectionDragStartFrameRef.current;
    if (selectionPreserveInitialRef.current && dragStartFrame !== null) {
      if (dragStartFrame === targetFrame) {
        return selectionDragInitialRangesRef.current;
      }
      selectionPreserveInitialRef.current = false;
    }
    if (selectionAnchorRef.current === null) return selectionRangeRef.current;
    return mergeSelectionRanges([
      ...selectionBaseRangesRef.current,
      normalizeSelectionRange({ startFrame: selectionAnchorRef.current, endFrame: targetFrame }),
    ]);
  };

  const openSelectionMenu = (point: { x: number; y: number }, target: { frame: number; trackId: string } | null) => {
    if (!onOpenSelectionMenu || !target) return;
    const hitSelection = isSelectionHit(target.frame, target.trackId);
    if (!hitSelection) {
      const nextRanges = mergeSelectionRanges([{ startFrame: target.frame, endFrame: target.frame }]);
      selectionRangeRef.current = nextRanges;
      selectionBaseRangesRef.current = nextRanges;
      onSelectionChange?.(nextRanges);
    }
    onFrameTap(target.frame);
    selectionTrackIdRef.current = target.trackId;
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
    const wasSelecting = isSelectingRef.current;
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
    selectionBaseRangesRef.current = selectionRangeRef.current;
    resetSelectionDraftState();
    stopMouseSelectionCursor();
    if (wasSelecting) {
      suppressBackdropClickRef.current = true;
      onSelectionCommit?.();
    }
  };

  const stopPinch = () => {
    isPinchingRef.current = false;
    pinchStateRef.current = null;
    pinchPanStartRef.current = null;
  };

  const resetSelectionDraftState = () => {
    selectionDragStartFrameRef.current = null;
    selectionPreserveInitialRef.current = false;
    selectionDragInitialRangesRef.current = selectionRangeRef.current;
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
    selectionBaseRangesRef.current = selectionRangeRef.current;
    resetSelectionDraftState();
    stopMouseSelectionCursor();
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
      scrollLeftRef.current = el.scrollLeft;
      scrollTopRef.current = el.scrollTop;
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
      resetSelectionDraftState();
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
    updateRectRef();
    const target = getTrackAtPoint(e.clientX, e.clientY);
    if (!target) return;
    e.preventDefault();
    openSelectionMenu({ x: e.clientX, y: e.clientY }, target);
  };

  const startMobileRailScrub = useCallback((clientY: number) => {
    const frame = getMobileRailFrameAtPoint(clientY);
    if (frame === null) return false;
    setIsMobileScrubRailActive(true);
    onScrubStart?.(frame);
    return true;
  }, [getMobileRailFrameAtPoint, onScrubStart]);

  const stopMobileRailScrub = useCallback(() => {
    if (mobileScrubPointerIdRef.current === null && !isMobileScrubRailActive) return;
    mobileScrubPointerIdRef.current = null;
    setIsMobileScrubRailActive(false);
    onScrubEnd?.();
  }, [isMobileScrubRailActive, onScrubEnd]);

  const handleMobileRailPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobileTimesheetLayout) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    mobileScrubPointerIdRef.current = e.pointerId;
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    void startMobileRailScrub(e.clientY);
  }, [isMobileTimesheetLayout, startMobileRailScrub]);

  const handleMobileRailPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobileTimesheetLayout) return;
    if (mobileScrubPointerIdRef.current !== e.pointerId) return;
    const frame = getMobileRailFrameAtPoint(e.clientY);
    if (frame === null) return;
    e.preventDefault();
    e.stopPropagation();
    onScrubMove?.(frame);
  }, [getMobileRailFrameAtPoint, isMobileTimesheetLayout, onScrubMove]);

  const handleMobileRailPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (mobileScrubPointerIdRef.current !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    e.preventDefault();
    e.stopPropagation();
    stopMobileRailScrub();
  }, [stopMobileRailScrub]);

  const handleMobileRailPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (mobileScrubPointerIdRef.current !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    stopMobileRailScrub();
  }, [stopMobileRailScrub]);

  const handlePointerDown = (e: React.PointerEvent) => {
    updateRectRef();
    updatePointer(e);
    const scrollEl = scrollRef.current;
    if (
      scrollEl?.setPointerCapture &&
      (e.pointerType !== 'mouse' || e.button === 0) &&
      !scrollEl.hasPointerCapture?.(e.pointerId)
    ) {
      scrollEl.setPointerCapture(e.pointerId);
    }
    if (allowSingleFingerPan && e.pointerType !== 'mouse' && scrollEl) {
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
            mode: isMobileSelectionMode ? 'pan' : null,
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

    const rulerTarget = getRulerFrameAtPoint(e.clientX, e.clientY);
    const target = getTrackAtPoint(e.clientX, e.clientY);
    pendingTapRef.current = null;
    scrubPendingRef.current = null;
    selectionAnchorRef.current = null;
    resetSelectionDraftState();
    clearLongPressTimer();
    longPressPointRef.current = null;

    if (rulerTarget) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isMobileTimesheetLayout && e.pointerType === 'touch') {
        pendingTapRef.current = {
          frame: rulerTarget.frame,
          trackId: null,
          pointerType: e.pointerType,
          x: e.clientX,
          y: e.clientY,
        };
      } else {
        scrubPendingRef.current = { frame: rulerTarget.frame, x: e.clientX, y: e.clientY };
        isScrubbingRef.current = false;
      }
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
        if (!isMobileTimesheetLayout && target.frame === currentFrame) {
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
        if (isMobileSelectionMode || !isMobileTimesheetLayout) {
          const draftState = getSelectionBaseRangesForDraft(
            target.frame,
            target.trackId,
            isMobileSelectionMode
          );
          selectionTrackIdRef.current = target.trackId;
          selectionAnchorRef.current = draftState.anchorFrame;
          selectionBaseRangesRef.current = draftState.baseRanges;
          selectionDragStartFrameRef.current = target.frame;
          selectionDragInitialRangesRef.current = selectionRangeRef.current;
          selectionPreserveInitialRef.current = draftState.preserveInitial;
        }
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
        const zoomThreshold = isZoomed ? 20 : 14;
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
          scrollLeftRef.current = el.scrollLeft;
          scrollTopRef.current = el.scrollTop;
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
        resetSelectionDraftState();
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
      selectionAnchorRef.current === null &&
      isMobileTimesheetLayout
    ) {
      const dx = e.clientX - pendingTouch.x;
      const dy = e.clientY - pendingTouch.y;
      if (Math.hypot(dx, dy) > 6) {
        pendingTapRef.current = null;
        clearLongPressTimer();
        longPressPointRef.current = null;
        if (allowSingleFingerPan) {
          startPan(e);
          updatePan(e);
        }
        return;
      }
    }

    if (
      pendingTouch &&
      pendingTouch.pointerType === 'touch' &&
      selectionAnchorRef.current !== null &&
      !isSelectingRef.current
    ) {
      const dx = e.clientX - pendingTouch.x;
      const dy = e.clientY - pendingTouch.y;
      if (Math.hypot(dx, dy) > 6) {
        if (Math.abs(dx) > Math.abs(dy) && allowSingleFingerPan && !isMobileSelectionMode) {
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
      if (e.pointerType === 'mouse') {
        const useMouseSelectionCursor = !isMobileTimesheetLayout;
        if (useMouseSelectionCursor) {
          syncMouseSelectionCursorToPointer(e.clientX, e.clientY);
        }
        const currentCursor = mouseSelectionCursorStateRef.current;
        const target =
          useMouseSelectionCursor && currentCursor
            ? getMouseSelectionTarget(currentCursor.contentX, currentCursor.contentY)
            : getTrackAtPoint(e.clientX, e.clientY);
        if (!target || selectionAnchorRef.current === null) return;
        const nextRanges = buildSelectionRanges(target.frame);
        selectionRangeRef.current = nextRanges;
        onSelectionChange?.(nextRanges);
        startAutoScroll(e.clientX, e.clientY, e.pointerType);
        return;
      }
      const target = getSelectionTargetAtPoint(e.clientX, e.clientY);
      if (!target || selectionAnchorRef.current === null) return;
      if (e.pointerType === 'touch') {
        e.preventDefault();
      }
      const nextRanges = buildSelectionRanges(target.frame);
      selectionRangeRef.current = nextRanges;
      onSelectionChange?.(nextRanges);
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

    const draftState = getSelectionBaseRangesForDraft(pending.frame, pending.trackId, e.shiftKey);
    selectionTrackIdRef.current = pending.trackId;
    selectionAnchorRef.current = draftState.anchorFrame;
    selectionBaseRangesRef.current = draftState.baseRanges;
    selectionDragStartFrameRef.current = pending.frame;
    selectionDragInitialRangesRef.current = selectionRangeRef.current;
    selectionPreserveInitialRef.current = draftState.preserveInitial;
    isSelectingRef.current = true;
    if (!isMobileTimesheetLayout) {
      startMouseSelectionCursor(e.clientX, e.clientY);
    }
    if (pending.trackId) onTrackSelect?.(pending.trackId);
    const initialRanges = buildSelectionRanges(pending.frame);
    selectionRangeRef.current = initialRanges;
    onSelectionChange?.(initialRanges);
    const currentCursor = mouseSelectionCursorStateRef.current;
    const target = !isMobileTimesheetLayout && currentCursor
      ? getMouseSelectionTarget(currentCursor.contentX, currentCursor.contentY)
      : getTrackAtPoint(e.clientX, e.clientY);
    if (target) {
      const nextRanges = buildSelectionRanges(target.frame);
      selectionRangeRef.current = nextRanges;
      onSelectionChange?.(nextRanges);
    }
    startAutoScroll(e.clientX, e.clientY, e.pointerType);
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
      resetSelectionDraftState();
      stopMouseSelectionCursor();
      return;
    }

    if (isScrubbingRef.current) {
      if (e.pointerType === 'mouse') {
        suppressBackdropClickRef.current = true;
      }
      onScrubEnd?.();
      isScrubbingRef.current = false;
      scrubPendingRef.current = null;
      pendingTapRef.current = null;
      selectionAnchorRef.current = null;
      resetSelectionDraftState();
      stopMouseSelectionCursor();
      return;
    }

    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      suppressBackdropClickRef.current = true;
      selectionAnchorRef.current = null;
      pendingTapRef.current = null;
      resetSelectionDraftState();
      stopAutoScroll();
      stopMouseSelectionCursor();
      onSelectionCommit?.();
      return;
    }

    if (scrubPendingRef.current && !pending) {
      if (e.pointerType === 'mouse') {
        suppressBackdropClickRef.current = true;
      }
      onFrameTap(scrubPendingRef.current.frame);
      scrubPendingRef.current = null;
      return;
    }

    if (scrubPendingRef.current) {
      scrubPendingRef.current = null;
    }

    if (!pending) {
      selectionAnchorRef.current = null;
      resetSelectionDraftState();
      stopMouseSelectionCursor();
      return;
    }

    const hadSelection = selectionRangeRef.current.length > 0;
    const hitSelection = isSelectionHit(pending.frame, pending.trackId);
    const shouldCreateTouchSelection =
      pending.pointerType !== 'mouse' && (!isMobileTimesheetLayout || isMobileSelectionMode);
    const shouldAppendTouchSelection = shouldCreateTouchSelection && isMobileSelectionMode;
    if (hadSelection && !hitSelection && !shouldAppendTouchSelection) {
      selectionRangeRef.current = [];
      selectionBaseRangesRef.current = [];
      onSelectionChange?.([]);
    }

    if (shouldCreateTouchSelection && !hitSelection) {
      const draftState = getSelectionBaseRangesForDraft(pending.frame, pending.trackId, shouldAppendTouchSelection);
      selectionAnchorRef.current = draftState.anchorFrame;
      selectionBaseRangesRef.current = draftState.baseRanges;
      selectionDragStartFrameRef.current = pending.frame;
      selectionDragInitialRangesRef.current = selectionRangeRef.current;
      selectionPreserveInitialRef.current = draftState.preserveInitial;
      const nextRanges = buildSelectionRanges(pending.frame);
      selectionRangeRef.current = nextRanges;
      onSelectionChange?.(nextRanges);
    }

    if (pending.pointerType === 'mouse') {
      suppressBackdropClickRef.current = true;
    }
    if (!isMobileSelectionMode || !isMobileTimesheetLayout) {
      onFrameTap(pending.frame);
    }
    if (pending.trackId) onTrackSelect?.(pending.trackId);
    pendingTapRef.current = null;
    selectionAnchorRef.current = null;
    resetSelectionDraftState();
    stopMouseSelectionCursor();
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

  const handlePointerLeave = (e: React.PointerEvent) => {
    const scrollEl = scrollRef.current;
    if (scrollEl?.hasPointerCapture?.(e.pointerId)) return;
    handlePointerCancel(e);
  };

  return (
    <div
      className={`touch-no-select relative h-full w-full bg-gray-100 select-none ${
        isMobileTimesheetLayout ? 'flex flex-row' : ''
      }`}
    >
      <div
        ref={scrollRef}
        className={`overflow-x-auto overflow-y-auto overscroll-x-contain overscroll-y-contain ${
          isMobileTimesheetLayout ? 'h-full min-w-0 flex-1 snap-none' : 'h-full w-full snap-x snap-proximity'
        } ${isMouseSelectionCursorVisible ? 'cursor-none' : 'cursor-default'}`}
        onClick={handleBackdropClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        style={{
          touchAction: touchActionValue,
        }}
      >
        <div
          className={isMobileTimesheetLayout ? 'flex flex-col' : 'flex'}
          style={{ width: `${totalContentWidth}px`, height: `${totalContentHeight}px` }}
        >
          {leftSpacerWidth > 0 && (
            <div className="shrink-0" style={{ width: `${leftSpacerWidth}px`, height: `${columnHeight}px` }} />
          )}

          {topSpacerHeight > 0 && (
            <div className="shrink-0" style={{ width: `${columnWidth}px`, height: `${topSpacerHeight}px` }} />
          )}

          {visibleColumnIndices.map((columnIndex) => {
            const startFrame = columnIndex * framesPerColumn;
            const columnEnd = startFrame + framesPerColumn - 1;
            const cursorRow =
              currentFrame >= startFrame && currentFrame <= columnEnd
                ? Math.floor(currentFrame - startFrame)
                : -1;

            const selectionSlices = normalizedSelection.flatMap((range) => {
              if (range.endFrame < startFrame || range.startFrame > columnEnd) return [];
              const startRow = Math.max(0, Math.floor(range.startFrame - startFrame));
              const endRow = Math.min(framesPerColumn - 1, Math.floor(range.endFrame - startFrame));
              return [{ startRow, endRow }];
            });

            let pastEndStartRow: number | null = null;
            if (maxFrames <= startFrame) {
              pastEndStartRow = 0;
            } else if (maxFrames <= columnEnd) {
              pastEndStartRow = maxFrames - startFrame;
            }

            let endBoundaryRow: number | null = null;
            if (maxFrames >= startFrame && maxFrames <= columnEnd) {
              endBoundaryRow = maxFrames - startFrame;
            }

            return (
              <TimesheetColumn
                key={columnIndex}
                columnIndex={columnIndex}
                startFrame={startFrame}
                fps={fps}
                tracks={trackRenderData}
                cursorRow={cursorRow}
                isCurrentColumn={columnIndex === currentColumnIndex}
                isCurrentSheet={Math.floor(columnIndex / COLUMNS_PER_SHEET) === currentSheetIndex}
                selectionSlices={selectionSlices}
                endBoundaryRow={endBoundaryRow}
                pastEndStartRow={pastEndStartRow}
                columnWidth={columnWidth}
                columnHeight={columnHeight}
                rulerWidth={rulerWidth}
                rowHeight={rowHeight}
                trackMaxVolumes={trackMaxVolumes}
                trackDataKeys={trackDataKeys}
                trackOrderKey={trackOrderKey}
                activeTrackId={activeTrackId}
                layoutKey={layoutKey}
                touchAction={touchActionValue}
              />
            );
          })}

          {rightSpacerWidth > 0 && (
            <div className="shrink-0" style={{ width: `${rightSpacerWidth}px`, height: `${columnHeight}px` }} />
          )}

          {bottomSpacerHeight > 0 && (
            <div className="shrink-0" style={{ width: `${columnWidth}px`, height: `${bottomSpacerHeight}px` }} />
          )}
        </div>
      </div>
      {isMobileTimesheetLayout && (
        <div
          ref={mobileScrubRailRef}
          className="relative z-20 h-full shrink-0 border-l border-gray-300 bg-white/92 shadow-[-4px_0_12px_rgba(15,23,42,0.08)]"
          style={{ width: `${MOBILE_SIDEBAR_WIDTH}px`, touchAction: 'none' }}
          onPointerDown={handleMobileRailPointerDown}
          onPointerMove={handleMobileRailPointerMove}
          onPointerUp={handleMobileRailPointerUp}
          onPointerCancel={handleMobileRailPointerCancel}
        >
          <div
            className="pointer-events-none absolute top-0 bottom-0 left-0 border-r border-red-100 bg-white shadow-[-2px_0_8px_rgba(15,23,42,0.04)]"
            style={{ width: `${MOBILE_PLAYHEAD_LANE_WIDTH}px` }}
          >
            {currentFrameRailOffset !== null && currentFrameRailOffset >= -8 && currentFrameRailOffset <= viewportHeight + 8 && (
              <div
                className="absolute left-0 right-0 -translate-y-1/2"
                style={{ top: `${currentFrameRailOffset}px` }}
              >
                <div
                  className={`absolute left-1 right-2 top-1/2 -translate-y-1/2 border-t ${isMobileScrubRailActive ? 'border-red-500' : 'border-red-300'}`}
                />
                <div
                  className={`absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 shadow-sm ${isMobileScrubRailActive ? 'border-red-700 bg-red-500' : 'border-red-400 bg-white'}`}
                />
              </div>
            )}
          </div>
          <div
            className="pointer-events-none absolute top-0 bottom-0 overflow-hidden rounded-l-xl border-l border-gray-300 bg-white/92"
            style={{
              left: `${MOBILE_PLAYHEAD_LANE_WIDTH + MOBILE_PLAYHEAD_LANE_GAP}px`,
              width: `${MOBILE_SCRUB_RAIL_WIDTH}px`,
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-white via-white/90 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-white via-white/90 to-transparent" />
            {mobileRailTicks.map((tick) => (
              <div
                key={tick.frame}
                className={`absolute left-2 right-2 ${tick.isSecond ? 'border-t-2 border-gray-500' : tick.isHalfSecond ? 'border-t border-gray-400' : 'border-t border-gray-200'}`}
                style={{ top: `${tick.top}px` }}
              />
            ))}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-gray-800 px-2 py-1 text-[10px] font-medium text-white shadow-sm">
              {formatTimecodeOneBased(currentFrame, fps)}
            </div>
          </div>
        </div>
      )}
      {isMouseSelectionCursorVisible && (
        <div className="pointer-events-none absolute inset-0 z-50">
          <div
            ref={mouseSelectionCursorRef}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-600 bg-white/95 shadow-[0_0_0_2px_rgba(37,99,235,0.18)]"
          />
        </div>
      )}
      {wrapCue === 'up' && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-[11px] text-gray-600 shadow-sm">
          {t('timesheet.wrapUp')}
        </div>
      )}
      {wrapCue === 'down' && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-[11px] text-gray-600 shadow-sm">
          {t('timesheet.wrapDown')}
        </div>
      )}
    </div>
  );
};
