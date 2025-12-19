export type EditTarget = 'all' | string;

export type SelectionRange = {
  startFrame: number;
  endFrame: number;
};

export type ClipboardClip = {
  kind: 'single' | 'all';
  byTrackId: Record<string, AudioBuffer>;
};

