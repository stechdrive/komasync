export const formatTimecode = (totalFrames: number, fps: number): string => {
  const safeFrames = Math.max(0, Math.floor(totalFrames));
  const seconds = Math.floor(safeFrames / fps);
  const frames = safeFrames % fps;
  return `${seconds}+${String(frames).padStart(2, '0')}`;
};

export const formatTimecodeOneBased = (frameIndex: number, fps: number): string => {
  const safeFrames = Math.max(0, Math.floor(frameIndex)) + 1;
  const seconds = Math.floor(safeFrames / fps);
  const frames = safeFrames % fps;
  return `${seconds}+${String(frames).padStart(2, '0')}`;
};
