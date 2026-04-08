import React, { useEffect, useMemo, useRef } from 'react';
import type { FrameData } from '@/types';
import { getFramesPerColumn, COLUMNS_PER_SHEET } from '@/domain/timesheet';
import { formatTimecodeOneBased } from '@/domain/timecode';
import { getTrackTheme } from '@/domain/trackTheme';
import { getEffectiveSpeech } from '@/services/speechLabels';

type TrackRenderData = {
  id: string;
  frames: FrameData[];
  speechOverrides: number[];
};

type TrackDataKey = {
  frames: FrameData[];
  speechOverrides: number[];
};

type SelectionSlice = {
  startRow: number;
  endRow: number;
};

type TimesheetColumnProps = {
  columnIndex: number;
  startFrame: number;
  fps: number;
  tracks: TrackRenderData[];
  cursorRow: number;
  isCurrentColumn: boolean;
  isCurrentSheet: boolean;
  selectionSlices: SelectionSlice[];
  endBoundaryRow: number | null;
  pastEndStartRow: number | null;
  columnWidth: number;
  columnHeight: number;
  rulerWidth: number;
  rightRulerWidth: number;
  rowHeight: number;
  trackMaxVolumes: number[];
  trackDataKeys: TrackDataKey[];
  trackOrderKey: string;
  activeTrackId: string | null;
  isMobileLayout: boolean;
  layoutKey: string;
  touchAction: React.CSSProperties['touchAction'];
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

type VadRange = { startRow: number; endRow: number };

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

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length !== 6) return null;
  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value)) return null;
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
};

