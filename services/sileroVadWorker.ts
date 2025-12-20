import { FrameData } from '@/types';
import { VadTuning } from '@/services/vad';
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

const VAD_SAMPLE_RATE = 16000;
const VAD_CHUNK_SAMPLES = 512;
const VAD_STEP_SAMPLES = 320;
const PROB_MIN = 0.05;
const PROB_MAX = 0.95;
const NOISE_FLOOR_QUANTILE = 0.2;
const NOISE_FLOOR_MULTIPLIER = 2.0;

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

const quantile = (values: ArrayLike<number>, q: number): number => {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
};

type OrtModule = typeof import('onnxruntime-web');

type SileroSessionInfo = {
  ort: OrtModule;
  session: import('onnxruntime-web').InferenceSession;
  inputName: string;
  srName: string;
  outputName: string;
  inputShape: number[];
  useState: boolean;
  stateName?: string;
  stateOutputName?: string;
  stateShape?: number[];
  hName?: string;
  cName?: string;
  hnName?: string;
  cnName?: string;
  hShape?: number[];
  cShape?: number[];
};

let sessionPromise: Promise<SileroSessionInfo> | null = null;
let sessionBaseUrl = '';

const normalizeBaseUrl = (baseUrl: string): string => {
  if (!baseUrl) return '/';
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
};

const findName = (names: string[], candidates: string[]): string | undefined => {
  const lower = names.map((name) => name.toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate);
    if (index >= 0) return names[index];
  }
  for (const candidate of candidates) {
    const index = lower.findIndex((name) => name.includes(candidate));
    if (index >= 0) return names[index];
  }
  return undefined;
};

const resolveStateShape = (meta: { dimensions?: number[] } | undefined, fallback: number[]): number[] => {
  const dims = meta?.dimensions ?? [];
  const valid = dims.length >= 2 && dims.every((dim) => typeof dim === 'number' && dim > 0);
  return valid ? dims : fallback;
};

const resolveInputShape = (meta: { dimensions?: number[] } | undefined): number[] => {
  const dims = meta?.dimensions ?? [];
  if (dims.length === 3) return [1, 1, VAD_CHUNK_SAMPLES];
  if (dims.length === 2) return [1, VAD_CHUNK_SAMPLES];
  return [1, VAD_CHUNK_SAMPLES];
};

const ensureSession = async (baseUrl: string): Promise<SileroSessionInfo> => {
  const resolvedBase = normalizeBaseUrl(baseUrl);
  if (!sessionPromise || sessionBaseUrl !== resolvedBase) {
    sessionBaseUrl = resolvedBase;
    sessionPromise = (async () => {
      const ort = (await import('onnxruntime-web')) as OrtModule;
      const wasmBaseUrl = new URL('onnxruntime/', resolvedBase).toString();
      ort.env.wasm.wasmPaths = wasmBaseUrl;
      ort.env.wasm.numThreads = 1;

      const modelUrl = new URL('models/silero_vad.onnx', resolvedBase).toString();
      const session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      const inputNames = session.inputNames;
      const outputNames = session.outputNames;

      const inputName = findName(inputNames, ['input']) ?? inputNames[0];
      const stateName = findName(inputNames, ['state']);
      const hName = findName(inputNames, ['h']);
      const cName = findName(inputNames, ['c']);
      const srName =
        findName(inputNames, ['sr', 'sample_rate']) ??
        inputNames.find((name) => name !== inputName && name !== stateName && name !== hName && name !== cName) ??
        inputNames[1];
      const useState = Boolean(stateName) && !hName && !cName;

      const outputName = findName(outputNames, ['output']) ?? outputNames[0];
      const stateOutputName = useState
        ? findName(outputNames, ['staten', 'state_n', 'state']) ?? outputNames.find((name) => name !== outputName)
        : undefined;
      const hnName = !useState ? findName(outputNames, ['hn', 'h']) ?? outputNames[1] : undefined;
      const cnName = !useState ? findName(outputNames, ['cn', 'c']) ?? outputNames[2] : undefined;

      const inputShape = resolveInputShape(session.inputMetadata?.[inputName]);
      const stateShape = useState ? resolveStateShape(session.inputMetadata?.[stateName ?? ''], [2, 1, 128]) : undefined;
      const hShape = !useState ? resolveStateShape(session.inputMetadata?.[hName ?? ''], [2, 1, 64]) : undefined;
      const cShape = !useState ? resolveStateShape(session.inputMetadata?.[cName ?? ''], [2, 1, 64]) : undefined;

      return {
        ort,
        session,
        inputName,
        srName,
        outputName,
        inputShape,
        useState,
        stateName,
        stateOutputName,
        stateShape,
        hName,
        cName,
        hnName,
        cnName,
        hShape,
        cShape,
      };
    })();
  }

  return sessionPromise;
};

