import type { FrameData } from '../types';

type FrameRange = {
  startFrame: number;
  endFrame: number;
};

const normalizeRange = (range: FrameRange): FrameRange => {
  const startFrame = Math.max(0, Math.floor(Math.min(range.startFrame, range.endFrame)));
  const endFrame = Math.max(startFrame, Math.floor(Math.max(range.startFrame, range.endFrame)));
  return { startFrame, endFrame };
};

const mergeRanges = (ranges: FrameRange[]): FrameRange[] => {
  if (ranges.length === 0) return [];
  const normalized = ranges
    .map(normalizeRange)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  const merged: FrameRange[] = [{ ...normalized[0] }];
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

const createSilentFrame = (frameIndex: number, fps: number): FrameData => ({
  frameIndex,
  time: frameIndex / fps,
  volume: 0,
  isSpeech: false,
});

const cloneFrameAtIndex = (frame: FrameData | undefined, frameIndex: number, fps: number): FrameData => ({
  frameIndex,
  time: frameIndex / fps,
  volume: frame?.volume ?? 0,
  isSpeech: frame?.isSpeech ?? false,
});

export const createSilentFrames = (length: number, fps: number): FrameData[] => {
  const safeLength = Math.max(0, Math.floor(length));
  return Array.from({ length: safeLength }, (_, index) => createSilentFrame(index, fps));
};

export const cloneFrames = (frames: FrameData[], fps: number): FrameData[] =>
  frames.map((frame, index) => cloneFrameAtIndex(frame, index, fps));

export const clearFrameRanges = (frames: FrameData[], ranges: FrameRange[], fps: number): FrameData[] => {
  const next = cloneFrames(frames, fps);
  mergeRanges(ranges).forEach((range) => {
    const start = Math.max(0, range.startFrame);
    const end = Math.min(next.length - 1, range.endFrame);
    for (let index = start; index <= end; index += 1) {
      next[index] = createSilentFrame(index, fps);
    }
  });
  return next;
};

export const extractFrameRangesPadded = (frames: FrameData[], ranges: FrameRange[], fps: number): FrameData[] => {
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return [];
  const spanStart = merged[0].startFrame;
  const spanEnd = merged[merged.length - 1].endFrame;
  const out = createSilentFrames(spanEnd - spanStart + 1, fps);

  merged.forEach((range) => {
    const start = Math.max(0, range.startFrame);
    const end = Math.min(frames.length - 1, range.endFrame);
    for (let index = start; index <= end; index += 1) {
      const outIndex = index - spanStart;
      out[outIndex] = cloneFrameAtIndex(frames[index], outIndex, fps);
    }
  });

  return out;
};

export const overwriteFramesAtFrame = (
  baseFrames: FrameData[],
  insertFrames: FrameData[],
  startFrame: number,
  fps: number
): FrameData[] => {
  const safeStart = Math.max(0, Math.floor(startFrame));
  const newLength = Math.max(baseFrames.length, safeStart + insertFrames.length);
  const out = createSilentFrames(newLength, fps);

  for (let index = 0; index < baseFrames.length; index += 1) {
    out[index] = cloneFrameAtIndex(baseFrames[index], index, fps);
  }
  for (let index = 0; index < insertFrames.length; index += 1) {
    const outIndex = safeStart + index;
    out[outIndex] = cloneFrameAtIndex(insertFrames[index], outIndex, fps);
  }

  return out;
};

export const insertFramesAtFrame = (
  baseFrames: FrameData[],
  insertFrames: FrameData[],
  startFrame: number,
  fps: number
): FrameData[] => {
  const safeStart = Math.max(0, Math.floor(startFrame));
  const prefixEnd = Math.min(safeStart, baseFrames.length);
  const padding = createSilentFrames(Math.max(0, safeStart - baseFrames.length), fps);
  const combined = [
    ...baseFrames.slice(0, prefixEnd),
    ...padding,
    ...insertFrames,
    ...baseFrames.slice(prefixEnd),
  ];
  return combined.map((frame, index) => cloneFrameAtIndex(frame, index, fps));
};

export const deleteFrameRangeRipple = (
  frames: FrameData[],
  startFrame: number,
  endFrame: number,
  fps: number
): FrameData[] => {
  const range = normalizeRange({ startFrame, endFrame });
  const start = Math.min(range.startFrame, frames.length);
  const end = Math.min(range.endFrame, frames.length - 1);
  if (end < start) return cloneFrames(frames, fps);
  const combined = frames.slice(0, start).concat(frames.slice(end + 1));
  return combined.map((frame, index) => cloneFrameAtIndex(frame, index, fps));
};