const toRgba = (hex: string, alpha: number): string => {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(59, 130, 246, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const TimesheetColumnComponent: React.FC<TimesheetColumnProps> = ({
  columnIndex,
  startFrame,
  fps,
  tracks,
  cursorRow,
  isCurrentColumn,
  isCurrentSheet,
  selectionSlices,
  endBoundaryRow,
  pastEndStartRow,
  columnWidth,
  columnHeight,
  rulerWidth,
  rightRulerWidth,
  rowHeight,
  trackMaxVolumes,
  activeTrackId,
  isMobileLayout,
  touchAction,
}) => {
  const framesPerColumn = getFramesPerColumn(fps);
  const labelStep = rowHeight >= 11 ? 1 : rowHeight >= 9 ? 6 : rowHeight >= 7 ? 12 : 0;
  const rulerFontSize = clamp(rowHeight * 0.6, isMobileLayout ? 10 : 8, isMobileLayout ? 13 : 12);
  const columnOffset = (columnIndex % COLUMNS_PER_SHEET) * framesPerColumn;
  const waveCanvasRefs = useRef<Map<string, HTMLCanvasElement | null>>(new Map());
  const trackColumnWidth = useMemo(() => {
    const count = Math.max(1, tracks.length);
    return Math.max(1, (columnWidth - rulerWidth - rightRulerWidth) / count);
  }, [columnWidth, rightRulerWidth, rulerWidth, tracks.length]);

  const speechData = useMemo(() => {
    const rowsByTrack = new Map<string, boolean[]>();
    const rangesByTrack = new Map<string, VadRange[]>();

    tracks.forEach((track) => {
      const rows: boolean[] = [];
      for (let i = 0; i < framesPerColumn; i += 1) {
        rows.push(getEffectiveSpeech(track, startFrame + i));
      }
      rowsByTrack.set(track.id, rows);

      const ranges: VadRange[] = [];
      let rangeStart: number | null = null;
      rows.forEach((isSpeech, rowIndex) => {
        if (isSpeech) {
          if (rangeStart === null) rangeStart = rowIndex;
          return;
        }
        if (rangeStart !== null) {
          ranges.push({ startRow: rangeStart, endRow: rowIndex - 1 });
          rangeStart = null;
        }
      });
      if (rangeStart !== null) {
        ranges.push({ startRow: rangeStart, endRow: rows.length - 1 });
      }
      rangesByTrack.set(track.id, ranges);
    });

    return { rowsByTrack, rangesByTrack };
  }, [framesPerColumn, startFrame, tracks]);

  const columnBoundary = useMemo(() => {
    if (columnIndex === 0) return { className: 'border-l-0', style: undefined };
    if (columnIndex % COLUMNS_PER_SHEET === 0) {
      return {
        className: 'border-l border-gray-300',
        style: { boxShadow: 'inset 4px 0 0 rgba(75, 85, 99, 1)' },
      };
    }
    return { className: 'border-l border-gray-300', style: undefined };
  }, [columnIndex]);

  const selectionOverlays = useMemo(() => {
    if (selectionSlices.length === 0) return [];
    if (rowHeight <= 0) return [];

    const isAllTracks = activeTrackId === null;
    const targetIndex = isAllTracks ? 0 : tracks.findIndex((track) => track.id === activeTrackId);
    if (!isAllTracks && targetIndex < 0) return null;

    const left = rulerWidth + (isAllTracks ? 0 : targetIndex * trackColumnWidth);
    const width = isAllTracks ? trackColumnWidth * tracks.length : trackColumnWidth;
    return selectionSlices.map((selectionSlice) => {
      const top = selectionSlice.startRow * rowHeight;
      const height = (selectionSlice.endRow - selectionSlice.startRow + 1) * rowHeight;
      return { left, width, top, height };
    });
  }, [activeTrackId, rowHeight, rulerWidth, selectionSlices, trackColumnWidth, tracks]);

  const selectionBorderWidth = clamp(Math.round(rowHeight * 0.12), 1, 2);
  const vadBorderWidth = clamp(Math.round(rowHeight * 0.08), 1, 2);
  const currentColumnOutline = isCurrentColumn ? '0 0 0 2px rgba(239, 68, 68, 0.75) inset' : undefined;
  const currentSheetGlow = isCurrentSheet ? 'inset 0 0 0 1px rgba(251, 191, 36, 0.35)' : undefined;
  const columnAccentShadow = [currentSheetGlow, currentColumnOutline].filter(Boolean).join(', ') || undefined;

  useEffect(() => {
    if (columnHeight <= 0 || rowHeight <= 0 || trackColumnWidth <= 0) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const maxHalfPadding = 1;
    const barHeight = Math.max(1, rowHeight);
    const outlinePadding = Math.min(0.7, rowHeight * 0.08);

    tracks.forEach((track, trackIndex) => {
      const canvas = waveCanvasRefs.current.get(track.id);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cssWidth = trackColumnWidth;
      const cssHeight = columnHeight;
      const nextWidth = Math.max(1, Math.floor(cssWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.floor(cssHeight * pixelRatio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const volumeMax = trackMaxVolumes[trackIndex] ?? 0;
      const volumeDenom = volumeMax > 0 ? volumeMax : 1;
      const centerX = cssWidth / 2;
      const maxHalfWidth = Math.max(1, centerX - maxHalfPadding);
      const minHalfWidth = Math.max(1, Math.round(maxHalfWidth * 0.06));
      const theme = getTrackTheme(track.id);
      const outlineColor = 'rgba(15, 23, 42, 0.22)';
      const highlightColor = 'rgba(255, 255, 255, 0.3)';
      const waveColor = toRgba(theme.accentHex, 0.45);

      for (let i = 0; i < framesPerColumn; i++) {
        const frame = track.frames[startFrame + i];
        const volume = frame?.volume ?? 0;
        if (volume <= 0) continue;
        const normalized = Math.min(1, volume / volumeDenom);
        const halfWidth = Math.max(minHalfWidth, maxHalfWidth * normalized);
        if (halfWidth <= 0.5) continue;
        const y = i * rowHeight;
        ctx.fillStyle = outlineColor;
        ctx.fillRect(
          centerX - halfWidth - outlinePadding,
          y,
          halfWidth * 2 + outlinePadding * 2,
          barHeight
        );
        ctx.fillStyle = waveColor;
        ctx.fillRect(centerX - halfWidth, y, halfWidth * 2, barHeight);
        ctx.fillStyle = highlightColor;
        ctx.fillRect(centerX - 0.5, y, 1, barHeight);
      }
    });
  }, [columnHeight, framesPerColumn, rowHeight, startFrame, trackColumnWidth, trackMaxVolumes, tracks]);

  return (
    <div
      className={`relative shrink-0 snap-start ${columnBoundary.className}`}
      style={{
        width: `${columnWidth}px`,
        height: `${columnHeight}px`,
        background: isCurrentSheet ? 'linear-gradient(180deg, rgba(255, 251, 235, 0.9), rgba(255, 255, 255, 0.96))' : undefined,
        boxShadow: [columnBoundary.style?.boxShadow, columnAccentShadow].filter(Boolean).join(', ') || undefined,
        ...(columnBoundary.style ?? {}),
      }}
    >
      {isCurrentColumn && (
        <div className="pointer-events-none absolute top-0 left-0 right-0 z-50 h-1 bg-red-400" />
      )}
      <div className="absolute inset-0 pointer-events-none z-10">
        {tracks.map((track, index) => (
          <canvas
            key={track.id}
            ref={(el) => {
              waveCanvasRefs.current.set(track.id, el);
            }}
            className="absolute top-0"
            style={{
              left: `${rulerWidth + trackColumnWidth * index}px`,
              width: `${trackColumnWidth}px`,
              height: `${columnHeight}px`,
            }}
          />
        ))}
      </div>
      <div
        className="grid"
        style={{
          height: `${columnHeight}px`,
          gridTemplateRows: `repeat(${framesPerColumn}, ${rowHeight}px)`,
          gridTemplateColumns: `${rulerWidth}px repeat(${tracks.length}, minmax(0, 1fr)) ${rightRulerWidth}px`,
        }}
      >
        {Array.from({ length: framesPerColumn }).map((_, rowIndex) => {
          const globalFrameIndex = startFrame + rowIndex;
          const frameNumInColumn = rowIndex + 1;
          const showFrameLabel =
            labelStep === 1 ||
            frameNumInColumn === 1 ||
            (labelStep > 1 && frameNumInColumn % labelStep === 0);
          const localFrameNumber = columnOffset + frameNumInColumn;

          const isPastEnd = pastEndStartRow !== null ? rowIndex >= pastEndStartRow : false;
          const isEndBoundary = endBoundaryRow !== null && rowIndex === endBoundaryRow;
          const isCurrent = rowIndex === cursorRow;

          const isInSelection = selectionSlices.some(
            (selectionSlice) => rowIndex >= selectionSlice.startRow && rowIndex <= selectionSlice.endRow
          );

          const rulerBorder = getRowBorderClass(rowIndex, fps, true);
          const rulerTone = isCurrent ? 'bg-yellow-200 text-gray-900 font-bold' : 'bg-gray-50 text-gray-600';

          return (
            <React.Fragment key={rowIndex}>
              {/* ルーラー */}
              <div
                data-frame-index={globalFrameIndex}
                data-ruler="left"
                className={`flex items-center justify-center font-mono select-none overflow-hidden leading-none cursor-ns-resize ${rulerBorder} ${rulerTone} border-r border-gray-300`}
                style={{ fontSize: `${rulerFontSize}px`, lineHeight: 1, touchAction }}
              >
                {showFrameLabel || isCurrent ? localFrameNumber : ''}
              </div>

              {/* トラック */}
              {tracks.map((track) => {
                const isSpeech = speechData.rowsByTrack.get(track.id)?.[rowIndex] ?? false;
                const isTargetTrack = activeTrackId === null || activeTrackId === track.id;
                const isActiveTrack = activeTrackId === track.id;
                const theme = getTrackTheme(track.id);
                const isSelectionActive = isInSelection && isTargetTrack;
                const highlightBorder = isActiveTrack ? 'rgba(15, 23, 42, 0.35)' : undefined;
                const highlightBg =
                  isActiveTrack && !isCurrent && !isSelectionActive ? 'rgba(15, 23, 42, 0.06)' : undefined;
                const vadColor = toRgba(theme.accentHex, 0.25);

                const borderClass = getRowBorderClass(rowIndex, fps, false);
                const cellCursor = isCurrent ? 'cursor-grab' : 'cursor-pointer';

                let bgClass = '';
                if (isCurrent) bgClass = 'bg-yellow-200';
                else if (isSelectionActive) bgClass = 'bg-sky-300/70';
                else if (isTargetTrack) bgClass = 'bg-white';
                else bgClass = 'bg-gray-50';

                if (isPastEnd && !isCurrent && !isInSelection) bgClass = 'bg-slate-100/80';
                const shadowParts = [
                  ...(highlightBorder
                    ? [`inset 2px 0 0 ${highlightBorder}`, `inset -2px 0 0 ${highlightBorder}`]
                    : []),
                ];
                const cellShadow = shadowParts.length > 0 ? shadowParts.join(', ') : undefined;
                const highlightOverlay = highlightBg
                  ? { backgroundImage: `linear-gradient(${highlightBg}, ${highlightBg})` }
                  : undefined;

                return (
                  <div
                    key={track.id}
                    data-frame-index={globalFrameIndex}
                    data-track-id={track.id}
                    className={`relative ${cellCursor} ${borderClass} ${bgClass} border-r border-gray-200 box-border`}
                    style={{
                      ...(cellShadow ? { boxShadow: cellShadow } : {}),
                      ...(highlightOverlay ?? {}),
                      touchAction,
                    }}
                  >
                    {isEndBoundary && (
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-400 z-10 pointer-events-none overflow-visible" />
                    )}

                    {isSpeech && (
                      <div
                        className="absolute inset-y-0 left-0 right-0 rounded-sm pointer-events-none z-20"
                        style={{ backgroundColor: vadColor }}
                      />
                    )}
                  </div>
                );
              })}

              {/* 右ルーラー */}
              {rightRulerWidth > 0 && (
                <div
                  data-frame-index={globalFrameIndex}
                  data-ruler="right"
                  className={`flex items-center justify-center font-mono select-none overflow-hidden leading-none cursor-ns-resize ${rulerBorder} ${rulerTone} border-l border-gray-300`}
                  style={{ fontSize: `${rulerFontSize}px`, lineHeight: 1, touchAction }}
                >
                  {showFrameLabel || isCurrent ? formatTimecodeOneBased(globalFrameIndex, fps) : ''}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="absolute inset-0 pointer-events-none z-30">
        {tracks.map((track, index) => {
          const ranges = speechData.rangesByTrack.get(track.id) ?? [];
          if (ranges.length === 0) return null;
          const outlineColor = toRgba(getTrackTheme(track.id).accentHex, 0.7);
          const left = rulerWidth + trackColumnWidth * index;
          const width = trackColumnWidth;

          return ranges.map((range) => {
            const top = range.startRow * rowHeight;
            const height = (range.endRow - range.startRow + 1) * rowHeight;
            return (
              <div
                key={`${track.id}-${range.startRow}-${range.endRow}`}
                className="absolute rounded-sm"
                style={{
                  top: `${top}px`,
                  left: `${left}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  border: `${vadBorderWidth}px solid`,
                  borderColor: outlineColor,
                  boxSizing: 'border-box',
                }}
              />
            );
          });
        })}
      </div>
      {selectionOverlays?.map((selectionOverlay) => (
        <div
          key={`${selectionOverlay.top}-${selectionOverlay.height}`}
          className="absolute pointer-events-none z-40"
          style={{
            top: `${selectionOverlay.top}px`,
            left: `${selectionOverlay.left}px`,
            width: `${selectionOverlay.width}px`,
            height: `${selectionOverlay.height}px`,
            border: `${selectionBorderWidth}px dotted rgba(37, 99, 235, 0.9)`,
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  );
};

const areSelectionSlicesEqual = (a: SelectionSlice[], b: SelectionSlice[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.startRow !== b[i]?.startRow) return false;
    if (a[i]?.endRow !== b[i]?.endRow) return false;
  }
  return true;
};

const areTrackDataKeysEqual = (a: TrackDataKey[], b: TrackDataKey[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.frames !== b[i]?.frames) return false;
    if (a[i]?.speechOverrides !== b[i]?.speechOverrides) return false;
  }
  return true;
};

const areNumberArraysEqual = (a: number[], b: number[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const areTimesheetColumnPropsEqual = (prev: TimesheetColumnProps, next: TimesheetColumnProps): boolean => {
  if (prev.columnIndex !== next.columnIndex) return false;
  if (prev.startFrame !== next.startFrame) return false;
  if (prev.cursorRow !== next.cursorRow) return false;
  if (prev.isCurrentColumn !== next.isCurrentColumn) return false;
  if (prev.isCurrentSheet !== next.isCurrentSheet) return false;
  if (prev.endBoundaryRow !== next.endBoundaryRow) return false;
  if (prev.pastEndStartRow !== next.pastEndStartRow) return false;
  if (prev.rightRulerWidth !== next.rightRulerWidth) return false;
  if (prev.layoutKey !== next.layoutKey) return false;
  if (prev.trackOrderKey !== next.trackOrderKey) return false;
  if (prev.activeTrackId !== next.activeTrackId) return false;
  if (prev.isMobileLayout !== next.isMobileLayout) return false;
  if (!areSelectionSlicesEqual(prev.selectionSlices, next.selectionSlices)) return false;
  if (!areTrackDataKeysEqual(prev.trackDataKeys, next.trackDataKeys)) return false;
  if (!areNumberArraysEqual(prev.trackMaxVolumes, next.trackMaxVolumes)) return false;
  return true;
};

export const TimesheetColumn = React.memo(TimesheetColumnComponent, areTimesheetColumnPropsEqual);
TimesheetColumn.displayName = 'TimesheetColumn';
