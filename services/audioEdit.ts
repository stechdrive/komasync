const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const frameToSampleIndex = (frame: number, sampleRate: number, fps: number): number =>
  Math.round((frame * sampleRate) / fps);

const getSampleRangeFromFrameRange = (
  startFrameInclusive: number,
  endFrameInclusive: number,
  sampleRate: number,
  fps: number
): { startSample: number; endSampleExclusive: number } => {
  const safeStartFrame = Math.max(0, Math.floor(startFrameInclusive));
  const safeEndFrame = Math.max(safeStartFrame, Math.floor(endFrameInclusive));

  const startSample = frameToSampleIndex(safeStartFrame, sampleRate, fps);
  const endSampleExclusive = frameToSampleIndex(safeEndFrame + 1, sampleRate, fps);
  return { startSample, endSampleExclusive };
};

const ensureSampleRateMatch = (a: AudioBuffer, b: AudioBuffer) => {
  if (a.sampleRate !== b.sampleRate) {
    throw new Error(`Sample rate mismatch: base=${a.sampleRate}, insert=${b.sampleRate}`);
  }
};

const createAudioBuffer = (sampleRate: number, numberOfChannels: number, length: number): AudioBuffer => {
  const safeLength = Math.max(1, Math.floor(length));
  return new AudioBuffer({ sampleRate, numberOfChannels, length: safeLength });
};

const normalizeRange = (
  startFrameInclusive: number,
  endFrameInclusive: number
): { startFrame: number; endFrame: number } => {
  const startFrame = Math.max(0, Math.floor(Math.min(startFrameInclusive, endFrameInclusive)));
  const endFrame = Math.max(startFrame, Math.floor(Math.max(startFrameInclusive, endFrameInclusive)));
  return { startFrame, endFrame };
};

const mergeFrameRanges = (
  ranges: Array<{ startFrame: number; endFrame: number }>
): Array<{ startFrame: number; endFrame: number }> => {
  if (ranges.length === 0) return [];
  const normalized = ranges
    .map((range) => normalizeRange(range.startFrame, range.endFrame))
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);

  const merged: Array<{ startFrame: number; endFrame: number }> = [normalized[0]];
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

export const extractAudioRange = (
  sourceBuffer: AudioBuffer,
  startFrameInclusive: number,
  endFrameInclusive: number,
  fps: number
): AudioBuffer | null => {
  const { startSample, endSampleExclusive } = getSampleRangeFromFrameRange(
    startFrameInclusive,
    endFrameInclusive,
    sourceBuffer.sampleRate,
    fps
  );

  const start = clamp(startSample, 0, sourceBuffer.length);
  const end = clamp(endSampleExclusive, 0, sourceBuffer.length);

  const length = end - start;
  if (length <= 0) return null;

  const clip = createAudioBuffer(sourceBuffer.sampleRate, sourceBuffer.numberOfChannels, length);
  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
    const src = sourceBuffer.getChannelData(channel);
    clip.getChannelData(channel).set(src.subarray(start, end));
  }
  return clip;
};

export const extractAudioRangePadded = (
  sourceBuffer: AudioBuffer | null,
  startFrameInclusive: number,
  endFrameInclusive: number,
  fps: number,
  options?: { sampleRate?: number; numberOfChannels?: number }
): AudioBuffer => {
  const sampleRate = sourceBuffer?.sampleRate ?? options?.sampleRate ?? 44100;
  const numberOfChannels = sourceBuffer?.numberOfChannels ?? options?.numberOfChannels ?? 1;

  const { startSample, endSampleExclusive } = getSampleRangeFromFrameRange(
    startFrameInclusive,
    endFrameInclusive,
    sampleRate,
    fps
  );

  const length = Math.max(0, endSampleExclusive - startSample);
  const clip = createAudioBuffer(sampleRate, numberOfChannels, length);

  if (!sourceBuffer || length <= 0) return clip;

  if (sourceBuffer.sampleRate !== sampleRate) {
    throw new Error(`Sample rate mismatch: source=${sourceBuffer.sampleRate}, clip=${sampleRate}`);
  }

  const srcStart = clamp(startSample, 0, sourceBuffer.length);
  const srcEnd = clamp(endSampleExclusive, 0, sourceBuffer.length);
  if (srcStart >= srcEnd) return clip;

  const dstStart = srcStart - startSample;
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const srcChannel = channel % sourceBuffer.numberOfChannels;
    const src = sourceBuffer.getChannelData(srcChannel);
    clip.getChannelData(channel).set(src.subarray(srcStart, srcEnd), dstStart);
  }

  return clip;
};

