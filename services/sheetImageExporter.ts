import JSZip from 'jszip';
import { Track } from '@/types';
import { getFramesPerColumn, getFramesPerSheet, COLUMNS_PER_SHEET } from '@/domain/timesheet';
import { getTrackTheme } from '@/domain/trackTheme';

type ExportScope = { type: 'all' } | { type: 'sheet'; sheetIndex: number };

type SheetRenderConfig = {
  scale: number;
  margin: number;
  headerHeight: number;
  footerHeight: number;
  rowHeight: number;
  rulerWidth: number;
  rightRulerWidth: number;
  trackWidth: number;
  vadAlpha: number;
};

const DEFAULT_CONFIG: SheetRenderConfig = {
  scale: 2,
  margin: 16,
  headerHeight: 44,
  footerHeight: 24,
  rowHeight: 12,
  rulerWidth: 60,
  rightRulerWidth: 60,
  trackWidth: 70,
  vadAlpha: 0.28,
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const pad2 = (n: number): string => String(n).padStart(2, '0');

const toPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error('PNG生成に失敗しました。'));
      else resolve(b);
    }, 'image/png');
  });

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const drawSheetToCanvas = (
  tracks: Track[],
  fps: number,
  sheetIndex: number,
  maxFrames: number,
  config: SheetRenderConfig
): HTMLCanvasElement => {
  const framesPerColumn = getFramesPerColumn(fps);
  const framesPerSheet = getFramesPerSheet(fps);

  const columnWidth = config.rulerWidth + config.trackWidth * tracks.length + config.rightRulerWidth;
  const sheetWidth = config.margin * 2 + columnWidth * COLUMNS_PER_SHEET;
  const sheetHeight =
    config.margin * 2 + config.headerHeight + framesPerColumn * config.rowHeight + config.footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sheetWidth * config.scale);
  canvas.height = Math.round(sheetHeight * config.scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvasの初期化に失敗しました。');

  ctx.scale(config.scale, config.scale);
  ctx.textBaseline = 'middle';

  // 背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheetWidth, sheetHeight);

  const sheetStartFrame = sheetIndex * framesPerSheet;
  const sheetStartSec = Math.floor(sheetStartFrame / fps);
  const sheetEndSec = sheetStartSec + 6;

  // ヘッダー
  ctx.fillStyle = '#111827';
  ctx.font = '700 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`KomaSync シート ${sheetIndex + 1}`, config.margin, config.margin + config.headerHeight / 2);

  ctx.fillStyle = '#6b7280';
  ctx.font = '500 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(
    `${pad2(sheetStartSec)}–${pad2(sheetEndSec)}s（6秒 / 144コマ）`,
    config.margin + 160,
    config.margin + config.headerHeight / 2
  );

  // 外枠
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 1;
  ctx.strokeRect(config.margin, config.margin, sheetWidth - config.margin * 2, sheetHeight - config.margin * 2);

  const gridTop = config.margin + config.headerHeight;
  const gridLeft = config.margin;

  // 縦の境界線（列/トラック）
  for (let col = 0; col < COLUMNS_PER_SHEET; col++) {
    const colX = gridLeft + col * columnWidth;

    // 6秒境界（列の間）
    if (col > 0) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(colX, gridTop);
      ctx.lineTo(colX, gridTop + framesPerColumn * config.rowHeight);
      ctx.stroke();
    }

    // ルーラー境界
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(colX + config.rulerWidth, gridTop);
    ctx.lineTo(colX + config.rulerWidth, gridTop + framesPerColumn * config.rowHeight);
    ctx.stroke();

    // トラック境界
    for (let t = 1; t < tracks.length; t++) {
      const x = colX + config.rulerWidth + t * config.trackWidth;
      ctx.beginPath();
      ctx.moveTo(x, gridTop);
      ctx.lineTo(x, gridTop + framesPerColumn * config.rowHeight);
      ctx.stroke();
    }

    // 右ルーラー境界
    const rightRulerLeft = colX + config.rulerWidth + config.trackWidth * tracks.length;
    ctx.beginPath();
    ctx.moveTo(rightRulerLeft, gridTop);
    ctx.lineTo(rightRulerLeft, gridTop + framesPerColumn * config.rowHeight);
    ctx.stroke();
  }

  const showAllFrameLabels = config.rowHeight >= 10;
  const labelFontSize = showAllFrameLabels ? 9 : 10;

  // グリッド（横線＋塗り）
  for (let row = 0; row < framesPerColumn; row++) {
    const y = gridTop + row * config.rowHeight;
    const lineY = y + config.rowHeight;
    const frameInSecond = row + 1;
    const isSecond = frameInSecond % fps === 0;
    const half = Math.floor(fps / 2);
    const isHalfSecond = half > 0 ? frameInSecond % half === 0 : false;
    const isSixFrame = frameInSecond % 6 === 0;
    const showFrameLabel = showAllFrameLabels || frameInSecond === 1 || frameInSecond % 6 === 0;

    // 横線
    ctx.strokeStyle = isSecond ? '#111827' : isHalfSecond ? '#9ca3af' : isSixFrame ? '#d1d5db' : '#e5e7eb';
    ctx.lineWidth = isSecond ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(gridLeft, lineY);
    ctx.lineTo(gridLeft + columnWidth * COLUMNS_PER_SHEET, lineY);
    ctx.stroke();

    // ルーラー数値（各列）
    if (showFrameLabel) {
      ctx.fillStyle = '#4b5563';
      ctx.font = `600 ${labelFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      for (let col = 0; col < COLUMNS_PER_SHEET; col++) {
        const colX = gridLeft + col * columnWidth;
        const localFrame = col * framesPerColumn + frameInSecond;
        const rightRulerLeft = colX + config.rulerWidth + config.trackWidth * tracks.length;
        const globalFrame = sheetStartFrame + col * framesPerColumn + row + 1;

        ctx.fillText(String(localFrame), colX + config.rulerWidth / 2, y + config.rowHeight / 2);
        ctx.fillText(
          String(globalFrame),
          rightRulerLeft + config.rightRulerWidth / 2,
          y + config.rowHeight / 2
        );
      }
    }

    // VAD塗り（各列×各トラック）
    for (let col = 0; col < COLUMNS_PER_SHEET; col++) {
      const colStartFrame = sheetStartFrame + col * framesPerColumn;
      const globalFrameIndex = colStartFrame + row;

      for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
        const track = tracks[trackIndex];
        const colX = gridLeft + col * columnWidth;
        const cellX = colX + config.rulerWidth + trackIndex * config.trackWidth;

        if (globalFrameIndex >= maxFrames) {
          // 末尾以降は薄く
          ctx.fillStyle = '#f3f4f6';
          ctx.fillRect(cellX, y, config.trackWidth, config.rowHeight);
          continue;
        }

        const isSpeech = Boolean(track.frames[globalFrameIndex]?.isSpeech);
        if (!isSpeech) continue;

        const color = getTrackTheme(track.id).accentHex;
        ctx.save();
        ctx.globalAlpha = config.vadAlpha;
        ctx.fillStyle = color;
        ctx.fillRect(cellX, y, config.trackWidth, config.rowHeight);
        ctx.restore();
      }
    }
  }

  ctx.textAlign = 'left';

  // フッター
  ctx.fillStyle = '#6b7280';
  ctx.font = '500 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(
    `Tracks: ${tracks.map((t) => t.name).join(' / ')}`,
    config.margin,
    gridTop + framesPerColumn * config.rowHeight + config.footerHeight / 2
  );

  return canvas;
};

export const exportSheetImagesToZip = async (
  tracks: Track[],
  fps: number,
  scope: ExportScope,
  config: Partial<SheetRenderConfig> = {}
): Promise<void> => {
  const merged: SheetRenderConfig = { ...DEFAULT_CONFIG, ...config };

  const maxFrames = Math.max(0, ...tracks.map((t) => t.frames.length));
  const framesPerSheet = getFramesPerSheet(fps);
  const totalSheets = Math.max(1, Math.ceil(maxFrames / framesPerSheet));

  const sheetIndices =
    scope.type === 'all'
      ? Array.from({ length: totalSheets }).map((_, i) => i)
      : [clamp(scope.sheetIndex, 0, totalSheets - 1)];

  const zip = new JSZip();
  for (const sheetIndex of sheetIndices) {
    const canvas = drawSheetToCanvas(tracks, fps, sheetIndex, maxFrames, merged);
    const blob = await toPngBlob(canvas);
    const filename = `sheet_${String(sheetIndex + 1).padStart(3, '0')}.png`;
    zip.file(filename, blob);
  }

  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, `komasync_sheets_${dateStr}.zip`);
};
