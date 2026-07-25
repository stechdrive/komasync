import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFrameFromColumnCursor,
  getMobileRailFrame,
  normalizeColumnCursor,
} from './timesheetPointer.ts';
import { getSheetEndFrameExclusiveFromFrame } from './timesheet.ts';
import { frameToSampleIndex } from '../services/audioEdit.ts';

const columnWidth = 640;
const rowHeight = 8;
const framesPerColumn = 72;
const columnHeight = rowHeight * framesPerColumn;
const totalColumns = 4;

const getFrame = (contentX: number, contentY: number): number => {
  const normalized = normalizeColumnCursor({
    contentX,
    contentY,
    columnWidth,
    columnHeight,
    totalColumns,
  });
  return getFrameFromColumnCursor({
    ...normalized,
    columnWidth,
    rowHeight,
    framesPerColumn,
    totalColumns,
  });
};

test('列末尾から下へ進むと次の列の先頭へ移る', () => {
  assert.equal(getFrame(columnWidth + 32, columnHeight - rowHeight / 2), 143);
  assert.equal(getFrame(columnWidth + 32, columnHeight + rowHeight / 2), 144);
});

test('列先頭から上へ戻ると前の列の末尾へ移る', () => {
  assert.equal(getFrame(columnWidth * 2 + 32, rowHeight / 2), 144);
  assert.equal(getFrame(columnWidth * 2 + 32, -rowHeight / 2), 143);
});

test('先頭と末尾では利用可能なフレーム範囲に留まる', () => {
  assert.equal(getFrame(32, -columnHeight * 3), 0);
  assert.equal(getFrame(columnWidth * 3 + 32, columnHeight * 3), 287);
});

test('モバイルレールはスクロール位置を含む連続フレームを返す', () => {
  assert.equal(
    getMobileRailFrame({
      scrollTop: 144 * rowHeight,
      localY: rowHeight / 2,
      rowHeight,
      totalFrames: 288,
    }),
    144
  );
});

test('現在フレームを含むシートの2列分を必ず確保する', () => {
  assert.equal(getSheetEndFrameExclusiveFromFrame(143, 24), 144);
  assert.equal(getSheetEndFrameExclusiveFromFrame(144, 24), 288);
});

test('スクラブ用のサンプル境界は隣接する1Fだけを切り出す', () => {
  const sampleRate = 44_100;
  const frame = 143;
  const startSample = frameToSampleIndex(frame, sampleRate, 24);
  const endSampleExclusive = frameToSampleIndex(frame + 1, sampleRate, 24);
  const nextStartSample = frameToSampleIndex(frame + 1, sampleRate, 24);

  assert.equal(endSampleExclusive, nextStartSample);
  assert.ok(endSampleExclusive - startSample <= Math.ceil(sampleRate / 24));
});