export const deleteAudioRangeRipple = (
  sourceBuffer: AudioBuffer,
  startFrameInclusive: number,
  endFrameInclusive: number,
  fps: number
): AudioBuffer => {
  const { startSample, endSampleExclusive } = getSampleRangeFromFrameRange(
    startFrameInclusive,
    endFrameInclusive,
    sourceBuffer.sampleRate,
    fps
  );

  const start = clamp(startSample, 0, sourceBuffer.length);
  const end = clamp(endSampleExclusive, 0, sourceBuffer.length);
  const removeLength = Math.max(0, end - start);

  const newLength = sourceBuffer.length - removeLength;
  if (newLength <= 0) {
    return createAudioBuffer(sourceBuffer.sampleRate, sourceBuffer.numberOfChannels, 1);
  }

  const out = createAudioBuffer(sourceBuffer.sampleRate, sourceBuffer.numberOfChannels, newLength);

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
    const src = sourceBuffer.getChannelData(channel);
    const dst = out.getChannelData(channel);

    if (start > 0) dst.set(src.subarray(0, start), 0);
    if (end < sourceBuffer.length) dst.set(src.subarray(end), start);
  }

  return out;
};

export const cutAudioRangeWithSilence = (
  sourceBuffer: AudioBuffer,
  startFrameInclusive: number,
  endFrameInclusive: number,
  fps: number
): { newBuffer: AudioBuffer; clip: AudioBuffer | null } => {
  const clip = extractAudioRange(sourceBuffer, startFrameInclusive, endFrameInclusive, fps);
  if (!clip) return { newBuffer: sourceBuffer, clip: null };

  const { startSample, endSampleExclusive } = getSampleRangeFromFrameRange(
    startFrameInclusive,
    endFrameInclusive,
    sourceBuffer.sampleRate,
    fps
  );

  const start = clamp(startSample, 0, sourceBuffer.length);
  const end = clamp(endSampleExclusive, 0, sourceBuffer.length);

  const out = createAudioBuffer(sourceBuffer.sampleRate, sourceBuffer.numberOfChannels, sourceBuffer.length);
  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
    const src = sourceBuffer.getChannelData(channel);
    const dst = out.getChannelData(channel);
    dst.set(src);
    dst.fill(0, start, end);
  }

  return { newBuffer: out, clip };
};

export const clearAudioRangesWithSilence = (
  sourceBuffer: AudioBuffer,
  ranges: Array<{ startFrame: number; endFrame: number }>,
  fps: number
): AudioBuffer => {
  const merged = mergeFrameRanges(ranges);
  if (merged.length === 0) return sourceBuffer;

  const out = createAudioBuffer(sourceBuffer.sampleRate, sourceBuffer.numberOfChannels, sourceBuffer.length);
  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
    const src = sourceBuffer.getChannelData(channel);
    const dst = out.getChannelData(channel);
    dst.set(src);
  }

  merged.forEach((range) => {
    const { startSample, endSampleExclusive } = getSampleRangeFromFrameRange(
      range.startFrame,
      range.endFrame,
      sourceBuffer.sampleRate,
      fps
    );
    const start = clamp(startSample, 0, sourceBuffer.length);
    const end = clamp(endSampleExclusive, 0, sourceBuffer.length);
    if (end <= start) return;
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
      out.getChannelData(channel).fill(0, start, end);
    }
  });

  return out;
};

export const extractAudioRangesPadded = (
  sourceBuffer: AudioBuffer | null,
  ranges: Array<{ startFrame: number; endFrame: number }>,
  fps: number,
  options?: { sampleRate?: number; numberOfChannels?: number }
): AudioBuffer => {
  const sampleRate = sourceBuffer?.sampleRate ?? options?.sampleRate ?? 44100;
  const numberOfChannels = sourceBuffer?.numberOfChannels ?? options?.numberOfChannels ?? 1;
  const merged = mergeFrameRanges(ranges);
  if (merged.length === 0) {
    return createAudioBuffer(sampleRate, numberOfChannels, 1);
  }

  const spanStartFrame = merged[0].startFrame;
  const spanEndFrame = merged[merged.length - 1].endFrame;
  const clip = extractAudioRangePadded(sourceBuffer, spanStartFrame, spanEndFrame, fps, {
    sampleRate,
    numberOfChannels,
  });

  if (!sourceBuffer) return clip;
  if (sourceBuffer.sampleRate !== sampleRate) {
    throw new Error(`Sample rate mismatch: source=${sourceBuffer.sampleRate}, clip=${sampleRate}`);
  }

  for (let channel = 0; channel < numberOfChannels; channel++) {
    clip.getChannelData(channel).fill(0);
  }

  merged.forEach((range) => {
    const slice = extractAudioRange(sourceBuffer, range.startFrame, range.endFrame, fps);
    if (!slice) return;
    const offsetSample = frameToSampleIndex(range.startFrame - spanStartFrame, sampleRate, fps);
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const dst = clip.getChannelData(channel);
      const src = slice.getChannelData(channel % slice.numberOfChannels);
      dst.set(src, offsetSample);
    }
  });

  return clip;
};

