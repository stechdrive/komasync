import { FrameData } from '@/types';
import { VadTuning } from '@/services/vad';

type VadWorkerRequest = {
  id: number;
  samples: Float32Array;
  sampleRate: number;
  fps: number;
  tuning: VadTuning;
};

type VadWorkerResponse = {
  id: number;
  frames?: FrameData[];
  error?: string;
};

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_MS = 20;
const VAD_FRAME_SAMPLES = Math.round((VAD_SAMPLE_RATE * VAD_FRAME_MS) / 1000);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const frameToSampleIndex = (frame: number, sampleRate: number, fps: number): number =>
  Math.round((frame * sampleRate) / fps);

const resampleTo16k = (input: Float32Array, sampleRate: number): Float32Array => {
  if (sampleRate === VAD_SAMPLE_RATE) return input.slice();
  if (input.length === 0) return new Float32Array();

  const ratio = sampleRate / VAD_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const frac = pos - index;
    const nextIndex = Math.min(index + 1, input.length - 1);
    output[i] = input[index] * (1 - frac) + input[nextIndex] * frac;
  }

  return output;
};

const floatToInt16 = (input: Float32Array): Int16Array => {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = clamp(input[i], -1, 1);
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
};

let vadModulePromise: Promise<any> | null = null;
let vadInstance = 0;

const loadVadModule = async () => {
  if (!vadModulePromise) {
    vadModulePromise = (async () => {
      const mod = await import('@ennuicastr/webrtcvad.js');
      const factory = (mod as any).default ?? (mod as any).WebRtcVad ?? mod;
      if (typeof factory !== 'function') {
        throw new Error('WebRtcVadのロードに失敗しました。');
      }
      return await factory();
    })();
  }
  return vadModulePromise;
};

const initVad = async (aggressiveness: number) => {
  const module = await loadVadModule();
  if (!vadInstance) {
    vadInstance = module.Create();
    if (!vadInstance) throw new Error('VADインスタンスの作成に失敗しました。');
  }
  module.Init(vadInstance);
  const mode = clamp(Math.round(aggressiveness), 0, 3);
  module.set_mode(vadInstance, mode);
  return { module, handle: vadInstance };
};

const analyze = async (request: VadWorkerRequest): Promise<FrameData[]> => {
  const { samples, sampleRate, fps, tuning } = request;
  if (samples.length === 0 || sampleRate <= 0 || fps <= 0) return [];

  const { module, handle } = await initVad(tuning.aggressiveness ?? 2);
  const resampled = resampleTo16k(samples, sampleRate);
  const pcm = floatToInt16(resampled);

  const vadFrameCount = Math.floor(pcm.length / VAD_FRAME_SAMPLES);
  const vadFlags = new Array<boolean>(vadFrameCount).fill(false);

  if (vadFrameCount > 0) {
    let pcmPtr = 0;
    try {
      pcmPtr = module.malloc(VAD_FRAME_SAMPLES * 2);
      if (!pcmPtr) throw new Error('VADバッファの確保に失敗しました。');
      const heap16 = new Int16Array(module.HEAP16.buffer, pcmPtr, VAD_FRAME_SAMPLES);

      for (let i = 0; i < vadFrameCount; i++) {
        const offset = i * VAD_FRAME_SAMPLES;
        heap16.set(pcm.subarray(offset, offset + VAD_FRAME_SAMPLES));
        const result = module.Process(handle, VAD_SAMPLE_RATE, pcmPtr, VAD_FRAME_SAMPLES);
        vadFlags[i] = result === 1;
      }
    } finally {
      if (pcmPtr) module.free(pcmPtr);
    }
  }

  const totalFrames = Math.floor((samples.length * fps) / sampleRate);
  const frames: FrameData[] = [];

  const startThreshold = tuning.startThreshold ?? 0.05;
  const endThreshold = tuning.endThreshold ?? startThreshold * 0.85;
  const speechRatio = clamp(tuning.speechRatio ?? 0.5, 0.1, 0.9);
  const holdFrames = Math.max(1, Math.round(tuning.holdFrames ?? 2));

  let active = false;
  let belowCount = 0;
  const vadFrameDuration = VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE;

  for (let i = 0; i < totalFrames; i++) {
    const startSample = frameToSampleIndex(i, sampleRate, fps);
    const endSampleExclusive = frameToSampleIndex(i + 1, sampleRate, fps);
    const endSample = Math.min(endSampleExclusive, samples.length);
    if (startSample >= endSample) break;

    let sumSquares = 0;
    for (let j = startSample; j < endSample; j++) sumSquares += samples[j] * samples[j];
    const frameSampleCount = endSample - startSample;
    const rms = frameSampleCount > 0 ? Math.sqrt(sumSquares / frameSampleCount) : 0;

    let vadSpeech = false;
    if (vadFrameCount > 0) {
      const startTime = startSample / sampleRate;
      const endTime = endSample / sampleRate;
      const lastIndex = vadFrameCount - 1;
      const vadStart = Math.max(0, Math.min(lastIndex, Math.floor(startTime / vadFrameDuration)));
      const vadEnd = Math.max(0, Math.min(lastIndex, Math.floor((endTime - 1e-6) / vadFrameDuration)));

      if (vadEnd >= vadStart) {
        let speechCount = 0;
        const total = vadEnd - vadStart + 1;
        for (let j = vadStart; j <= vadEnd; j++) {
          if (vadFlags[j]) speechCount++;
        }
        const ratio = total > 0 ? speechCount / total : 0;
        vadSpeech = ratio >= speechRatio;
      }
    } else {
      // 20ms未満はRMSだけで判定する。
      vadSpeech = rms >= startThreshold;
    }

    if (active) {
      if (vadSpeech || rms >= endThreshold) {
        belowCount = 0;
      } else {
        belowCount += 1;
        if (belowCount >= holdFrames) {
          active = false;
          belowCount = 0;
        }
      }
    } else {
      if (vadSpeech && rms >= startThreshold) {
        active = true;
        belowCount = 0;
      }
    }

    frames.push({
      frameIndex: i,
      time: i / fps,
      volume: rms,
      isSpeech: active,
    });
  }

  return frames;
};

self.onmessage = (event) => {
  const request = event.data as VadWorkerRequest | undefined;
  if (!request) return;

  void (async () => {
    try {
      const frames = await analyze(request);
      const response: VadWorkerResponse = { id: request.id, frames };
      self.postMessage(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response: VadWorkerResponse = { id: request.id, error: message };
      self.postMessage(response);
    }
  })();
};
