import type { FrameData } from '../types';

export type EditTarget = 'all' | string;

export type SelectionRange = {
  startFrame: number;
  endFrame: number;
};

export type SelectionRanges = SelectionRange[];

export type ClipboardClip = {
  kind: 'single' | 'all';
  byTrackId: Record<string, AudioBuffer>;
  framesByTrackId: Record<string, FrameData[]>;
  speechOverridesByTrackId: Record<string, number[]>;
};
