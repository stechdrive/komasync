export type ColumnCursorPosition = {
  contentX: number;
  contentY: number;
};

type NormalizeColumnCursorOptions = ColumnCursorPosition & {
  columnWidth: number;
  columnHeight: number;
  totalColumns: number;
};

type ColumnCursorFrameOptions = ColumnCursorPosition & {
  columnWidth: number;
  rowHeight: number;
  framesPerColumn: number;
  totalColumns: number;
};

type MobileRailFrameOptions = {
  scrollTop: number;
  localY: number;
  rowHeight: number;
  totalFrames: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const normalizeColumnCursor = ({
  contentX,
  contentY,
  columnWidth,
  columnHeight,
  totalColumns,
}: NormalizeColumnCursorOptions): ColumnCursorPosition => {
  if (columnWidth <= 0 || columnHeight <= 0 || totalColumns <= 0) {
    return { contentX: 0, contentY: 0 };
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

  return {
    contentX: nextX,
    contentY: clamp(nextY, 0, maxContentY),
  };
};

export const getFrameFromColumnCursor = ({
  contentX,
  contentY,
  columnWidth,
  rowHeight,
  framesPerColumn,
  totalColumns,
}: ColumnCursorFrameOptions): number => {
  if (columnWidth <= 0 || rowHeight <= 0 || framesPerColumn <= 0 || totalColumns <= 0) {
    return 0;
  }

  const columnIndex = clamp(Math.floor(contentX / columnWidth), 0, totalColumns - 1);
  const rowIndex = clamp(Math.floor(contentY / rowHeight), 0, framesPerColumn - 1);
  return columnIndex * framesPerColumn + rowIndex;
};

export const getMobileRailFrame = ({
  scrollTop,
  localY,
  rowHeight,
  totalFrames,
}: MobileRailFrameOptions): number => {
  if (rowHeight <= 0 || totalFrames <= 0) return 0;
  return clamp(Math.floor((scrollTop + localY) / rowHeight), 0, totalFrames - 1);
};
