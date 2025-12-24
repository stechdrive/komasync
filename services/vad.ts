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

export const getVadTuning = (preset: VadPreset, stability01: number, thresholdScale = 1): VadTuning => {
  const stability = clamp(stability01, 0, 1);
  const thresholdGain = clamp(thresholdScale, 0.5, 1.5);

  const baseThreshold = (() => {
    switch (preset) {
      case 'quiet':
        return 0.035;
      case 'noisy':
        return 0.08;
      case 'normal':
      default:
        return 0.05;
    }
  })();

  const startThreshold = clamp(baseThreshold * (1 - 0.4 * stability) * thresholdGain, 0.005, 0.5);
  const hysteresisRatio = clamp(0.85 - 0.25 * stability, 0.55, 0.9);
  const endThreshold = startThreshold * hysteresisRatio;
  const holdFrames = Math.round(2 + 10 * stability);
  const aggressiveness = (() => {
    switch (preset) {
      case 'quiet':
        return 1;
      case 'noisy':
        return 3;
      case 'normal':
      default:
        return 2;
    }
  })();
  const speechRatio = 0.5;

  const probabilityBase = (() => {
    switch (preset) {
      case 'quiet':
        return 0.35;
      case 'noisy':
        return 0.65;
      case 'normal':
      default:
        return 0.5;
    }
  })();
  const probabilityHysteresis = clamp(0.8 - 0.2 * stability, 0.5, 0.9);

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

  return frames;
};
