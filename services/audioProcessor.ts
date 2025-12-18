import { FrameData } from '../types';

export const processAudioBuffer = (
  audioBuffer: AudioBuffer,
  threshold: number,
  fps: number = 24
): FrameData[] => {
  const channelData = audioBuffer.getChannelData(0); // Use mono or left channel
  const sampleRate = audioBuffer.sampleRate;
  const samplesPerFrame = Math.floor(sampleRate / fps);
  const totalFrames = Math.floor(channelData.length / samplesPerFrame);
  
  const frames: FrameData[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const startSample = i * samplesPerFrame;
    const endSample = startSample + samplesPerFrame;
    
    // Calculate RMS (Root Mean Square) for this frame
    let sumSquares = 0;
    for (let j = startSample; j < endSample; j++) {
      if (j < channelData.length) {
        sumSquares += channelData[j] * channelData[j];
      }
    }
    
    const rms = Math.sqrt(sumSquares / samplesPerFrame);
    
    // Simple noise gate / VAD
    // Normalize volume slightly for better visualization, but keep RMS relative logic
    const isSpeech = rms > threshold;

    frames.push({
      frameIndex: i,
      time: i / fps,
      volume: rms,
      isSpeech,
    });
  }

  return frames;
};

export const blobToAudioBuffer = async (blob: Blob): Promise<AudioBuffer> => {
  if (!blob || blob.size === 0) {
    throw new Error("Audio blob is empty");
  }

  const arrayBuffer = await blob.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
      throw new Error("Audio array buffer is empty");
  }

  // Create a temporary context just for decoding
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
      throw new Error("AudioContext is not supported");
  }
  
  const ctx = new AudioContextClass();
  try {
    // Handle both Promise-based and Callback-based decodeAudioData for broader browser support
    return await new Promise<AudioBuffer>((resolve, reject) => {
      let settled = false;
      const doResolve = (buf: AudioBuffer) => { if (!settled) { settled = true; resolve(buf); } };
      const doReject = (err: any) => { 
          if (!settled) { 
              settled = true; 
              // Extract meaningful error message
              const msg = err instanceof DOMException ? err.message : (err?.message || String(err));
              reject(new Error(`Decode error: ${msg}`)); 
          } 
      };

      try {
        const res = ctx.decodeAudioData(
          arrayBuffer,
          doResolve,
          (err) => doReject(err)
        );
        
        // Standard Promise-based implementation
        if (res && typeof res.then === 'function') {
          res.then(doResolve).catch(doReject);
        }
      } catch (e) {
        doReject(e);
      }
    });
  } finally {
    // CRITICAL: Close the context to release hardware resources
    // Browsers have a limit (usually 6) on active AudioContexts
    if (ctx.state !== 'closed') {
      try {
        await ctx.close();
      } catch (e) {
        console.warn("Failed to close audio context", e);
      }
    }
  }
};

export const cutAudioBuffer = (
  originalBuffer: AudioBuffer,
  framesToRemove: Set<number>,
  fps: number = 24
): AudioBuffer => {
  const sampleRate = originalBuffer.sampleRate;
  const samplesPerFrame = Math.floor(sampleRate / fps);
  const totalFrames = Math.floor(originalBuffer.length / samplesPerFrame);
  
  // Count valid frames to keep
  let framesToKeepCount = 0;
  for (let i = 0; i < totalFrames; i++) {
    if (!framesToRemove.has(i)) {
      framesToKeepCount++;
    }
  }
  
  // If result is empty or invalid, return a minimal silent buffer
  if (framesToKeepCount <= 0) {
    return new AudioBuffer({
      length: 1,
      numberOfChannels: originalBuffer.numberOfChannels,
      sampleRate: sampleRate
    });
  }

  const newLength = framesToKeepCount * samplesPerFrame;
  
  // Use the standard AudioBuffer constructor which is lighter and doesn't hit context limits
  const newBuffer = new AudioBuffer({
    length: newLength,
    numberOfChannels: originalBuffer.numberOfChannels,
    sampleRate: sampleRate
  });

  for (let channel = 0; channel < originalBuffer.numberOfChannels; channel++) {
    const originalData = originalBuffer.getChannelData(channel);
    const newData = newBuffer.getChannelData(channel);
    
    let writeCursor = 0;

    for (let i = 0; i < totalFrames; i++) {
      if (!framesToRemove.has(i)) {
        const start = i * samplesPerFrame;
        // Ensure we don't read past buffer end
        const end = Math.min(start + samplesPerFrame, originalData.length);
        const chunk = originalData.subarray(start, end);
        
        // Ensure we don't write past new buffer end
        if (writeCursor + chunk.length <= newData.length) {
          newData.set(chunk, writeCursor);
          writeCursor += chunk.length;
        }
      }
    }
  }

  return newBuffer;
};

/**
 * Extracts a specific range of frames into a new AudioBuffer (Copy/Cut)
 */
export const extractAudioSlice = (
  sourceBuffer: AudioBuffer,
  startFrame: number,
  endFrame: number,
  fps: number = 24
): AudioBuffer | null => {
  if (startFrame > endFrame) return null;

  const sampleRate = sourceBuffer.sampleRate;
  const samplesPerFrame = Math.floor(sampleRate / fps);
  
  const startSample = startFrame * samplesPerFrame;
  const endSample = (endFrame + 1) * samplesPerFrame; // +1 to include the end frame
  
  if (startSample >= sourceBuffer.length) return null;
  
  const actualEndSample = Math.min(endSample, sourceBuffer.length);
  const length = actualEndSample - startSample;
  
  if (length <= 0) return null;

  const newBuffer = new AudioBuffer({
    length: length,
    numberOfChannels: sourceBuffer.numberOfChannels,
    sampleRate: sampleRate
  });

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
    const channelData = sourceBuffer.getChannelData(channel);
    const newChannelData = newBuffer.getChannelData(channel);
    newChannelData.set(channelData.subarray(startSample, actualEndSample));
  }

  return newBuffer;
};

/**
 * Overwrites audio at a specific position (Paste)
 * Expands the buffer if necessary.
 */
export const overwriteAudioBuffer = (
  baseBuffer: AudioBuffer,
  insertBuffer: AudioBuffer,
  startFrame: number,
  fps: number = 24
): AudioBuffer => {
  const sampleRate = baseBuffer.sampleRate;
  const samplesPerFrame = Math.floor(sampleRate / fps);
  const startSample = startFrame * samplesPerFrame;
  
  // Calculate new total length
  const neededLength = startSample + insertBuffer.length;
  const newLength = Math.max(baseBuffer.length, neededLength);

  const newBuffer = new AudioBuffer({
    length: newLength,
    numberOfChannels: baseBuffer.numberOfChannels,
    sampleRate: sampleRate
  });

  for (let channel = 0; channel < baseBuffer.numberOfChannels; channel++) {
    const baseData = baseBuffer.getChannelData(channel);
    const insertData = insertBuffer.getChannelData(channel % insertBuffer.numberOfChannels); // Handle mono insert into stereo
    const newData = newBuffer.getChannelData(channel);

    // 1. Copy base data first
    newData.set(baseData);

    // 2. Overwrite with insert data
    newData.set(insertData, startSample);
  }

  return newBuffer;
};