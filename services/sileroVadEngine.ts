import { FrameData } from '@/types';
import { analyzeAudioBufferWithVad, VadTuning } from '@/services/vad';

type VadWorkerRequest = {
  id: number;
  samples: Float32Array;
  sampleRate: number;
  fps: number;
  tuning: VadTuning;
  baseUrl: string;
};

type VadWorkerResponse = {
  id: number;
  frames?: FrameData[];
  error?: string;
};

export type SileroVadStatus = 'idle' | 'silero' | 'fallback';
export type SileroVadError = string | null;

let worker: Worker | null = null;
let workerFailed = false;
let requestId = 0;
let vadStatus: SileroVadStatus = 'idle';
let vadError: SileroVadError = null;
const statusListeners = new Set<(status: SileroVadStatus) => void>();
const errorListeners = new Set<(error: SileroVadError) => void>();

const pending = new Map<
  number,
  { resolve: (frames: FrameData[]) => void; reject: (error: Error) => void }
>();

const setVadStatus = (nextStatus: SileroVadStatus) => {
  if (vadStatus === nextStatus) return;
  vadStatus = nextStatus;
  statusListeners.forEach((listener) => listener(vadStatus));
};

const setVadError = (nextError: SileroVadError) => {
  if (vadError === nextError) return;
  vadError = nextError;
  errorListeners.forEach((listener) => listener(vadError));
};

export const getSileroVadStatus = (): SileroVadStatus => vadStatus;

export const subscribeSileroVadStatus = (listener: (status: SileroVadStatus) => void): (() => void) => {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};

export const getSileroVadError = (): SileroVadError => vadError;

export const subscribeSileroVadError = (listener: (error: SileroVadError) => void): (() => void) => {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
};

const resolveBaseUrl = (): string => {
  try {
    return new URL(import.meta.env.BASE_URL, window.location.href).toString();
  } catch {
    return import.meta.env.BASE_URL || '/';
  }
};

const failWorker = (error: Error) => {
  if (workerFailed) return;
  workerFailed = true;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  setVadStatus('fallback');
  setVadError(error.message);
  pending.forEach(({ reject }) => reject(error));
  pending.clear();
};

const ensureWorker = () => {
  if (worker || workerFailed) return;
  worker = new Worker(new URL('./sileroVadWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, frames, error } = event.data as VadWorkerResponse;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);

    if (error) {
      const err = new Error(error);
      entry.reject(err);
      failWorker(err);
      return;
    }

    if (!frames) {
      entry.reject(new Error('VADワーカーの応答が不正です。'));
      failWorker(new Error('VADワーカーの応答が不正です。'));
      return;
    }

    entry.resolve(frames);
  };
  worker.onerror = (event) => {
    const err = new Error(event.message || 'VADワーカーでエラーが発生しました。');
    failWorker(err);
  };
};

export const analyzeAudioBufferWithSileroVadEngine = async (
  audioBuffer: AudioBuffer,
  fps: number,
  tuning: VadTuning
): Promise<FrameData[]> => {
  if (workerFailed) {
    setVadStatus('fallback');
    return analyzeAudioBufferWithVad(audioBuffer, fps, tuning);
  }

  try {
    ensureWorker();
    if (!worker) throw new Error('VADワーカーの初期化に失敗しました。');

    const channelData = audioBuffer.getChannelData(0);
    // AudioBufferの内部領域を破壊しないようにコピーして転送する。
    const samples = new Float32Array(channelData.length);
    samples.set(channelData);

    const id = requestId + 1;
    requestId = id;

    const frames = await new Promise<FrameData[]>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (!worker) {
        pending.delete(id);
        reject(new Error('VADワーカーが利用できません。'));
        return;
      }
      const payload: VadWorkerRequest = {
        id,
        samples,
        sampleRate: audioBuffer.sampleRate,
        fps,
        tuning,
        baseUrl: resolveBaseUrl(),
      };
      worker.postMessage(payload, [samples.buffer]);
    });

    setVadStatus('silero');
    setVadError(null);
    return frames;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    failWorker(err);
    return analyzeAudioBufferWithVad(audioBuffer, fps, tuning);
  }
};