const runSilero = async (samples: Float32Array, baseUrl: string): Promise<Float32Array> => {
  const sessionInfo = await ensureSession(baseUrl);
  const {
    ort,
    session,
    inputName,
    srName,
    outputName,
    inputShape,
    useState,
    stateName,
    stateOutputName,
    stateShape,
    hName,
    cName,
    hnName,
    cnName,
    hShape,
    cShape,
  } = sessionInfo;

  if (samples.length === 0) return new Float32Array();
  if (useState) {
    if (!stateName || !stateShape || !stateOutputName) {
      throw new Error('Silero VADモデルの状態入出力が見つかりません。');
    }
  } else if (!hName || !cName || !hShape || !cShape || !hnName || !cnName) {
    throw new Error('Silero VADモデルの入出力が見つかりません。');
  }

  let stateData: Float32Array | null = null;
  let hState: Float32Array | null = null;
  let cState: Float32Array | null = null;
  if (useState && stateShape) {
    stateData = new Float32Array(stateShape.reduce((acc, dim) => acc * dim, 1));
  } else if (!useState && hShape && cShape) {
    hState = new Float32Array(hShape.reduce((acc, dim) => acc * dim, 1));
    cState = new Float32Array(cShape.reduce((acc, dim) => acc * dim, 1));
  }

  const srTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(VAD_SAMPLE_RATE)]), [1]);
  const probs: number[] = [];

  for (let offset = 0; offset < samples.length; offset += VAD_STEP_SAMPLES) {
    const chunk = new Float32Array(VAD_CHUNK_SAMPLES);
    const slice = samples.subarray(offset, Math.min(offset + VAD_CHUNK_SAMPLES, samples.length));
    chunk.set(slice);

    const feeds: Record<string, import('onnxruntime-web').Tensor> = {
      [inputName]: new ort.Tensor('float32', chunk, inputShape),
      [srName]: srTensor,
    };
    if (useState && stateName && stateShape && stateData) {
      feeds[stateName] = new ort.Tensor('float32', stateData, stateShape);
    } else if (!useState && hName && cName && hShape && cShape && hState && cState) {
      feeds[hName] = new ort.Tensor('float32', hState, hShape);
      feeds[cName] = new ort.Tensor('float32', cState, cShape);
    }

    const outputs = await session.run(feeds);
    const outputTensor = outputs[outputName];
    const outputData = outputTensor.data as Float32Array | number[];
    const prob = typeof outputData[0] === 'number' ? outputData[0] : Number(outputData[0]);
    probs.push(prob ?? 0);

    if (useState && stateOutputName) {
      const nextState = outputs[stateOutputName]?.data as Float32Array | undefined;
      if (nextState) {
        stateData = new Float32Array(nextState);
      }
    } else if (!useState && hnName && cnName) {
      const hn = outputs[hnName]?.data as Float32Array | undefined;
      const cn = outputs[cnName]?.data as Float32Array | undefined;
      if (hn && cn) {
        hState = new Float32Array(hn);
        cState = new Float32Array(cn);
      }
    }
  }

  return Float32Array.from(probs);
};