export const overwriteAudioAtFrame = (
  baseBuffer: AudioBuffer | null,
  insertBuffer: AudioBuffer,
  startFrame: number,
  fps: number
): AudioBuffer => {
  const sampleRate = baseBuffer?.sampleRate ?? insertBuffer.sampleRate;
  const numberOfChannels = baseBuffer?.numberOfChannels ?? insertBuffer.numberOfChannels;
  const baseLength = baseBuffer?.length ?? 0;

  if (baseBuffer) ensureSampleRateMatch(baseBuffer, insertBuffer);

  const startSampleRaw = frameToSampleIndex(Math.max(0, Math.floor(startFrame)), sampleRate, fps);
  const startSample = Math.max(0, startSampleRaw);

  const neededLength = startSample + insertBuffer.length;
  const newLength = Math.max(baseLength, neededLength);
  const out = createAudioBuffer(sampleRate, numberOfChannels, newLength);

  // 1) copy base
  if (baseBuffer) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const src = baseBuffer.getChannelData(channel);
      out.getChannelData(channel).set(src);
    }
  }

  // 2) overwrite
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const insertChannel = channel % insertBuffer.numberOfChannels;
    const insertData = insertBuffer.getChannelData(insertChannel);
    out.getChannelData(channel).set(insertData, startSample);
  }

  return out;
};

export const insertAudioAtFrame = (
  baseBuffer: AudioBuffer | null,
  insertBuffer: AudioBuffer,
  startFrame: number,
  fps: number
): AudioBuffer => {
  const sampleRate = baseBuffer?.sampleRate ?? insertBuffer.sampleRate;
  const numberOfChannels = baseBuffer?.numberOfChannels ?? insertBuffer.numberOfChannels;
  const baseLength = baseBuffer?.length ?? 0;

  if (baseBuffer) ensureSampleRateMatch(baseBuffer, insertBuffer);

  const startSampleRaw = frameToSampleIndex(Math.max(0, Math.floor(startFrame)), sampleRate, fps);
  const startSample = Math.max(0, startSampleRaw);

  const insertLength = insertBuffer.length;
  const newLength = startSample <= baseLength ? baseLength + insertLength : startSample + insertLength;
  const out = createAudioBuffer(sampleRate, numberOfChannels, newLength);

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const dst = out.getChannelData(channel);
    const insertChannel = channel % insertBuffer.numberOfChannels;
    const insertData = insertBuffer.getChannelData(insertChannel);

    if (baseBuffer) {
      const src = baseBuffer.getChannelData(channel);
      const prefixEnd = Math.min(startSample, baseLength);
      if (prefixEnd > 0) dst.set(src.subarray(0, prefixEnd), 0);

      dst.set(insertData, startSample);

      if (startSample < baseLength) {
        dst.set(src.subarray(startSample), startSample + insertLength);
      }
    } else {
      dst.set(insertData, startSample);
    }
  }

  return out;
};

export const insertSilenceFramesAtFrame = (
  baseBuffer: AudioBuffer | null,
  startFrame: number,
  frameCount: number,
  fps: number,
  options?: { sampleRate?: number; numberOfChannels?: number }
): AudioBuffer => {
  const sampleRate = baseBuffer?.sampleRate ?? options?.sampleRate ?? 44100;
  const numberOfChannels = baseBuffer?.numberOfChannels ?? options?.numberOfChannels ?? 1;

  const safeStartFrame = Math.max(0, Math.floor(startFrame));
  const safeFrameCount = Math.max(0, Math.floor(frameCount));

  const startSample = frameToSampleIndex(safeStartFrame, sampleRate, fps);
  const endSample = frameToSampleIndex(safeStartFrame + safeFrameCount, sampleRate, fps);
  const silenceLength = Math.max(0, endSample - startSample);

  if (silenceLength <= 0) return baseBuffer ?? createAudioBuffer(sampleRate, numberOfChannels, 1);

  const silence = createAudioBuffer(sampleRate, numberOfChannels, silenceLength);
  // 生成直後はゼロ埋めされている想定
  return insertAudioAtFrame(baseBuffer, silence, safeStartFrame, fps);
};
