import { Track } from '@/types';

// 1: セリフ強制、0: 自動、-1: 非セリフ強制
export const createSpeechOverrides = (length: number): number[] => {
  const safeLength = Math.max(0, Math.floor(length));
  return Array.from({ length: safeLength }, () => 0);
};

export const resizeSpeechOverrides = (overrides: number[] | undefined, length: number): number[] => {
  const safeLength = Math.max(0, Math.floor(length));
  const next = overrides ? overrides.slice(0, safeLength) : [];
  while (next.length < safeLength) next.push(0);
  return next;
};

const normalizeRange = (startFrame: number, endFrame: number): { start: number; end: number } => {
  const start = Math.max(0, Math.floor(Math.min(startFrame, endFrame)));
  const end = Math.max(start, Math.floor(Math.max(startFrame, endFrame)));
  return { start, end };
};

export const applyOverrideRange = (
  overrides: number[],
  startFrame: number,
  endFrame: number,
  value: number
): number[] => {
  if (overrides.length === 0) return overrides.slice();
  const { start, end } = normalizeRange(startFrame, endFrame);
  const safeEnd = Math.min(end, overrides.length - 1);
  if (safeEnd < start) return overrides.slice();
  const next = overrides.slice();
  for (let i = start; i <= safeEnd; i += 1) {
    next[i] = value;
  }
  return next;
};

export const clearOverrideRange = (overrides: number[], startFrame: number, endFrame: number): number[] =>
  applyOverrideRange(overrides, startFrame, endFrame, 0);

export const extractOverrideRange = (overrides: number[], startFrame: number, endFrame: number): number[] => {
  const { start, end } = normalizeRange(startFrame, endFrame);
  const length = end - start + 1;
  if (length <= 0) return [];
  const slice = overrides.slice(start, end + 1);
  if (slice.length >= length) return slice;
  return slice.concat(createSpeechOverrides(length - slice.length));
};

export const insertOverrideRange = (
  overrides: number[],
  startFrame: number,
  insertOverrides: number[]
): number[] => {
  const safeStart = Math.max(0, Math.floor(startFrame));
  const prefixEnd = Math.min(safeStart, overrides.length);
  const prefix = overrides.slice(0, prefixEnd);
  const padLength = Math.max(0, safeStart - overrides.length);
  const padding = createSpeechOverrides(padLength);
  const suffix = overrides.slice(prefixEnd);
  return prefix.concat(padding, insertOverrides, suffix);
};

export const deleteOverrideRange = (overrides: number[], startFrame: number, endFrame: number): number[] => {
  if (overrides.length === 0) return overrides.slice();
  const { start, end } = normalizeRange(startFrame, endFrame);
  const safeStart = Math.min(start, overrides.length);
  const safeEnd = Math.min(end, overrides.length - 1);
  if (safeEnd < safeStart) return overrides.slice();
  return overrides.slice(0, safeStart).concat(overrides.slice(safeEnd + 1));
};

export const overwriteOverrideRange = (
  overrides: number[],
  startFrame: number,
  overrideSlice: number[]
): number[] => {
  const safeStart = Math.max(0, Math.floor(startFrame));
  const neededLength = safeStart + overrideSlice.length;
  const next = resizeSpeechOverrides(overrides, Math.max(overrides.length, neededLength));
  for (let i = 0; i < overrideSlice.length; i += 1) {
    next[safeStart + i] = overrideSlice[i] ?? 0;
  }
  return next;
};

export const getEffectiveSpeech = (track: Track, frameIndex: number): boolean => {
  if (frameIndex < 0) return false;
  const override = track.speechOverrides[frameIndex] ?? 0;
  if (override === 1) return true;
  if (override === -1) return false;
  return Boolean(track.frames[frameIndex]?.isSpeech);
};
