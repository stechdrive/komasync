import { FrameData } from '@/types';
import { frameToSampleIndex } from '@/services/audioEdit';

export type VadPreset = 'quiet' | 'normal' | 'noisy';

export type VadTuning = {
  startThreshold: number;
  endThreshold: number;
  holdFrames: number;
  aggressiveness: number;
  speechRatio: number;
  probabilityBase: number;
  probabilityHysteresis: number;
  thresholdScale: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const START_PREROLL_FRAMES = 3;
const START_PREROLL_VOLUME_RATIO = 0.2;

const applySpeechPreroll = (frames: FrameData[], tuning: VadTuning): void => {
  if (frames.length < 2 || START_PREROLL_FRAMES <= 0) return;
  // 口パク優先で開始を前倒し（前フレームに微小な音量があればセリフ扱い）
  const volumeThreshold = (tuning.startThreshold ?? 0) * START_PREROLL_VOLUME_RATIO;
  for (let i = 1; i < frames.length; i++) {
    if (!frames[i - 1].isSpeech && frames[i].isSpeech) {
      for (let j = 1; j <= START_PREROLL_FRAMES; j += 1) {
        const index = i - j;
        if (index < 0) break;
        const target = frames[index];
        if (!target.isSpeech && target.volume >= volumeThreshold) {
          target.isSpeech = true;
        }
      }
    }
  }
};

export const getVadTuning = (preset: VadPreset, stability01: number, thresholdScale = 1): VadTuning => {
  const stability = clamp(stability01, 0, 1);
  const thresholdGain = clamp(thresholdScale, 0.5, 1.5);

  // --- Silero 確率閾値（公式推奨ベース） ---
  // quiet:  threshold=0.5, neg=0.35 (公式デフォルトそのまま)
  // normal: threshold=0.5, neg=0.35
  // noisy:  threshold=0.65, neg=0.50 (ノイズ耐性を上げる)
  const probabilityBase = preset === 'noisy' ? 0.65 : 0.5;
  // neg_threshold = threshold - 0.15 → hysteresis = (threshold - 0.15) / threshold
  const probabilityHysteresis = preset === 'noisy' ? 0.77 : 0.7;
  const speechRatio = 0.5;
  const holdFrames = preset === 'quiet' ? 0 : Math.round(2 + 10 * stability);

  // --- RMS 閾値（Silero フォールバック用） ---
  const baseThreshold = preset === 'quiet' ? 0.03 : preset === 'noisy' ? 0.08 : 0.05;
  const startThreshold = clamp(baseThreshold * (1 - 0.4 * stability) * thresholdGain, 0.005, 0.5);
  const hysteresisRatio = clamp(0.85 - 0.25 * stability, 0.55, 0.9);
  const endThreshold = startThreshold * hysteresisRatio;
  const aggressiveness = preset === 'quiet' ? 1 : preset === 'noisy' ? 3 : 2;

  return {
    startThreshold,
    endThreshold,
    holdFrames,
    aggressiveness,
    speechRatio,
    probabilityBase,
    probabilityHysteresis,
    thresholdScale: thresholdGain,
  };
};

export const analyzeAudioBufferWithVad = (
  audioBuffer: AudioBuffer,
  fps: number,
  tuning: VadTuning
): FrameData[] => {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const totalFrames = Math.round((channelData.length * fps) / sampleRate);

  const frames: FrameData[] = [];

  let active = false;
  let belowCount = 0;

  for (let i = 0; i < totalFrames; i++) {
    const startSample = frameToSampleIndex(i, sampleRate, fps);
    const endSampleExclusive = frameToSampleIndex(i + 1, sampleRate, fps);
    const endSample = Math.min(endSampleExclusive, channelData.length);
    if (startSample >= endSample) break;

    let sumSquares = 0;
    for (let j = startSample; j < endSample; j++) sumSquares += channelData[j] * channelData[j];
    const frameSampleCount = endSample - startSample;
    const rms = frameSampleCount > 0 ? Math.sqrt(sumSquares / frameSampleCount) : 0;

    if (active) {
      if (rms < tuning.endThreshold) {
        belowCount++;
        if (belowCount >= tuning.holdFrames) {
          active = false;
          belowCount = 0;
        }
      } else {
        belowCount = 0;
      }
    } else {
      if (rms >= tuning.startThreshold) {
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

  applySpeechPreroll(frames, tuning);
  return frames;
};
