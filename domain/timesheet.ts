export const DEFAULT_FPS = 24;
export const SECONDS_PER_COLUMN = 3;
export const COLUMNS_PER_SHEET = 2;

export const getFramesPerColumn = (fps: number): number => fps * SECONDS_PER_COLUMN; // 72 @24fps
export const getFramesPerSheet = (fps: number): number => getFramesPerColumn(fps) * COLUMNS_PER_SHEET; // 144 @24fps

export const getColumnIndexFromFrame = (frame: number, fps: number): number =>
  Math.floor(frame / getFramesPerColumn(fps));

export const getSheetIndexFromFrame = (frame: number, fps: number): number =>
  Math.floor(frame / getFramesPerSheet(fps));

export const getColumnStartFrame = (columnIndex: number, fps: number): number =>
  columnIndex * getFramesPerColumn(fps);

export const getSheetStartFrame = (sheetIndex: number, fps: number): number =>
  sheetIndex * getFramesPerSheet(fps);