const analyze = async (request: VadWorkerRequest): Promise<FrameData[]> => {
  const { samples, sampleRate, fps, tuning, baseUrl } = request;
  if (samples.length === 0 || sampleRate <= 0 || fps <= 0) return [];

  const resampled = resampleTo16k(samples, sampleRate);
  const probabilities = await runSilero(resampled, baseUrl);

  const baseThreshold = clamp(tuning.probabilityBase ?? 0.5, PROB_MIN, PROB_MAX);
  const thresholdScale = clamp(tuning.thresholdScale ?? 1, 0.5, 1.5);
  const noiseFloor = quantile(probabilities, NOISE_FLOOR_QUANTILE);
  // 自動最適化: ノイズ床に応じて閾値を補正する。
  const autoThreshold = Math.max(baseThreshold, noiseFloor * NOISE_FLOOR_MULTIPLIER);
  const startThreshold = clamp(autoThreshold * thresholdScale, PROB_MIN, PROB_MAX);
  const hysteresis = clamp(tuning.probabilityHysteresis ?? 0.7, 0.4, 0.95);
  const endThreshold = clamp(startThreshold * hysteresis, PROB_MIN, startThreshold);

  const speechRatio = clamp(tuning.speechRatio ?? 0.5, 0.1, 0.95);
  const holdFrames = Math.max(1, Math.round(tuning.holdFrames ?? 2));

  const totalFrames = Math.floor((samples.length * fps) / sampleRate);
  const frames: FrameData[] = [];

  let active = false;
  let belowCount = 0;

  for (let i = 0; i < totalFrames; i++) {
    const startSample = frameToSampleIndex(i, sampleRate, fps);
    const endSampleExclusive = frameToSampleIndex(i + 1, sampleRate, fps);
    const endSample = Math.min(endSampleExclusive, samples.length);
    if (startSample >= endSample) break;

    let sumSquares = 0;
    for (let j = startSample; j < endSample; j++) sumSquares += samples[j] * samples[j];
    const frameSampleCount = endSample - startSample;
    const rms = frameSampleCount > 0 ? Math.sqrt(sumSquares / frameSampleCount) : 0;

    let frameSpeech = false;
    if (probabilities.length > 0) {
      const frameStartTime = i / fps;
      const frameEndTime = (i + 1) / fps;
      const frameStartSample16k = Math.max(0, Math.floor(frameStartTime * VAD_SAMPLE_RATE));
      const frameEndSample16k = Math.max(frameStartSample16k + 1, Math.floor(frameEndTime * VAD_SAMPLE_RATE));
      const stepStart = Math.floor(frameStartSample16k / VAD_STEP_SAMPLES);
      const stepEnd = Math.floor((frameEndSample16k - 1) / VAD_STEP_SAMPLES);
      const maxStep = probabilities.length - 1;
      const clampedStart = Math.max(0, Math.min(maxStep, stepStart));
      const clampedEnd = Math.max(0, Math.min(maxStep, stepEnd));

      if (clampedEnd >= clampedStart) {
        const threshold = active ? endThreshold : startThreshold;
        let speechCount = 0;
        const total = clampedEnd - clampedStart + 1;
        for (let j = clampedStart; j <= clampedEnd; j++) {
          if (probabilities[j] >= threshold) speechCount++;
        }
        const ratio = total > 0 ? speechCount / total : 0;
        frameSpeech = ratio >= speechRatio;
      }
    } else {
      frameSpeech = rms >= (tuning.startThreshold ?? 0.05);
    }

    if (active) {
      if (frameSpeech) {
        belowCount = 0;
      } else {
        belowCount += 1;
        if (belowCount >= holdFrames) {
          active = false;
          belowCount = 0;
        }
      }
    } else if (frameSpeech) {
      active = true;
      belowCount = 0;
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
