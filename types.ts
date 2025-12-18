
export interface FrameData {
  frameIndex: number;
  time: number;
  volume: number;
  isSpeech: boolean;
}

export interface SheetConfig {
  fps: number;
  secondsPerColumn: number;
  columnsPerSheet: number;
}

export enum RecordingState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PROCESSING = 'PROCESSING',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
}

export interface TranscriptSegment {
  text: string;
  start?: string;
  end?: string;
}

export interface Track {
  id: string;
  name: string;
  color: string;     // Tailwind color class prefix (e.g. 'blue', 'red')
  audioBuffer: AudioBuffer | null;
  frames: FrameData[];
  isVisible: boolean;
  isMuted: boolean;
}
