import { FrameData } from '@/types';

export type VadAutoTuning = {
  thresholdScale: number;
  stability: number;
};

type TrackStats = {
  totalFrames: number;
  speechFrames: number;
  lowVolumeSpeechRatio: number;
  speechRatio: number;
  shortGapRatio: number;
  avgSpeechRun: number;
  avgGapRun: number;
  gapRuns: number;
  speechRuns: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
};

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const computeTrackStats = (frames: FrameData[]): TrackStats => {
  const totalFrames = frames.length;
  if (totalFrames === 0) {
    return {
      totalFrames: 0,
      speechFrames: 0,
      lowVolumeSpeechRatio: 0,
      speechRatio: 0,
      shortGapRatio: 0,
      avgSpeechRun: 0,
      avgGapRun: 0,
      gapRuns: 0,
      speechRuns: 0,
    };
  }

  const volumes = frames.map((frame) => frame.volume ?? 0);
  const noiseFloor = quantile(volumes, 0.2);
  const lowVolumeThreshold = Math.max(noiseFloor * 1.4, noiseFloor + 0.0005);

  let speechFrames = 0;
  let lowVolumeSpeech = 0;
  const speechRuns: number[] = [];
  const gapRuns: number[] = [];
  let currentRun = 0;
  let isSpeechRun = frames[0]?.isSpeech ?? false;

  for (const frame of frames) {
    if (frame.isSpeech) {
      speechFrames += 1;
      if (frame.volume <= lowVolumeThreshold) lowVolumeSpeech += 1;
    }

    if (frame.isSpeech === isSpeechRun) {
      currentRun += 1;
    } else {
      if (isSpeechRun) {
        speechRuns.push(currentRun);
      } else {
        gapRuns.push(currentRun);
      }
      isSpeechRun = frame.isSpeech;
      currentRun = 1;
    }
  }

  if (currentRun > 0) {
    if (isSpeechRun) {
      speechRuns.push(currentRun);
    } else {
      gapRuns.push(currentRun);
    }
  }

  const speechRatio = speechFrames / totalFrames;
  const lowVolumeSpeechRatio = speechFrames > 0 ? lowVolumeSpeech / speechFrames : 0;
  const shortGapRatio = gapRuns.length > 0 ? gapRuns.filter((gap) => gap <= 3).length / gapRuns.length : 0;

  return {
    totalFrames,
    speechFrames,
    lowVolumeSpeechRatio,
    speechRatio,
    shortGapRatio,
    avgSpeechRun: average(speechRuns),
    avgGapRun: average(gapRuns),
    gapRuns: gapRuns.length,
    speechRuns: speechRuns.length,
  };
};

export const computeVadAutoTuning = (
  tracksFrames: FrameData[][],
  fps: number,
  minFrames = 6
): VadAutoTuning => {
  const statsList = tracksFrames.map((frames) => computeTrackStats(frames)).filter((stats) => stats.totalFrames > 0);
  const totalFrames = statsList.reduce((sum, stats) => sum + stats.totalFrames, 0);

  if (totalFrames < minFrames) {
    return { thresholdScale: 1, stability: 0.4 };
  }

  const totalSpeechFrames = statsList.reduce((sum, stats) => sum + stats.speechFrames, 0);
  const totalGapRuns = statsList.reduce((sum, stats) => sum + stats.gapRuns, 0);
  const totalSpeechRuns = statsList.reduce((sum, stats) => sum + stats.speechRuns, 0);

  const speechRatio = totalSpeechFrames > 0 ? totalSpeechFrames / totalFrames : 0;
  const lowVolumeSpeechRatio =
    totalSpeechFrames > 0
      ? statsList.reduce((sum, stats) => sum + stats.lowVolumeSpeechRatio * stats.speechFrames, 0) / totalSpeechFrames
      : 0;
  const shortGapRatio =
    totalGapRuns > 0 ? statsList.reduce((sum, stats) => sum + stats.shortGapRatio * stats.gapRuns, 0) / totalGapRuns : 0;
  const avgSpeechRun =
    totalSpeechRuns > 0
      ? statsList.reduce((sum, stats) => sum + stats.avgSpeechRun * stats.speechRuns, 0) / totalSpeechRuns
      : 0;
  const avgGapRun =
    totalGapRuns > 0 ? statsList.reduce((sum, stats) => sum + stats.avgGapRun * stats.gapRuns, 0) / totalGapRuns : 0;

  let thresholdScale = 1;
  let stability = 0.4;

  // 誤検出が多そうなら感度を下げ、保持を弱める。
  if (lowVolumeSpeechRatio > 0.3) {
    thresholdScale += 0.15;
    stability -= 0.1;
  } else if (lowVolumeSpeechRatio > 0.2) {
    thresholdScale += 0.1;
    stability -= 0.05;
  }

  if (speechRatio > 0.6) thresholdScale += 0.1;
  if (speechRatio < 0.05) thresholdScale -= 0.1;

  // 短い途切れが多い場合は保持を強める。
  if (shortGapRatio > 0.5) stability += 0.1;
  if (avgGapRun > 0 && avgGapRun < Math.max(1, Math.round(fps * 0.1))) stability += 0.05;

  // 長いセリフが続きすぎる場合は保持を弱める。
  if (avgSpeechRun > fps * 6 && lowVolumeSpeechRatio > 0.2) stability -= 0.05;

  return {
    thresholdScale: clamp(thresholdScale, 0.7, 1.4),
    stability: clamp(stability, 0.1, 0.7),
  };
};
