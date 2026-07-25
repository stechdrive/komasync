import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Pause, Play } from 'lucide-react';
import { blobToAudioBuffer } from './services/audioProcessor';
import {
  clearAudioRangesWithSilence,
  deleteAudioRangeRipple,
  extractAudioRangesPadded,
  frameToSampleIndex,
  insertAudioAtFrame,
  insertSilenceFramesAtFrame,
  overwriteAudioAtFrame,
} from './services/audioEdit';
import {
  clearFrameRanges,
  createSilentFrames,
  deleteFrameRangeRipple,
  extractFrameRangesPadded,
  insertFramesAtFrame,
  overwriteFramesAtFrame,
} from './services/frameEdit';
import { exportTracksToZip } from './services/audioExporter';
import { getVadTuning, VadPreset, VadTuning } from './services/vad';
import {
  analyzeAudioBufferWithSileroVadEngine,
  getSileroVadError,
  getSileroVadStatus,
  subscribeSileroVadError,
  subscribeSileroVadStatus,
} from './services/sileroVadEngine';
import type { SileroVadError, SileroVadStatus } from './services/sileroVadEngine';
import { exportSheetImagesToZip } from './services/sheetImageExporter';
import { computeVadAutoTuning } from './services/vadAutoTuner';
import {
  applyOverrideRange,
  applyOverrideRanges,
  clearOverrideRanges,
  createSpeechOverrides,
  deleteOverrideRange,
  extractOverrideRanges,
  insertOverrideRange,
  overwriteOverrideRange,
  resizeSpeechOverrides,
} from './services/speechLabels';
import { TimesheetViewport } from './components/TimesheetViewport';
import { HelpSheet } from './components/HelpSheet';
import { TrackMuteMenu } from './components/TrackMuteMenu';
import { AppShell } from './components/AppShell';
import { EditPalette } from './components/EditPalette';
import { MoreSheet } from './components/MoreSheet';
import { TopBar } from './components/TopBar';
import { TransportDock } from './components/TransportDock';
import { useViewportHeight } from './hooks/useViewportHeight';
import { FrameData, InputTestState, RecordingState, Track } from './types';
import { ClipboardClip, EditTarget, SelectionRange, SelectionRanges } from './domain/editTypes';
import { DEFAULT_FPS, getFramesPerColumn, getFramesPerSheet } from './domain/timesheet';
import { formatTimecode, formatTimecodeOneBased } from './domain/timecode';
import { createI18n, getInitialLanguage, type Language } from './domain/i18n';

const FPS = DEFAULT_FPS;
const FRAMES_PER_COLUMN = getFramesPerColumn(FPS);
const SCRUB_FADE_SEC = 0.005;
const SCRUB_THROTTLE_MS = 50;
const SCRUB_STATE_RESET_MS = 200;
const MIC_SLEEP_MS = 5 * 60 * 1000;
const MIC_SLEEP_CHECK_MS = 15 * 1000;
const MIN_SHEET_ZOOM = 1;
const MAX_SHEET_ZOOM = 3;
const SHEET_ZOOM_STEP = 0.1;
const AUTO_VAD_BASE_THRESHOLD_SCALE = 1;
const AUTO_VAD_BASE_STABILITY = 0.4;
const MIN_AUTO_TUNE_FRAMES = 6;
// 末尾側に余白列を確保して、終了後の選択/貼り付けを行えるようにする
const VIRTUAL_TAIL_COLUMNS = 1;
const MIN_INPUT_GAIN_DB = -18;
const MAX_INPUT_GAIN_DB = 18;
const INPUT_TEST_DURATION_MS = 5200;
const INPUT_TEST_IGNORE_MS = 700;
const INPUT_TEST_MIN_SPEECH_RATIO = 0.12;
const INPUT_TEST_TARGET_PEAK_DB = -6;
const INPUT_TEST_MIN_RMS = 0.008;
const INPUT_TEST_UI_UPDATE_MS = 120;
const MOBILE_UI_MAX_WIDTH = 900;
const MOBILE_COMPACT_MAX_WIDTH = 760;
const MOBILE_TIGHT_MAX_WIDTH = 430;

const getViewportWidth = (): number => {
  if (typeof window === 'undefined') return 0;
  const visualWidth = window.visualViewport?.width;
  if (typeof visualWidth === 'number' && visualWidth > 0) {
    return visualWidth;
  }
  return window.innerWidth;
};

/** screen.width が viewport より大幅に小さい場合は物理画面幅を返す（Android 表示スケーリング対策） */
const getBreakpointWidth = (): number => {
  const vpWidth = getViewportWidth();
  if (typeof window === 'undefined') return vpWidth;
  const screenWidth = window.screen?.width;
  if (typeof screenWidth === 'number' && screenWidth > 0 && screenWidth < vpWidth * 0.8) {
    return screenWidth;
  }
  return vpWidth;
};

const UI_SCALE_KEY = 'komasync-ui-scale';

const getAutoUiScale = (): number => {
  if (typeof window === 'undefined') return 1;
  const vp = getViewportWidth();
  const sw = window.screen?.width;
  if (typeof sw === 'number' && sw > 0 && vp > sw * 1.3) {
    // Android 表示スケーリング: viewport が screen より大幅に広い
    return Math.min(Math.round((vp / sw) * 0.85 * 20) / 20, 1.5);
  }
  // 通常のモバイル端末（iPhone 等）: コントロールを小さめにしてタイムシート領域を広く取る
  return 0.75;
};

const loadUiScale = (): number => {
  try {
    const stored = localStorage.getItem(UI_SCALE_KEY);
    if (stored !== null) {
      const v = parseFloat(stored);
      if (Number.isFinite(v) && v >= 0.75 && v <= 1.5) return Math.round(v * 20) / 20;
    }
  } catch { /* ignore */ }
  return getAutoUiScale();
};

const dbToGain = (db: number): number => Math.pow(10, db / 20);
const gainToDb = (gain: number): number => 20 * Math.log10(Math.max(gain, 1e-8));
// ブラウザ側の音声処理が原因で音切れするケースがあるため、可能なら無効化を要求する
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
    channelCount: { ideal: 1 },
  },
};

const clampSheetZoom = (value: number): number => Math.min(MAX_SHEET_ZOOM, Math.max(MIN_SHEET_ZOOM, value));
const normalizeSheetZoom = (value: number): number => Math.round(clampSheetZoom(value) * 100) / 100;
const clampInputGainDb = (value: number): number => Math.min(MAX_INPUT_GAIN_DB, Math.max(MIN_INPUT_GAIN_DB, value));
const WAVEFORM_REFERENCE_QUANTILE = 0.98;

// Use a factory function to ensure fresh references on reset
const createInitialTracks = (): Track[] => [
  {
    id: '1',
    name: 'Track 1',
    color: 'blue',
    audioBuffer: null,
    frames: [],
    waveformReferenceMax: 0,
    speechOverrides: [],
    isVisible: true,
    isMuted: false,
  },
  {
    id: '2',
    name: 'Track 2',
    color: 'red',
    audioBuffer: null,
    frames: [],
    waveformReferenceMax: 0,
    speechOverrides: [],
    isVisible: true,
    isMuted: false,
  },
  {
    id: '3',
    name: 'Track 3',
    color: 'green',
    audioBuffer: null,
    frames: [],
    waveformReferenceMax: 0,
    speechOverrides: [],
    isVisible: true,
    isMuted: false,
  },
];

type HistoryEntry =
  | { kind: 'tracks'; tracks: Track[] }
  | { kind: 'vadThreshold'; value: number };

const getSupportedMimeType = (): string | undefined => {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/aac'
  ];
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return undefined;
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const getAudioContextClass = (): typeof AudioContext => {
  const audioContextClass = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!audioContextClass) {
    throw new Error('AudioContext is not supported');
  }
  return audioContextClass;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
};

const getErrorName = (error: unknown): string => {
  if (error instanceof Error && error.name) return error.name;
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
};

const normalizeSelectionRange = (range: SelectionRange): SelectionRange => {
  const startFrame = Math.max(0, Math.floor(Math.min(range.startFrame, range.endFrame)));
  const endFrame = Math.max(startFrame, Math.floor(Math.max(range.startFrame, range.endFrame)));
  return { startFrame, endFrame };
};

const mergeSelectionRanges = (ranges: SelectionRanges): SelectionRanges => {
  if (ranges.length === 0) return [];
  const normalized = ranges
    .map(normalizeSelectionRange)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);

  const merged: SelectionRanges = [normalized[0]];
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

const areSelectionRangesEqual = (a: SelectionRanges, b: SelectionRanges): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.startFrame !== b[i]?.startFrame) return false;
    if (a[i]?.endFrame !== b[i]?.endFrame) return false;
  }
  return true;
};

export default function App() {
  const [mobileInteractionMode, setMobileInteractionMode] = useState<'navigate' | 'select'>('navigate');
  const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const { t, list: tList } = useMemo(() => createI18n(language), [language]);
  
  // Multi-track State
  const [tracks, setTracks] = useState<Track[]>(createInitialTracks());
  const [recordTrackId, setRecordTrackId] = useState<string>('1');
  const [editTarget, setEditTarget] = useState<EditTarget>('1');

  // History State for Undo/Redo
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);

  // Clipboard State
  const [clipboardClip, setClipboardClip] = useState<ClipboardClip | null>(null);
  const [muteMenu, setMuteMenu] = useState<{ x: number; y: number } | null>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [vadPreset, setVadPreset] = useState<VadPreset>('quiet');
  const [vadStability, setVadStability] = useState(AUTO_VAD_BASE_STABILITY);
  const [vadThresholdScale, setVadThresholdScale] = useState(AUTO_VAD_BASE_THRESHOLD_SCALE);
  const [isVadAuto, setIsVadAuto] = useState(true);
  const [playWhileRecording, setPlayWhileRecording] = useState(true);
  const [inputGainDb, setInputGainDb] = useState(0);
  const [isLimiterEnabled, setIsLimiterEnabled] = useState(true);
  const [inputTestState, setInputTestState] = useState<InputTestState>({
    status: 'idle',
    progress: 0,
    message: '',
  });
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
  const [isMicPreparing, setIsMicPreparing] = useState(false);
  const [viewportFirstColumn, setViewportFirstColumn] = useState(0);
  const [sheetZoom, setSheetZoom] = useState(1);
  const [vadEngineStatus, setVadEngineStatus] = useState<SileroVadStatus>(() => getSileroVadStatus());
  const [vadEngineError, setVadEngineError] = useState<SileroVadError>(() => getSileroVadError());
  const [mobileViewportWidth, setMobileViewportWidth] = useState(() =>
    getViewportWidth()
  );
  const [isCoarsePointer, setIsCoarsePointer] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  );
  const [topBarWidth, setTopBarWidth] = useState(0);
  const [uiScale, setUiScaleRaw] = useState(loadUiScale);
  const showDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  
  // Selection State
  const [selection, setSelection] = useState<SelectionRanges>([]);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);
  const selectionRef = useRef<SelectionRanges>([]);
  const selectionStateRef = useRef<SelectionRanges>([]);
  const selectionPendingRef = useRef<SelectionRanges | undefined>(undefined);
  const selectionScrubPendingRef = useRef<{ frame: number; trackId: string } | null>(null);
  const selectionScrubLastRef = useRef<{ frame: number; trackId: string } | null>(null);
  const selectionRafRef = useRef<number | null>(null);
  const maxFramesRef = useRef(0);
  const virtualMaxFramesRef = useRef(0);
  const [virtualMaxFrames, setVirtualMaxFrames] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const limiterNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const recordingGraphCleanupRef = useRef<(() => void) | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartFrameRef = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micPreparePromiseRef = useRef<Promise<MediaStream> | null>(null);
  const pendingRecordStartRef = useRef(false);
  const lastSingleTrackIdRef = useRef<string>('1');
  const currentFrameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const inputRmsRef = useRef(0);
  const autoMicWarmupRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const recordingStateRef = useRef(recordingState);
  const isMicReadyRef = useRef(isMicReady);
  const isMicPreparingRef = useRef(isMicPreparing);
  const vadThresholdHistoryRef = useRef<{ startValue: number } | null>(null);
  const vadThresholdCommitTimerRef = useRef<number | null>(null);
  const inputTestAbortRef = useRef<AbortController | null>(null);

  const vuAnalyserRef = useRef<AnalyserNode | null>(null);
  const vuSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vuAnimationFrameRef = useRef<number>(0);
  
  // Store source nodes for each track for mixed playback
  const sourceNodesRef = useRef<Map<string, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map());
  const scrubNodesRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode; endTime: number }[]>([]);
  const scrubLastTimeRef = useRef(0);
  const scrubFramePendingRef = useRef<number | null>(null);
  const scrubFrameLastRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const scrubStateResetRef = useRef<number | null>(null);
  
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

  useViewportHeight();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewportWidth = () => {
      setMobileViewportWidth(getViewportWidth());
    };

    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    window.visualViewport?.addEventListener('resize', updateViewportWidth);

    if (typeof window.matchMedia !== 'function') {
      return () => {
        window.removeEventListener('resize', updateViewportWidth);
        window.visualViewport?.removeEventListener('resize', updateViewportWidth);
      };
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const updatePointer = () => setIsCoarsePointer(mediaQuery.matches);
    updatePointer();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updatePointer);
      return () => {
        window.removeEventListener('resize', updateViewportWidth);
        window.visualViewport?.removeEventListener('resize', updateViewportWidth);
        mediaQuery.removeEventListener('change', updatePointer);
      };
    }

    mediaQuery.addListener(updatePointer);
    return () => {
      window.removeEventListener('resize', updateViewportWidth);
      window.visualViewport?.removeEventListener('resize', updateViewportWidth);
      mediaQuery.removeListener(updatePointer);
    };
  }, []);

  const startScrubState = useCallback((autoResetMs?: number) => {
    if (scrubStateResetRef.current !== null) {
      window.clearTimeout(scrubStateResetRef.current);
      scrubStateResetRef.current = null;
    }
    setIsScrubbing(true);
    if (autoResetMs && autoResetMs > 0) {
      scrubStateResetRef.current = window.setTimeout(() => {
        scrubStateResetRef.current = null;
        setIsScrubbing(false);
      }, autoResetMs);
    }
  }, []);

  const stopScrubState = useCallback(() => {
    if (scrubStateResetRef.current !== null) {
      window.clearTimeout(scrubStateResetRef.current);
      scrubStateResetRef.current = null;
    }
    setIsScrubbing(false);
  }, []);

  useEffect(() => {
    return () => {
      if (scrubStateResetRef.current !== null) {
        window.clearTimeout(scrubStateResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scrubRafRef.current !== null) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (selection.length === 0) {
      setSelectionMenu(null);
    }
  }, [selection]);

  useEffect(() => {
    selectionRef.current = selection;
    selectionStateRef.current = selection;
  }, [selection]);

  useEffect(() => {
    return () => {
      if (selectionRafRef.current !== null) {
        cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      inputTestAbortRef.current?.abort();
    };
  }, []);

  // Stats (Calculate total max duration across all tracks)
  const maxFrames = Math.max(0, ...tracks.map(t => t.frames.length));

  useEffect(() => {
    maxFramesRef.current = maxFrames;
    const baseFrame = Math.max(0, Math.floor(currentFrame));
    const columnIndex = Math.floor(baseFrame / FRAMES_PER_COLUMN);
    const required = Math.max(
      maxFrames,
      (columnIndex + 1 + VIRTUAL_TAIL_COLUMNS) * FRAMES_PER_COLUMN
    );
    if (required !== virtualMaxFramesRef.current) {
      virtualMaxFramesRef.current = required;
      setVirtualMaxFrames(required);
    }
  }, [currentFrame, maxFrames]);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  const commitCurrentFrame = useCallback(
    (nextFrame: number) => {
      const clampedFrame = Math.max(0, Math.floor(nextFrame));
      currentFrameRef.current = clampedFrame;
      setCurrentFrame(clampedFrame);
    },
    []
  );

  const commitSelectionState = useCallback((ranges: SelectionRanges) => {
    const normalized = mergeSelectionRanges(ranges);
    const prev = selectionStateRef.current;
    selectionStateRef.current = normalized;
    selectionRef.current = normalized;
    if (areSelectionRangesEqual(prev, normalized)) return;
    setSelection(normalized);
  }, []);

  const clearSelectionImmediate = useCallback(() => {
    if (selectionRafRef.current !== null) {
      cancelAnimationFrame(selectionRafRef.current);
      selectionRafRef.current = null;
    }
    selectionPendingRef.current = undefined;
    selectionScrubPendingRef.current = null;
    selectionScrubLastRef.current = null;
    commitSelectionState([]);
    setSelectionMenu(null);
  }, [commitSelectionState]);

  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleLanguageChange = () => {
      setLanguage(getInitialLanguage());
    };
    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, []);

  useEffect(() => {
    const node = gainNodeRef.current;
    const ctx = audioContextRef.current;
    if (!node || !ctx) return;
    const nextGain = dbToGain(clampInputGainDb(inputGainDb));
    node.gain.setTargetAtTime(nextGain, ctx.currentTime, 0.01);
  }, [inputGainDb]);

  useEffect(() => {
    isMicReadyRef.current = isMicReady;
  }, [isMicReady]);

  useEffect(() => {
    isMicPreparingRef.current = isMicPreparing;
  }, [isMicPreparing]);

  useEffect(() => {
    return subscribeSileroVadStatus((status) => {
      setVadEngineStatus(status);
    });
  }, []);

  useEffect(() => {
    return subscribeSileroVadError((error) => {
      setVadEngineError(error);
    });
  }, []);

  const applyVadAutoTuningFromFrames = useCallback((_framesList: FrameData[][]) => {
    // Auto-tuning は無効化: Silero v6 公式推奨パラメータをそのまま使う。
    // thresholdScale / stability を録音ごとに書き換えると判定がブレるため、
    // 固定値（thresholdScale=1, stability=0.4）で運用する。
  }, []);

  const getFrameCountFromBuffer = useCallback((audioBuffer: AudioBuffer | null): number => {
    if (!audioBuffer) return 0;
    return Math.round((audioBuffer.length * FPS) / audioBuffer.sampleRate);
  }, []);

  const createSpeechOverridesForBuffer = useCallback(
    (audioBuffer: AudioBuffer | null): number[] => createSpeechOverrides(getFrameCountFromBuffer(audioBuffer)),
    [getFrameCountFromBuffer]
  );

  const getWaveformReferenceMax = useCallback((frames: FrameData[]): number => {
    // 編集後に残った区間だけで波形が急に肥大化しないよう、録音全体の代表値を保持する。
    const volumes = frames
      .map((frame) => frame.volume ?? 0)
      .filter((volume) => volume > 0)
      .sort((a, b) => a - b);
    if (volumes.length === 0) return 0;
    const index = Math.min(volumes.length - 1, Math.floor((volumes.length - 1) * WAVEFORM_REFERENCE_QUANTILE));
    return volumes[index] ?? volumes[volumes.length - 1] ?? 0;
  }, []);

  const analyzeVadFrames = useCallback(
    async (trackId: string, audioBuffer: AudioBuffer, tuning: VadTuning): Promise<FrameData[]> => {
      const { frames, debug } = await analyzeAudioBufferWithSileroVadEngine(audioBuffer, FPS, tuning);
      if (import.meta.env.DEV) {
        const total = frames.length;
        let speechCount = 0;
        let maxVolume = 0;
        let maxSpeechRun = 0;
        let currentRun = 0;
        frames.forEach((frame) => {
          if (frame.volume > maxVolume) maxVolume = frame.volume;
          if (frame.isSpeech) {
            speechCount += 1;
            currentRun += 1;
            if (currentRun > maxSpeechRun) maxSpeechRun = currentRun;
          } else {
            currentRun = 0;
          }
        });
        const ratio = total > 0 ? speechCount / total : 0;
        const status = getSileroVadStatus();
        console.info(
          `[VAD] track=${trackId} total=${total} speech=${speechCount} ratio=${ratio.toFixed(3)} maxVol=${maxVolume.toFixed(5)} maxRun=${maxSpeechRun} status=${status}`
        );
        if (typeof window !== 'undefined') {
          const debugTarget = window as Window & {
            __vadDebug?: Record<
              string,
              {
                frames: FrameData[];
                summary: {
                  total: number;
                  speechCount: number;
                  ratio: number;
                  maxVolume: number;
                  maxSpeechRun: number;
                  status: string;
                };
                workerDebug?: unknown;
              }
            >;
          };
          if (!debugTarget.__vadDebug) debugTarget.__vadDebug = {};
          debugTarget.__vadDebug[trackId] = {
            frames,
            summary: {
              total,
              speechCount,
              ratio,
              maxVolume,
              maxSpeechRun,
              status,
            },
            workerDebug: debug,
          };
        }
      }
      return frames;
    },
    []
  );

  // --- History Management ---
  const HISTORY_LIMIT = 30;

  const pushHistoryEntry = useCallback((entry: HistoryEntry) => {
    setHistoryPast(prev => [...prev.slice(-(HISTORY_LIMIT - 1)), entry]);
    setHistoryFuture([]); // Clear future on new action
  }, []);

  const clearVadThresholdCommitTimer = () => {
    if (vadThresholdCommitTimerRef.current !== null) {
      window.clearTimeout(vadThresholdCommitTimerRef.current);
      vadThresholdCommitTimerRef.current = null;
    }
  };

  const commitVadThresholdHistory = useCallback(() => {
    clearVadThresholdCommitTimer();
    const snapshot = vadThresholdHistoryRef.current;
    if (!snapshot) return;
    vadThresholdHistoryRef.current = null;
    if (snapshot.startValue !== vadThresholdScale) {
      pushHistoryEntry({ kind: 'vadThreshold', value: snapshot.startValue });
    }
  }, [pushHistoryEntry, vadThresholdScale]);

  const scheduleVadThresholdCommit = useCallback(() => {
    clearVadThresholdCommitTimer();
    vadThresholdCommitTimerRef.current = window.setTimeout(() => {
      commitVadThresholdHistory();
    }, 300);
  }, [commitVadThresholdHistory]);

  useEffect(() => {
    return () => {
      clearVadThresholdCommitTimer();
    };
  }, []);

  const handleVadThresholdScaleChange = useCallback((nextScale: number) => {
    if (isVadAuto) return;
    if (!vadThresholdHistoryRef.current) {
      vadThresholdHistoryRef.current = { startValue: vadThresholdScale };
    }
    setVadThresholdScale(nextScale);
    scheduleVadThresholdCommit();
  }, [isVadAuto, scheduleVadThresholdCommit, vadThresholdScale]);

  const handleVadStabilityChange = useCallback((nextValue: number) => {
    if (isVadAuto) return;
    setVadStability(nextValue);
  }, [isVadAuto]);

  const handleToggleVadAuto = useCallback((nextValue: boolean) => {
    setIsVadAuto(nextValue);
    if (nextValue) {
      clearVadThresholdCommitTimer();
      vadThresholdHistoryRef.current = null;
      setVadThresholdScale(AUTO_VAD_BASE_THRESHOLD_SCALE);
      setVadStability(AUTO_VAD_BASE_STABILITY);
    }
  }, []);

  const saveToHistory = useCallback(() => {
    commitVadThresholdHistory();
    pushHistoryEntry({ kind: 'tracks', tracks });
  }, [commitVadThresholdHistory, pushHistoryEntry, tracks]);

  const handleUndo = useCallback(() => {
    if (historyPast.length === 0) return;
    
    const previous = historyPast[historyPast.length - 1];
    const newPast = historyPast.slice(0, -1);
    
    const futureEntry: HistoryEntry =
      previous.kind === 'tracks'
        ? { kind: 'tracks', tracks }
        : { kind: 'vadThreshold', value: vadThresholdScale };

    setHistoryFuture(prev => [futureEntry, ...prev]);
    if (previous.kind === 'tracks') {
      setTracks(previous.tracks);
      // Reset selection to avoid ghost selections
      clearSelectionImmediate();
    } else {
      setVadThresholdScale(previous.value);
    }
    setHistoryPast(newPast);
  }, [
    clearSelectionImmediate,
    historyPast,
    tracks,
    vadThresholdScale,
  ]);

  const handleRedo = useCallback(() => {
    if (historyFuture.length === 0) return;

    const next = historyFuture[0];
    const newFuture = historyFuture.slice(1);

    const pastEntry: HistoryEntry =
      next.kind === 'tracks'
        ? { kind: 'tracks', tracks }
        : { kind: 'vadThreshold', value: vadThresholdScale };

    setHistoryPast(prev => [...prev, pastEntry]);
    if (next.kind === 'tracks') {
      setTracks(next.tracks);
      clearSelectionImmediate();
    } else {
      setVadThresholdScale(next.value);
    }
    setHistoryFuture(newFuture);
  }, [
    clearSelectionImmediate,
    historyFuture,
    tracks,
    vadThresholdScale,
  ]);

  const handleResetProject = () => {
    if (window.confirm(t('app.confirmReset'))) {
        // Stop playback/recording first
        stopAllSources();
        stopScrubSources();
        stopVuMeter();
        stopMicStream();
        cancelAnimationFrame(animationFrameRef.current);
        // Reset all states
        setTracks(createInitialTracks());
        setHistoryPast([]);
        setHistoryFuture([]);
        setRecordTrackId('1');
        setEditTarget('1');
        lastSingleTrackIdRef.current = '1';
        commitCurrentFrame(0);
        clearSelectionImmediate();
        setClipboardClip(null);
        setRecordingState(RecordingState.IDLE);
        recordingStartFrameRef.current = 0;
        recordingStartTimeRef.current = 0;
        isScrubbingRef.current = false;
        stopScrubState();
    }
  };

  const handleExportAudio = async () => {
    try {
        await exportTracksToZip(tracks);
    } catch (error: unknown) {
        const message = getErrorMessage(error) || t('app.exportAudioFailed');
        alert(message);
        console.error(error);
    }
  };

  const handleExportSheetImagesCurrent = async () => {
    try {
      const sheetIndex = Math.max(0, Math.floor(viewportFirstColumn / 2));
      await exportSheetImagesToZip(tracks, FPS, { type: 'sheet', sheetIndex });
    } catch (error: unknown) {
      const message = getErrorMessage(error) || t('app.exportSheetFailed');
      alert(message);
      console.error(error);
    }
  };

  const handleExportSheetImagesAll = async () => {
    try {
      await exportSheetImagesToZip(tracks, FPS, { type: 'all' });
    } catch (error: unknown) {
      const message = getErrorMessage(error) || t('app.exportSheetFailed');
      alert(message);
      console.error(error);
    }
  };
  
  const handleBackgroundClick = () => {
    clearSelectionImmediate();
  };

  const handleOpenMuteMenu = useCallback((point: { x: number; y: number }) => {
    setMuteMenu(point);
  }, []);

  const handleCloseMuteMenu = useCallback(() => {
    setMuteMenu(null);
  }, []);


  const updateTrack = (trackId: string, updates: Partial<Track>) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t));
  };

  const toggleTrackMute = (trackId: string) => {
    const currentMuted = tracks.find((track) => track.id === trackId)?.isMuted ?? false;
    const nextMuted = !currentMuted;

    if (recordingState === RecordingState.PLAYING || recordingState === RecordingState.RECORDING) {
      const node = sourceNodesRef.current.get(trackId);
      if (node) {
        const ctxTime = audioContextRef.current?.currentTime ?? 0;
        node.gain.gain.setValueAtTime(nextMuted ? 0 : 1, ctxTime);
      }
    }

    setTracks((prev) =>
      prev.map((track) => (track.id === trackId ? { ...track, isMuted: !track.isMuted } : track))
    );
  };

  const stopAllSources = useCallback(() => {
    sourceNodesRef.current.forEach(({ source, gain }) => {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    });
    sourceNodesRef.current.clear();
  }, []);

  const stopPlaybackLoop = useCallback(() => {
    stopAllSources();
    cancelAnimationFrame(animationFrameRef.current);
  }, [stopAllSources]);

  const handlePause = useCallback(() => {
    stopPlaybackLoop();
    setRecordingState(RecordingState.PAUSED);
  }, [stopPlaybackLoop]);

  const stopScrubSources = useCallback((immediate = false) => {
    const nodes = scrubNodesRef.current;
    scrubNodesRef.current = [];
    const ctx = audioContextRef.current;

    nodes.forEach(({ source, gain, endTime }) => {
      if (!immediate && ctx?.state === 'running') {
        const nowTime = ctx.currentTime;
        const stopTime = Math.min(endTime, nowTime + SCRUB_FADE_SEC);
        try {
          if (stopTime <= nowTime) {
            source.stop();
            return;
          }
          if (typeof gain.gain.cancelAndHoldAtTime === 'function') {
            gain.gain.cancelAndHoldAtTime(nowTime);
          } else {
            const currentGain = gain.gain.value;
            gain.gain.cancelScheduledValues(nowTime);
            gain.gain.setValueAtTime(currentGain, nowTime);
          }
          gain.gain.linearRampToValueAtTime(0, stopTime);
          source.stop(stopTime);
          return;
        } catch {
          // 即時停止へフォールバックする
        }
      }

      try {
        source.stop();
      } catch {
        // no-op
      }
      try {
        source.disconnect();
      } catch {
        // no-op
      }
      try {
        gain.disconnect();
      } catch {
        // no-op
      }
    });
  }, []);

  const playScrubPreview = useCallback((frame: number, trackId?: string) => {
    const now = performance.now();
    if (now - scrubLastTimeRef.current < SCRUB_THROTTLE_MS) return;
    scrubLastTimeRef.current = now;

    const audibleTracks = trackId
      ? tracks.filter((track) => track.id === trackId && track.audioBuffer && !track.isMuted)
      : tracks.filter((track) => track.audioBuffer && !track.isMuted);
    if (audibleTracks.length === 0) {
      stopScrubSources();
      return;
    }

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioContextClass = getAudioContextClass();
      audioContextRef.current = new AudioContextClass();
    }

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    stopScrubSources();

    const nowTime = ctx.currentTime;
    const safeFrame = Math.max(0, Math.floor(frame));

    audibleTracks.forEach((track) => {
      const buffer = track.audioBuffer;
      if (!buffer) return;

      // フレーム境界をサンプル位置に丸め、隣のフレームを一切含めない
      const startSample = frameToSampleIndex(safeFrame, buffer.sampleRate, FPS);
      const endSampleExclusive = Math.min(
        buffer.length,
        frameToSampleIndex(safeFrame + 1, buffer.sampleRate, FPS)
      );
      if (startSample >= buffer.length || endSampleExclusive <= startSample) return;

      const offset = startSample / buffer.sampleRate;
      const duration = (endSampleExclusive - startSample) / buffer.sampleRate;
      if (duration <= 0) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const fade = Math.min(SCRUB_FADE_SEC, duration / 2);
      const hold = Math.max(0, duration - fade);
      gain.gain.setValueAtTime(0, nowTime);
      gain.gain.linearRampToValueAtTime(1, nowTime + fade);
      gain.gain.setValueAtTime(1, nowTime + hold);
      gain.gain.linearRampToValueAtTime(0, nowTime + duration);

      source.connect(gain);
      gain.connect(ctx.destination);
      const scrubNode = { source, gain, endTime: nowTime + duration };
      source.onended = () => {
        scrubNodesRef.current = scrubNodesRef.current.filter((node) => node.source !== source);
        try {
          source.disconnect();
        } catch {
          // no-op
        }
        try {
          gain.disconnect();
        } catch {
          // no-op
        }
      };
      source.start(nowTime, offset, duration);
      scrubNodesRef.current.push(scrubNode);
    });
  }, [stopScrubSources, tracks]);

  const commitScrubFrame = useCallback(
    (frame: number) => {
      if (scrubFrameLastRef.current === frame) return;
      scrubFrameLastRef.current = frame;
      commitCurrentFrame(frame);
      playScrubPreview(frame);
    },
    [commitCurrentFrame, playScrubPreview]
  );

  const flushScrubFrame = useCallback(
    (forceFrame?: number | null) => {
      if (scrubRafRef.current !== null) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      const frame = forceFrame ?? scrubFramePendingRef.current;
      scrubFramePendingRef.current = null;
      if (frame === null || frame === undefined) return;
      commitScrubFrame(frame);
    },
    [commitScrubFrame]
  );

  const scheduleScrubFrame = useCallback(
    (frame: number) => {
      if (scrubFrameLastRef.current === frame) return;
      scrubFramePendingRef.current = frame;
      if (scrubRafRef.current !== null) return;
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = null;
        const pending = scrubFramePendingRef.current;
        scrubFramePendingRef.current = null;
        if (pending === null || pending === undefined) return;
        commitScrubFrame(pending);
      });
    },
    [commitScrubFrame]
  );

  // Helper to start playback (used by both Play button and Recording start)
  const startPlayback = (startFrame: number, mode: RecordingState) => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const AudioContextClass = getAudioContextClass();
        audioContextRef.current = new AudioContextClass();
    }
    
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    stopAllSources();
    stopScrubSources();

    const offsetTime = startFrame / FPS;
    let maxDuration = 0;

    // Create sources for all tracks
    tracks.forEach(track => {
      if (!track.audioBuffer) return;
      const duration = track.audioBuffer.duration || 0;
      if (duration > maxDuration) maxDuration = duration;

      if (offsetTime < duration) {
        const source = ctx.createBufferSource();
        source.buffer = track.audioBuffer;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(track.isMuted ? 0 : 1, ctx.currentTime);

        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0, offsetTime);
        sourceNodesRef.current.set(track.id, { source, gain });
      }
    });

    startTimeRef.current = ctx.currentTime - offsetTime;
    const expectedEndTime = startTimeRef.current + maxDuration;
    const startFrameIndex = Math.max(0, Math.floor(startFrame));
    currentFrameRef.current = startFrameIndex;
    lastFrameRef.current = startFrameIndex;

    const updateFrame = () => {
      if (!audioContextRef.current) return;
      const currentTime = audioContextRef.current.currentTime;
      const elapsed = currentTime - startTimeRef.current;
      const frame = Math.max(0, Math.floor(elapsed * FPS));
      currentFrameRef.current = frame;
      
      // Auto-stop logic
      // If we are just PLAYING, stop when audio ends.
      // If we are RECORDING, do NOT stop when audio ends (continue until user stops).
      if (mode === RecordingState.PLAYING && currentTime >= expectedEndTime) {
        stopPlaybackLoop();
        const endFrame = Math.max(0, maxFrames - 1);
        lastFrameRef.current = endFrame;
        commitCurrentFrame(endFrame);
        setRecordingState(RecordingState.IDLE);
        return;
      }

      // Update frame if state matches or if we are recording (even if audio finished)
      // Note: We check the ref or current state. Since this is a closure, we need to be careful.
      // However, we'll rely on the animation frame cancellation to stop this loop.
      if (frame !== lastFrameRef.current) {
        lastFrameRef.current = frame;
        commitCurrentFrame(frame);
      }
      animationFrameRef.current = requestAnimationFrame(updateFrame);
    };
    
    animationFrameRef.current = requestAnimationFrame(updateFrame);
  };

  const stopVuMeter = useCallback(() => {
    if (vuAnimationFrameRef.current) {
      cancelAnimationFrame(vuAnimationFrameRef.current);
      vuAnimationFrameRef.current = 0;
    }
    try {
      vuSourceRef.current?.disconnect();
    } catch {
      // no-op
    }
    vuSourceRef.current = null;
    vuAnalyserRef.current = null;
    inputRmsRef.current = 0;
  }, []);

  const startVuMeter = (stream: MediaStream) => {
    stopVuMeter();

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioContextClass = getAudioContextClass();
      audioContextRef.current = new AudioContextClass();
    }
    const ctx = audioContextRef.current;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;

    source.connect(analyser);
    vuSourceRef.current = source;
    vuAnalyserRef.current = analyser;

    const buffer = new Float32Array(analyser.fftSize);
    const tick = () => {
      const node = vuAnalyserRef.current;
      if (!node) return;

      node.getFloatTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) sumSquares += buffer[i] * buffer[i];
      const rms = buffer.length > 0 ? Math.sqrt(sumSquares / buffer.length) : 0;
      inputRmsRef.current = inputRmsRef.current * 0.8 + rms * 0.2;
      vuAnimationFrameRef.current = requestAnimationFrame(tick);
    };

    vuAnimationFrameRef.current = requestAnimationFrame(tick);
  };

  const cleanupRecordingGraph = useCallback(() => {
    if (recordingGraphCleanupRef.current) {
      recordingGraphCleanupRef.current();
      recordingGraphCleanupRef.current = null;
    }
    gainNodeRef.current = null;
    limiterNodeRef.current = null;
  }, []);

  const createRecordingStream = useCallback(
    (stream: MediaStream): { stream: MediaStream; cleanup: () => void } => {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const AudioContextClass = getAudioContextClass();
        audioContextRef.current = new AudioContextClass();
      }
      const ctx = audioContextRef.current;

      const source = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(dbToGain(clampInputGainDb(inputGainDb)), ctx.currentTime);
      source.connect(gainNode);

      let lastNode: AudioNode = gainNode;
      let limiterNode: DynamicsCompressorNode | null = null;
      if (isLimiterEnabled) {
        limiterNode = ctx.createDynamicsCompressor();
        limiterNode.threshold.setValueAtTime(-6, ctx.currentTime);
        limiterNode.knee.setValueAtTime(0, ctx.currentTime);
        limiterNode.ratio.setValueAtTime(12, ctx.currentTime);
        limiterNode.attack.setValueAtTime(0.003, ctx.currentTime);
        limiterNode.release.setValueAtTime(0.25, ctx.currentTime);
        gainNode.connect(limiterNode);
        lastNode = limiterNode;
      }

      const destination = ctx.createMediaStreamDestination();
      lastNode.connect(destination);

      gainNodeRef.current = gainNode;
      limiterNodeRef.current = limiterNode;

      const cleanup = () => {
        try {
          source.disconnect();
        } catch {
          // no-op
        }
        try {
          gainNode.disconnect();
        } catch {
          // no-op
        }
        if (limiterNode) {
          try {
            limiterNode.disconnect();
          } catch {
            // no-op
          }
        }
        try {
          destination.disconnect();
        } catch {
          // no-op
        }
      };

      return { stream: destination.stream, cleanup };
    },
    [inputGainDb, isLimiterEnabled]
  );

  const startRecordingWithStream = async (stream: MediaStream) => {
    // Ensure context is running first for better sync
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioContextClass = getAudioContextClass();
      audioContextRef.current = new AudioContextClass();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    stopScrubSources();
    isScrubbingRef.current = false;
    stopScrubState();

    cleanupRecordingGraph();
    const { stream: recordStream, cleanup } = createRecordingStream(stream);
    recordingGraphCleanupRef.current = cleanup;
    startVuMeter(recordStream);

    const cleanupRecordingResources = () => {
      stopVuMeter();
      stopAllSources();
      cancelAnimationFrame(animationFrameRef.current);
      stopMicStream();
      cleanupRecordingGraph();
      mediaRecorderRef.current = null;
      setRecordingState(RecordingState.IDLE);
    };

    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : undefined;

    try {
      mediaRecorderRef.current = new MediaRecorder(recordStream, options);
    } catch (error) {
      cleanupRecordingResources();
      throw error;
    }
    audioChunksRef.current = [];

    // Mark the frame where recording started (Punch-in support)
    recordingStartFrameRef.current = currentFrameRef.current;
    recordingStartTimeRef.current = Date.now();

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorderRef.current.onstop = async () => {
      // Enforce minimum duration of 200ms to avoid empty/corrupt files on accidental double-click
      const duration = Date.now() - recordingStartTimeRef.current;
      if (duration < 200) {
        console.warn("Recording too short, discarded.");
        stopVuMeter();
        stopAllSources();
        cancelAnimationFrame(animationFrameRef.current);
        cleanupRecordingGraph();
        setRecordingState(RecordingState.IDLE);
        return;
      }

      if (audioChunksRef.current.length === 0 || (audioChunksRef.current.length === 1 && audioChunksRef.current[0].size === 0)) {
        console.warn("Recording was empty.");
        stopVuMeter();
        stopAllSources();
        cancelAnimationFrame(animationFrameRef.current);
        cleanupRecordingGraph();
        setRecordingState(RecordingState.IDLE);
        return;
      }

      const finalMimeType = mediaRecorderRef.current?.mimeType || mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });

      // Pass the start frame to the loader to overwrite at correct position
      await loadAudioBlobToTrack(audioBlob, recordTrackId, recordingStartFrameRef.current);

      stopVuMeter();

      // Also stop playback if it was running
      stopAllSources();
      cancelAnimationFrame(animationFrameRef.current);
      cleanupRecordingGraph();
    };

    mediaRecorderRef.current.onerror = (event) => {
      const err = event.error ?? new Error('MediaRecorderでエラーが発生しました。');
      console.error('MediaRecorder error:', err);
      cleanupRecordingResources();
      alert(t('app.recordingError'));
    };

    // Start Recording
    try {
      mediaRecorderRef.current.start();
    } catch (error) {
      cleanupRecordingResources();
      throw error;
    }
    setRecordingState(RecordingState.RECORDING);

    // Start Playback from CURRENT frame (not 0) if enabled
    if (playWhileRecording) {
      startPlayback(currentFrameRef.current, RecordingState.RECORDING);
    } else {
      // If not playing back, we still need to advance the frame counter for visual feedback
      // Adjust start time relative to current frame
      const offsetTime = currentFrameRef.current / FPS;
      startTimeRef.current = (Date.now() / 1000) - offsetTime;
      lastFrameRef.current = Math.max(0, Math.floor(currentFrameRef.current));

      const updateFrameSimple = () => {
        const elapsed = (Date.now() / 1000) - startTimeRef.current;
        const frame = Math.max(0, Math.floor(elapsed * FPS));
        currentFrameRef.current = frame;
        if (frame !== lastFrameRef.current) {
          lastFrameRef.current = frame;
          commitCurrentFrame(frame);
        }
        animationFrameRef.current = requestAnimationFrame(updateFrameSimple);
      };
      animationFrameRef.current = requestAnimationFrame(updateFrameSimple);
    }
  };

  const handleStartRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(t('app.browserNotSupported'));
      return;
    }
    if (inputTestAbortRef.current) {
      inputTestAbortRef.current.abort();
      inputTestAbortRef.current = null;
      setInputTestState({ status: 'idle', progress: 0, message: t('app.inputTestCanceled') });
    }
    if (recordingState === RecordingState.PLAYING) {
      handlePause();
    }

    try {
      pendingRecordStartRef.current = true;
      const stream = await ensureMicReady();
      if (!pendingRecordStartRef.current) return;
      await startRecordingWithStream(stream);
    } catch (err: unknown) {
      console.error("Error accessing microphone:", err);

      const errorName = getErrorName(err);
      const errorMessage = getErrorMessage(err);
      if (errorName === 'NotFoundError' || errorMessage.includes('device not found')) {
        alert(t('app.micNotFound'));
      } else if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        alert(t('app.micNotAllowed'));
      } else if (errorName === 'NotReadableError') {
        alert(t('app.micNotReadable'));
      } else {
        alert(t('app.startRecordingFailed'));
      }
    } finally {
      pendingRecordStartRef.current = false;
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && recordingState === RecordingState.RECORDING) {
      stopPlaybackLoop();
      stopVuMeter();
      mediaRecorderRef.current.stop();
      // State change to PROCESSING happens in onstop
      setRecordingState(RecordingState.PROCESSING);
    }
  };

  const loadAudioBlobToTrack = async (blob: Blob, trackId: string, insertAtFrame: number = 0) => {
    try {
      if (blob.size === 0) return; // Skip empty

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
         const AudioContextClass = getAudioContextClass();
         audioContextRef.current = new AudioContextClass();
      }

      // 1. Decode new recording
      const newClipBuffer = await blobToAudioBuffer(blob);
      
      // 2. Get existing track
      const track = tracks.find(t => t.id === trackId);
      let finalBuffer = newClipBuffer;

      // 3. If track exists, merge the new clip into the existing buffer
      if (track) {
        if (track.audioBuffer || insertAtFrame > 0) {
          finalBuffer = overwriteAudioAtFrame(track.audioBuffer, newClipBuffer, insertAtFrame, FPS);
        }
      }

      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
      const clipVadFrames = await analyzeVadFrames(trackId, newClipBuffer, tuning);
      const clipFrames = getFrameCountFromBuffer(newClipBuffer);
      const nextOverrides = (() => {
        if (!track || !track.audioBuffer) {
          return createSpeechOverridesForBuffer(finalBuffer);
        }
        const baseOverrides = resizeSpeechOverrides(
          track.speechOverrides,
          getFrameCountFromBuffer(track.audioBuffer)
        );
        const clearedSlice = createSpeechOverrides(clipFrames);
        const overwritten = overwriteOverrideRange(baseOverrides, insertAtFrame, clearedSlice);
        return resizeSpeechOverrides(overwritten, getFrameCountFromBuffer(finalBuffer));
      })();
      const nextFrames = (() => {
        if (!track) {
          return overwriteFramesAtFrame([], clipVadFrames, insertAtFrame, FPS);
        }
        return overwriteFramesAtFrame(track.frames, clipVadFrames, insertAtFrame, FPS);
      })();
      applyVadAutoTuningFromFrames([clipVadFrames]);
      saveToHistory(); // 変更が確定する直前で履歴に保存する
      updateTrack(trackId, {
        audioBuffer: finalBuffer,
        frames: nextFrames,
        speechOverrides: nextOverrides,
        waveformReferenceMax: getWaveformReferenceMax(nextFrames),
      });

      setRecordingState(RecordingState.IDLE);
      // Do not reset current frame to 0, let user stay where they are or seek manually
      // setCurrentFrame(0); 
      clearSelectionImmediate();
    } catch (e: unknown) {
      console.error("Error loading audio blob:", e);
      // More user friendly error
      const message = getErrorMessage(e);
      if (message.includes('Decode error')) {
         alert(t('app.decodeAudioFailed'));
      } else {
         alert(t('app.loadAudioFailed'));
      }
      setRecordingState(RecordingState.IDLE);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // For file upload, we usually want to replace or insert at 0? 
      // Let's assume file upload replaces from 0 for now, or we could insert at cursor.
      // Current behavior expectation is likely "Load this file into track", so start at 0.
      loadAudioBlobToTrack(file, recordTrackId, 0);
      e.target.value = ''; 
    }
  };

  // --- Audio Editing ---

  const getProjectSampleRate = useCallback((): number => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') return audioContextRef.current.sampleRate;
    return tracks.find((t) => t.audioBuffer)?.audioBuffer?.sampleRate ?? 48000;
  }, [tracks]);

  const getNormalizedSelections = useCallback((): SelectionRanges => {
    return mergeSelectionRanges(selectionRef.current);
  }, []);

  const getSelectionFrameCount = useCallback((): number => {
    return getNormalizedSelections().reduce(
      (total, range) => total + (range.endFrame - range.startFrame + 1),
      0
    );
  }, [getNormalizedSelections]);

  const playSelectionScrub = useCallback(
    (frame: number, trackId: string) => {
      if (editTarget === 'all') return;
      if (
        recordingState === RecordingState.RECORDING ||
        recordingState === RecordingState.PROCESSING ||
        recordingState === RecordingState.PLAYING
      ) {
        return;
      }
      playScrubPreview(frame, trackId);
    },
    [editTarget, playScrubPreview, recordingState]
  );

  const flushSelectionUpdates = useCallback(
    (forceRanges?: SelectionRanges) => {
      if (selectionRafRef.current !== null) {
        cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = null;
      }

      const hasForcedRange = forceRanges !== undefined;
      const pendingRanges = hasForcedRange ? forceRanges : selectionPendingRef.current;
      if (hasForcedRange || selectionPendingRef.current !== undefined) {
        selectionPendingRef.current = undefined;
        commitSelectionState(pendingRanges ?? []);
      }

      const scrubPending = selectionScrubPendingRef.current;
      if (scrubPending) {
        const last = selectionScrubLastRef.current;
        if (!last || last.frame !== scrubPending.frame || last.trackId !== scrubPending.trackId) {
          selectionScrubLastRef.current = scrubPending;
          playSelectionScrub(scrubPending.frame, scrubPending.trackId);
        }
        selectionScrubPendingRef.current = null;
      }
    },
    [commitSelectionState, playSelectionScrub]
  );

  const handleCut = useCallback(async () => {
    flushSelectionUpdates();
    const ranges = getNormalizedSelections();
    if (ranges.length === 0) return;

    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();

      const projectSampleRate = getProjectSampleRate();
      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);

      const nextClipboard: ClipboardClip = {
        kind: editTarget === 'all' ? 'all' : 'single',
        byTrackId: {},
        framesByTrackId: {},
        speechOverridesByTrackId: {},
      };

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id)) return track;

        nextClipboard.byTrackId[track.id] = extractAudioRangesPadded(track.audioBuffer, ranges, FPS, {
          sampleRate: track.audioBuffer?.sampleRate ?? projectSampleRate,
          numberOfChannels: track.audioBuffer?.numberOfChannels ?? 1,
        });
        nextClipboard.framesByTrackId[track.id] = extractFrameRangesPadded(track.frames, ranges, FPS);
        const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
        nextClipboard.speechOverridesByTrackId[track.id] = extractOverrideRanges(baseOverrides, ranges);

        return {
          ...track,
          audioBuffer: track.audioBuffer ? clearAudioRangesWithSilence(track.audioBuffer, ranges, FPS) : track.audioBuffer,
          frames: clearFrameRanges(track.frames, ranges, FPS),
          speechOverrides: clearOverrideRanges(baseOverrides, ranges),
        };
      });

      setTracks(nextTracks);
      setClipboardClip(nextClipboard);
      clearSelectionImmediate();
    } catch (error) {
      console.error('Cut failed:', error);
      alert(t('app.cutFailed'));
    }
  }, [
    clearSelectionImmediate,
    editTarget,
    flushSelectionUpdates,
    getNormalizedSelections,
    getProjectSampleRate,
    handlePause,
    recordingState,
    saveToHistory,
    t,
    tracks,
  ]);

  const handleDeleteSelection = async () => {
    flushSelectionUpdates();
    const ranges = getNormalizedSelections();
    if (ranges.length === 0) return;

    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id)) return track;
        const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
        return {
          ...track,
          audioBuffer: track.audioBuffer ? clearAudioRangesWithSilence(track.audioBuffer, ranges, FPS) : track.audioBuffer,
          frames: clearFrameRanges(track.frames, ranges, FPS),
          speechOverrides: clearOverrideRanges(baseOverrides, ranges),
        };
      });

      setTracks(nextTracks);
      clearSelectionImmediate();
      commitCurrentFrame(ranges[0].startFrame);
    } catch (error) {
      console.error('Delete failed:', error);
      alert(t('app.deleteFailed'));
    }
  };

  const handlePasteInsert = useCallback(async () => {
    if (!clipboardClip) return;
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const insertFrame = currentFrameRef.current;

      if (editTarget === 'all') {
        if (clipboardClip.kind !== 'all') {
          alert(t('app.pasteAllTracksRequired'));
          return;
        }

        const missing = tracks.find((t) => !clipboardClip.byTrackId[t.id]);
        if (missing) {
          alert(t('app.clipMissing'));
          return;
        }

        const nextTracks = tracks.map((track) => {
          const clip = clipboardClip.byTrackId[track.id];
          const clipFrameCount = getFrameCountFromBuffer(clip);
          const clipFrames = clipboardClip.framesByTrackId[track.id] ?? createSilentFrames(clipFrameCount, FPS);
          const overrideSlice = resizeSpeechOverrides(
            clipboardClip.speechOverridesByTrackId[track.id] ?? createSpeechOverrides(clipFrameCount),
            clipFrameCount
          );
          const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
          const newBuffer = insertAudioAtFrame(track.audioBuffer, clip, insertFrame, FPS);
          const nextOverrides = insertOverrideRange(baseOverrides, insertFrame, overrideSlice);
          return {
            ...track,
            audioBuffer: newBuffer,
            frames: insertFramesAtFrame(track.frames, clipFrames, insertFrame, FPS),
            speechOverrides: resizeSpeechOverrides(nextOverrides, getFrameCountFromBuffer(newBuffer)),
          };
        });
        setTracks(nextTracks);
      } else {
        const clip = clipboardClip.byTrackId[editTarget];
        if (!clip) {
          alert(t('app.trackClipMissing'));
          return;
        }

        const nextTracks = tracks.map((track) => {
          if (track.id !== editTarget) return track;
          const clipFrameCount = getFrameCountFromBuffer(clip);
          const clipFrames = clipboardClip.framesByTrackId[editTarget] ?? createSilentFrames(clipFrameCount, FPS);
          const overrideSlice = resizeSpeechOverrides(
            clipboardClip.speechOverridesByTrackId[editTarget] ?? createSpeechOverrides(clipFrameCount),
            clipFrameCount
          );
          const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
          const newBuffer = insertAudioAtFrame(track.audioBuffer, clip, insertFrame, FPS);
          const nextOverrides = insertOverrideRange(baseOverrides, insertFrame, overrideSlice);
          return {
            ...track,
            audioBuffer: newBuffer,
            frames: insertFramesAtFrame(track.frames, clipFrames, insertFrame, FPS),
            speechOverrides: resizeSpeechOverrides(nextOverrides, getFrameCountFromBuffer(newBuffer)),
          };
        });
        setTracks(nextTracks);
      }

      clearSelectionImmediate();
    } catch (error) {
      console.error('Paste insert failed:', error);
      alert(t('app.pasteInsertFailed'));
    }
  }, [
    clipboardClip,
    clearSelectionImmediate,
    editTarget,
    getFrameCountFromBuffer,
    handlePause,
    recordingState,
    saveToHistory,
    t,
    tracks,
  ]);

  const handlePasteOverwrite = useCallback(async () => {
    if (!clipboardClip) return;
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const insertFrame = currentFrameRef.current;

      if (editTarget === 'all') {
        if (clipboardClip.kind !== 'all') {
          alert(t('app.pasteAllTracksRequired'));
          return;
        }

        const missing = tracks.find((t) => !clipboardClip.byTrackId[t.id]);
        if (missing) {
          alert(t('app.clipMissing'));
          return;
        }

        const nextTracks = tracks.map((track) => {
          const clip = clipboardClip.byTrackId[track.id];
          const clipFrameCount = getFrameCountFromBuffer(clip);
          const clipFrames = clipboardClip.framesByTrackId[track.id] ?? createSilentFrames(clipFrameCount, FPS);
          const overrideSlice = resizeSpeechOverrides(
            clipboardClip.speechOverridesByTrackId[track.id] ?? createSpeechOverrides(clipFrameCount),
            clipFrameCount
          );
          const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
          const newBuffer = overwriteAudioAtFrame(track.audioBuffer, clip, insertFrame, FPS);
          const nextOverrides = overwriteOverrideRange(baseOverrides, insertFrame, overrideSlice);
          return {
            ...track,
            audioBuffer: newBuffer,
            frames: overwriteFramesAtFrame(track.frames, clipFrames, insertFrame, FPS),
            speechOverrides: resizeSpeechOverrides(nextOverrides, getFrameCountFromBuffer(newBuffer)),
          };
        });
        setTracks(nextTracks);
      } else {
        const clip = clipboardClip.byTrackId[editTarget];
        if (!clip) {
          alert(t('app.trackClipMissing'));
          return;
        }

        const nextTracks = tracks.map((track) => {
          if (track.id !== editTarget) return track;
          const clipFrameCount = getFrameCountFromBuffer(clip);
          const clipFrames = clipboardClip.framesByTrackId[editTarget] ?? createSilentFrames(clipFrameCount, FPS);
          const overrideSlice = resizeSpeechOverrides(
            clipboardClip.speechOverridesByTrackId[editTarget] ?? createSpeechOverrides(clipFrameCount),
            clipFrameCount
          );
          const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
          const newBuffer = overwriteAudioAtFrame(track.audioBuffer, clip, insertFrame, FPS);
          const nextOverrides = overwriteOverrideRange(baseOverrides, insertFrame, overrideSlice);
          return {
            ...track,
            audioBuffer: newBuffer,
            frames: overwriteFramesAtFrame(track.frames, clipFrames, insertFrame, FPS),
            speechOverrides: resizeSpeechOverrides(nextOverrides, getFrameCountFromBuffer(newBuffer)),
          };
        });
        setTracks(nextTracks);
      }

      clearSelectionImmediate();
    } catch (error) {
      console.error('Paste overwrite failed:', error);
      alert(t('app.pasteOverwriteFailed'));
    }
  }, [
    clipboardClip,
    clearSelectionImmediate,
    editTarget,
    getFrameCountFromBuffer,
    handlePause,
    recordingState,
    saveToHistory,
    t,
    tracks,
  ]);

  const handleInsertOneFrame = async () => {
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const insertFrame = currentFrameRef.current;
      const projectSampleRate = getProjectSampleRate();

      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id)) return track;
        const newBuffer = insertSilenceFramesAtFrame(track.audioBuffer, insertFrame, 1, FPS, {
          sampleRate: track.audioBuffer?.sampleRate ?? projectSampleRate,
          numberOfChannels: track.audioBuffer?.numberOfChannels ?? 1,
        });
        const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
        const nextOverrides = insertOverrideRange(baseOverrides, insertFrame, createSpeechOverrides(1));
        return {
          ...track,
          audioBuffer: newBuffer,
          frames: insertFramesAtFrame(track.frames, createSilentFrames(1, FPS), insertFrame, FPS),
          speechOverrides: resizeSpeechOverrides(nextOverrides, getFrameCountFromBuffer(newBuffer)),
        };
      });

      setTracks(nextTracks);
      commitCurrentFrame(currentFrameRef.current + 1);
    } catch (error) {
      console.error('Insert 1f failed:', error);
      alert(t('app.insertFrameFailed'));
    }
  };

  const handleDeleteOneFrame = async () => {
    if (recordingState === RecordingState.PLAYING) handlePause();

    flushSelectionUpdates();
    if (getNormalizedSelections().length > 0) {
      await handleDeleteSelection();
      return;
    }

    try {
      saveToHistory();

      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);
      const frameIndex = currentFrameRef.current;

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id) || !track.audioBuffer) return track;
        const newBuffer = deleteAudioRangeRipple(track.audioBuffer, frameIndex, frameIndex, FPS);
        const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
        const nextOverrides = deleteOverrideRange(baseOverrides, frameIndex, frameIndex);
        return {
          ...track,
          audioBuffer: newBuffer,
          frames: deleteFrameRangeRipple(track.frames, frameIndex, frameIndex, FPS),
          speechOverrides: resizeSpeechOverrides(nextOverrides, getFrameCountFromBuffer(newBuffer)),
        };
      });

      setTracks(nextTracks);
      clearSelectionImmediate();
      const nextMaxFrames = Math.max(0, ...nextTracks.map((track) => track.frames.length));
      commitCurrentFrame(Math.min(currentFrameRef.current, Math.max(0, nextMaxFrames - 1)));
    } catch (error) {
      console.error('Delete 1f failed:', error);
      alert(t('app.deleteFrameFailed'));
    }
  };

  // --- Playback Control ---

  const handlePlay = () => {
    const hasAudio = tracks.some(t => t.audioBuffer !== null);
    if (!hasAudio) return;

    stopScrubSources();
    isScrubbingRef.current = false;
    stopScrubState();

    const endFrame = Math.max(0, maxFrames - 1);
    const currentFrameSnapshot = currentFrameRef.current;
    const startFrame = currentFrameSnapshot >= endFrame ? 0 : currentFrameSnapshot;
    if (startFrame !== currentFrameSnapshot) {
      commitCurrentFrame(startFrame);
    }

    setRecordingState(RecordingState.PLAYING);
    startPlayback(startFrame, RecordingState.PLAYING);
  };

  const stopMicStream = useCallback(() => {
    const stream = micStreamRef.current;
    pendingRecordStartRef.current = false;
    micPreparePromiseRef.current = null;
    autoMicWarmupRef.current = false;
    setIsMicPreparing(false);
    setIsMicReady(false);
    cleanupRecordingGraph();
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  }, [cleanupRecordingGraph]);

  // Initialize Audio Context Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScrubSources(true);
      stopAllSources();
      stopVuMeter();
      stopMicStream();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [stopAllSources, stopMicStream, stopScrubSources, stopVuMeter]);

  const isStreamLive = (stream: MediaStream | null): boolean =>
    Boolean(stream && stream.getTracks().some((track) => track.readyState === 'live'));

  const ensureMicReady = useCallback(async (): Promise<MediaStream> => {
    if (isStreamLive(micStreamRef.current)) {
      setIsMicReady(true);
      return micStreamRef.current as MediaStream;
    }

    if (micPreparePromiseRef.current) {
      return micPreparePromiseRef.current;
    }

    setIsMicPreparing(true);
    const prepare = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
      .then((stream) => {
        micStreamRef.current = stream;
        setIsMicReady(true);
        return stream;
      })
      .catch((err) => {
        setIsMicReady(false);
        throw err;
      })
      .finally(() => {
        setIsMicPreparing(false);
        micPreparePromiseRef.current = null;
      });

    micPreparePromiseRef.current = prepare;
    return prepare;
  }, []);

  const maybeAutoWarmMic = useCallback(() => {
    if (autoMicWarmupRef.current) return;
    autoMicWarmupRef.current = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    if (isStreamLive(micStreamRef.current) || isMicPreparingRef.current) return;
    if (recordingStateRef.current === RecordingState.RECORDING || recordingStateRef.current === RecordingState.PROCESSING) return;
    void ensureMicReady().catch(() => {
      // no-op
    });
  }, [ensureMicReady]);

  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      maybeAutoWarmMic();
    };
    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity);
    return () => {
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, [maybeAutoWarmMic]);

  useEffect(() => {
    if (!isMicReady) return;
    lastActivityRef.current = Date.now();
    const intervalId = window.setInterval(() => {
      if (!isMicReadyRef.current) return;
      if (
        recordingStateRef.current === RecordingState.RECORDING ||
        recordingStateRef.current === RecordingState.PROCESSING ||
        isMicPreparingRef.current
      ) {
        lastActivityRef.current = Date.now();
        return;
      }
      if (Date.now() - lastActivityRef.current >= MIC_SLEEP_MS) {
        stopMicStream();
      }
    }, MIC_SLEEP_CHECK_MS);

    return () => window.clearInterval(intervalId);
  }, [isMicReady, stopMicStream]);

  const handleFrameTap = (frame: number) => {
    const nextFrame = Math.max(0, Math.floor(frame));

    if (recordingState === RecordingState.PLAYING) {
      handlePause();
    }

    commitCurrentFrame(nextFrame);
  };

  const handleTrackSelect = (trackId: string) => {
    setEditTarget(trackId);
    setRecordTrackId(trackId);
    lastSingleTrackIdRef.current = trackId;
  };

  const handleToggleAllTracks = () => {
    if (editTarget === 'all') {
      const next = lastSingleTrackIdRef.current || recordTrackId;
      setEditTarget(next);
      setRecordTrackId(next);
    } else {
      lastSingleTrackIdRef.current = editTarget;
      setEditTarget('all');
    }
  };

  const handleChangeUiScale = useCallback((value: number) => {
    const clamped = Math.round(Math.min(1.5, Math.max(0.75, value)) * 20) / 20;
    setUiScaleRaw(clamped);
    try { localStorage.setItem(UI_SCALE_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);

  const scheduleSelectionUpdate = useCallback(
    (ranges: SelectionRanges) => {
      const normalized = mergeSelectionRanges(ranges);
      if (areSelectionRangesEqual(selectionRef.current, normalized)) {
        setSelectionMenu(null);
        return;
      }
      selectionRef.current = normalized;
      selectionPendingRef.current = normalized;
      setSelectionMenu(null);
      if (selectionRafRef.current === null) {
        selectionRafRef.current = requestAnimationFrame(() => {
          selectionRafRef.current = null;
          flushSelectionUpdates();
        });
      }
    },
    [flushSelectionUpdates]
  );

  const scheduleSelectionScrub = useCallback(
    (frame: number, trackId: string) => {
      selectionScrubPendingRef.current = { frame, trackId };
      if (selectionRafRef.current === null) {
        selectionRafRef.current = requestAnimationFrame(() => {
          selectionRafRef.current = null;
          flushSelectionUpdates();
        });
      }
    },
    [flushSelectionUpdates]
  );

  const handleSelectionChange = useCallback(
    (ranges: SelectionRanges) => {
      scheduleSelectionUpdate(ranges);
    },
    [scheduleSelectionUpdate]
  );

  const handleSelectionScrub = useCallback(
    (frame: number, trackId: string) => {
      scheduleSelectionScrub(frame, trackId);
    },
    [scheduleSelectionScrub]
  );

  const handleSelectionCommit = useCallback(() => {
    flushSelectionUpdates();
  }, [flushSelectionUpdates]);

  const handleOpenSelectionMenu = useCallback(
    (point: { x: number; y: number }) => {
      flushSelectionUpdates();
      setSelectionMenu(point);
    },
    [flushSelectionUpdates]
  );

  const applySpeechOverrideToSelection = useCallback(
    (value: number) => {
      flushSelectionUpdates();
      const ranges = getNormalizedSelections();
      if (ranges.length === 0) return;
      saveToHistory();
      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);
      setTracks((prev) =>
        prev.map((track) => {
          if (!targetSet.has(track.id)) return track;
          const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
          return {
            ...track,
            speechOverrides: applyOverrideRanges(baseOverrides, ranges, value),
          };
        })
      );
    },
    [editTarget, flushSelectionUpdates, getNormalizedSelections, saveToHistory, tracks]
  );

  const applySpeechOverrideToSelectionAndAdvance = useCallback(
    (value: number): boolean => {
      flushSelectionUpdates();
      const ranges = getNormalizedSelections();
      if (ranges.length === 0) return false;
      applySpeechOverrideToSelection(value);
      clearSelectionImmediate();
      const endFrame = Math.max(0, maxFrames - 1);
      const nextFrame = Math.min(ranges[ranges.length - 1].endFrame + 1, endFrame);
      commitCurrentFrame(nextFrame);
      startScrubState(SCRUB_STATE_RESET_MS);
      return true;
    },
    [
      applySpeechOverrideToSelection,
      clearSelectionImmediate,
      commitCurrentFrame,
      flushSelectionUpdates,
      getNormalizedSelections,
      maxFrames,
      startScrubState,
    ]
  );

  const applySpeechOverrideToFrame = useCallback(
    (frame: number, value: number) => {
      if (
        recordingState === RecordingState.RECORDING ||
        recordingState === RecordingState.PROCESSING ||
        recordingState === RecordingState.PLAYING
      ) {
        return;
      }
      saveToHistory();
      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);
      setTracks((prev) =>
        prev.map((track) => {
          if (!targetSet.has(track.id)) return track;
          const baseOverrides = resizeSpeechOverrides(track.speechOverrides, track.frames.length);
          return {
            ...track,
            speechOverrides: applyOverrideRange(baseOverrides, frame, frame, value),
          };
        })
      );
    },
    [editTarget, recordingState, saveToHistory, tracks]
  );

  const stepFrameAfterLabel = useCallback(() => {
    if (
      recordingState === RecordingState.RECORDING ||
      recordingState === RecordingState.PROCESSING ||
      recordingState === RecordingState.PLAYING
    ) {
      return;
    }
    const nextFrame = Math.max(0, currentFrameRef.current + 1);
    commitCurrentFrame(nextFrame);
    startScrubState(SCRUB_STATE_RESET_MS);
  }, [commitCurrentFrame, recordingState, startScrubState]);

  const handleMarkSpeech = useCallback(() => {
    applySpeechOverrideToSelection(1);
  }, [applySpeechOverrideToSelection]);

  const handleMarkNonSpeech = useCallback(() => {
    applySpeechOverrideToSelection(-1);
  }, [applySpeechOverrideToSelection]);

  const handleResetSpeechLabel = useCallback(() => {
    applySpeechOverrideToSelection(0);
  }, [applySpeechOverrideToSelection]);

  const handleMarkSpeechFrame = useCallback(() => {
    if (
      recordingState === RecordingState.RECORDING ||
      recordingState === RecordingState.PROCESSING ||
      recordingState === RecordingState.PLAYING
    ) {
      return;
    }
    if (applySpeechOverrideToSelectionAndAdvance(1)) return;
    applySpeechOverrideToFrame(currentFrameRef.current, 1);
    stepFrameAfterLabel();
  }, [applySpeechOverrideToFrame, applySpeechOverrideToSelectionAndAdvance, recordingState, stepFrameAfterLabel]);

  const handleMarkNonSpeechFrame = useCallback(() => {
    if (
      recordingState === RecordingState.RECORDING ||
      recordingState === RecordingState.PROCESSING ||
      recordingState === RecordingState.PLAYING
    ) {
      return;
    }
    if (applySpeechOverrideToSelectionAndAdvance(-1)) return;
    applySpeechOverrideToFrame(currentFrameRef.current, -1);
    stepFrameAfterLabel();
  }, [applySpeechOverrideToFrame, applySpeechOverrideToSelectionAndAdvance, recordingState, stepFrameAfterLabel]);

  const handleZoomIn = useCallback(() => {
    setSheetZoom((prev) => normalizeSheetZoom(prev + SHEET_ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setSheetZoom((prev) => normalizeSheetZoom(prev - SHEET_ZOOM_STEP));
  }, []);

  const handleZoomReset = useCallback(() => {
    setSheetZoom(1);
  }, []);

  const handleZoomChange = useCallback((value: number) => {
    setSheetZoom(normalizeSheetZoom(value));
  }, []);

  const handleChangeInputGainDb = useCallback((value: number) => {
    setInputGainDb(clampInputGainDb(value));
  }, []);

  const handleToggleLimiter = useCallback((value: boolean) => {
    setIsLimiterEnabled(value);
  }, []);

  const handleStartInputTest = useCallback(async () => {
    if (recordingState !== RecordingState.IDLE) {
      alert(t('app.inputTestRunningBlocked'));
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(t('app.inputTestUnsupported'));
      return;
    }

    if (inputTestAbortRef.current) {
      inputTestAbortRef.current.abort();
      inputTestAbortRef.current = null;
    }
    const aborter = new AbortController();
    inputTestAbortRef.current = aborter;

    setInputTestState({
      status: 'running',
      progress: 0,
      message: t('app.inputTestStart'),
    });

    try {
      const stream = await ensureMicReady();
      if (aborter.signal.aborted) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const AudioContextClass = getAudioContextClass();
        audioContextRef.current = new AudioContextClass();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      const ctx = audioContextRef.current;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      const rmsValues: number[] = [];
      let peak = 0;
      let rafId = 0;
      let lastUiUpdate = 0;
      const startedAt = performance.now();

      const cleanup = () => {
        if (rafId) cancelAnimationFrame(rafId);
        try {
          source.disconnect();
        } catch {
          // no-op
        }
        try {
          analyser.disconnect();
        } catch {
          // no-op
        }
      };

      const finishWithError = (message: string) => {
        cleanup();
        inputTestAbortRef.current = null;
        setInputTestState({
          status: 'error',
          progress: 1,
          message,
        });
      };

      const finish = () => {
        cleanup();
        inputTestAbortRef.current = null;

        if (rmsValues.length < 6) {
          finishWithError(t('app.inputTestNoAudio'));
          return;
        }

        const sorted = [...rmsValues].sort((a, b) => a - b);
        const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
        const speechThreshold = Math.max(INPUT_TEST_MIN_RMS, noiseFloor * 3);
        const speechFrames = rmsValues.filter((value) => value >= speechThreshold);
        const speechRatio = speechFrames.length / rmsValues.length;

        if (speechRatio < INPUT_TEST_MIN_SPEECH_RATIO) {
          finishWithError(t('app.inputTestLowSpeech'));
          return;
        }

        const speechRms = speechFrames.reduce((sum, value) => sum + value, 0) / speechFrames.length;
        const peakDb = gainToDb(peak);
        const rmsDb = gainToDb(speechRms);
        const recommendedGainDb = INPUT_TEST_TARGET_PEAK_DB - peakDb;
        const appliedGainDb = clampInputGainDb(recommendedGainDb);
        const clipped = peak >= 0.98;

        setInputGainDb(appliedGainDb);

        const gainLabel = `${appliedGainDb >= 0 ? '+' : ''}${appliedGainDb.toFixed(1)} dB`;
        let message = t('app.inputTestComplete', {
          gain: gainLabel,
          peak: peakDb.toFixed(1),
          rms: rmsDb.toFixed(1),
        });

        if (recommendedGainDb > MAX_INPUT_GAIN_DB) {
          message += t('app.inputTestGainMaxed');
        } else if (recommendedGainDb < MIN_INPUT_GAIN_DB) {
          message += t('app.inputTestGainMin');
        }

        if (clipped) {
          message += t('app.inputTestClipped');
        }

        setInputTestState({
          status: 'success',
          progress: 1,
          message,
          recommendedGainDb,
          appliedGainDb,
          peakDb,
          rmsDb,
          speechRatio,
          clipped,
        });
      };

      const tick = () => {
        if (aborter.signal.aborted) {
          cleanup();
          inputTestAbortRef.current = null;
          return;
        }
        const now = performance.now();
        const elapsed = now - startedAt;

        analyser.getFloatTimeDomainData(buffer);
        if (elapsed >= INPUT_TEST_IGNORE_MS) {
          let sumSquares = 0;
          let framePeak = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            const value = buffer[i];
            sumSquares += value * value;
            const abs = Math.abs(value);
            if (abs > framePeak) framePeak = abs;
          }
          const rms = Math.sqrt(sumSquares / buffer.length);
          rmsValues.push(rms);
          if (framePeak > peak) peak = framePeak;
        }

        if (now - lastUiUpdate >= INPUT_TEST_UI_UPDATE_MS) {
          lastUiUpdate = now;
          setInputTestState((prev) =>
            prev.status === 'running'
              ? { ...prev, progress: Math.min(1, elapsed / INPUT_TEST_DURATION_MS) }
              : prev
          );
        }

        if (elapsed >= INPUT_TEST_DURATION_MS) {
          finish();
          return;
        }

        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
    } catch (error) {
      const message = getErrorMessage(error);
      setInputTestState({
        status: 'error',
        progress: 1,
        message: message ? t('app.inputTestFailedWithMessage', { message }) : t('app.inputTestFailed'),
      });
    }
  }, [ensureMicReady, recordingState, t]);

  const handleScrubStart = (frame: number) => {
    if (recordingState === RecordingState.RECORDING || recordingState === RecordingState.PROCESSING) return;
    if (recordingState === RecordingState.PLAYING) handlePause();
    isScrubbingRef.current = true;
    startScrubState();
    scrubLastTimeRef.current = 0;
    const nextFrame = Math.max(0, Math.floor(frame));
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    scrubFramePendingRef.current = null;
    scrubFrameLastRef.current = null;
    commitScrubFrame(nextFrame);
  };

  const handleScrubMove = (frame: number) => {
    if (!isScrubbingRef.current) return;
    if (recordingState === RecordingState.RECORDING || recordingState === RecordingState.PROCESSING) return;
    const nextFrame = Math.max(0, Math.floor(frame));
    scheduleScrubFrame(nextFrame);
  };

  const handleScrubEnd = () => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    flushScrubFrame();
    stopScrubState();
  };

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[contenteditable="true"]'))
      ) {
        return;
      }

      if (recordingState === RecordingState.RECORDING || recordingState === RecordingState.PROCESSING) {
        return;
      }

      if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (isHelpOpen || isMoreOpen) return;
        e.preventDefault();
        if (recordingState === RecordingState.PLAYING) handlePause();
        startScrubState(SCRUB_STATE_RESET_MS);

        const delta = e.key === 'ArrowUp' ? -1 : 1;
        const nextFrame = Math.max(0, currentFrameRef.current + delta);
        commitCurrentFrame(nextFrame);
        playScrubPreview(nextFrame);
        return;
      }

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (
        ((e.ctrlKey || e.metaKey) && e.key === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')
      ) {
        e.preventDefault();
        handleRedo();
      }
      // Cut: Ctrl+X
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        void handleCut();
      }
      // Paste: Ctrl+V（Shiftで上書き）
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (e.shiftKey) {
          void handlePasteOverwrite();
        } else {
          void handlePasteInsert();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    commitCurrentFrame,
    handleUndo,
    handleRedo,
    handleCut,
    handlePasteInsert,
    handlePasteOverwrite,
    handlePause,
    isHelpOpen,
    isMoreOpen,
    playScrubPreview,
    recordingState,
    startScrubState,
  ]);

  const framesPerSheet = getFramesPerSheet(FPS);
  const sheetNumber = Math.floor(currentFrame / framesPerSheet) + 1;

  const totalTimecode = formatTimecode(maxFrames, FPS);
  const currentTimecode = formatTimecodeOneBased(currentFrame, FPS);
  const hasAudio = tracks.some((t) => t.audioBuffer !== null);
  const isRecording = recordingState === RecordingState.RECORDING;
  const isPlaying = recordingState === RecordingState.PLAYING;
  const isBusy = recordingState === RecordingState.PROCESSING;
  const isPreparing = isMicPreparing && !isRecording;
  const isMobileUi = isCoarsePointer && mobileViewportWidth > 0 && mobileViewportWidth < MOBILE_UI_MAX_WIDTH;
  const breakpointWidth = getBreakpointWidth();
  const isMobileCompactUi = isMobileUi && breakpointWidth <= MOBILE_COMPACT_MAX_WIDTH;
  const isMobileTightUi = isMobileUi && breakpointWidth <= MOBILE_TIGHT_MAX_WIDTH;
  const canRecordToggle = !isBusy && !isPreparing;
  const canPlayToggle = hasAudio && !isBusy && !isRecording;
  const mutedCount = tracks.filter((track) => track.isMuted).length;
  const isZoomOutDisabled = sheetZoom <= MIN_SHEET_ZOOM + 0.001;
  const isZoomInDisabled = sheetZoom >= MAX_SHEET_ZOOM - 0.001;

  const targetLabel =
    editTarget === 'all'
      ? t('app.targetAllTracks')
      : tracks.find((t) => t.id === editTarget)?.name ?? t('app.trackFallback', { track: editTarget });

  const selectionCount = getSelectionFrameCount();
  const selectionTimecode = selectionCount > 0 ? formatTimecode(selectionCount, FPS) : undefined;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mobileUi = isMobileUi ? 'true' : 'false';
    root.dataset.mobileCompact = isMobileCompactUi ? 'true' : 'false';
    root.dataset.mobileTight = isMobileTightUi ? 'true' : 'false';
    root.style.setProperty('--ui-scale', String(uiScale));
  }, [isMobileCompactUi, isMobileTightUi, isMobileUi, uiScale]);

  return (
    <AppShell
      top={
        <TopBar
          isMobileLayout={isMobileUi}
          sheetNumber={sheetNumber}
          totalTimecode={totalTimecode}
          currentTimecode={currentTimecode}
          selectionTimecode={selectionTimecode}
          t={t}
          isResetDisabled={recordingState === RecordingState.RECORDING || recordingState === RecordingState.PROCESSING}
          isUndoDisabled={historyPast.length === 0}
          isRedoDisabled={historyFuture.length === 0}
          mutedCount={mutedCount}
          isZoomInDisabled={isZoomInDisabled}
          isZoomOutDisabled={isZoomOutDisabled}
          onReset={handleResetProject}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onOpenMuteMenu={handleOpenMuteMenu}
          onOpenHelp={() => {
            setIsHelpOpen(true);
            setIsMoreOpen(false);
            setMuteMenu(null);
          }}
          onOpenMore={() => {
            setIsMoreOpen(true);
            setIsHelpOpen(false);
            setMuteMenu(null);
          }}
          onBarWidthChange={setTopBarWidth}
          uiScale={uiScale}
        />
      }
      bottom={
        <TransportDock
          isMobileLayout={isMobileUi}
          recordingState={recordingState}
          hasAudio={hasAudio}
          recordTrackId={recordTrackId}
          isMicReady={isMicReady}
          isMicPreparing={isMicPreparing}
          isAllTracks={editTarget === 'all'}
          mobileInteractionMode={mobileInteractionMode}
          t={t}
          onChangeMobileInteractionMode={setMobileInteractionMode}
          onToggleAllTracks={handleToggleAllTracks}
          onInsertOneFrame={() => void handleInsertOneFrame()}
          onDeleteOneFrame={() => void handleDeleteOneFrame()}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onPlay={handlePlay}
          onPause={handlePause}
          onMarkSpeechFrame={handleMarkSpeechFrame}
          onMarkNonSpeechFrame={handleMarkNonSpeechFrame}
        />
      }
    >
      <TimesheetViewport
        tracks={tracks}
        currentFrame={currentFrame}
        virtualMaxFrames={virtualMaxFrames}
        editTarget={editTarget}
        mobileInteractionMode={mobileInteractionMode}
        selection={selection}
        t={t}
        fps={FPS}
        zoom={sheetZoom}
        minZoom={MIN_SHEET_ZOOM}
        maxZoom={MAX_SHEET_ZOOM}
        isAutoScrollActive={
          recordingState === RecordingState.PLAYING || recordingState === RecordingState.RECORDING
        }
        isScrubbing={isScrubbing}
        onFrameTap={handleFrameTap}
        onBackgroundClick={handleBackgroundClick}
        onOpenSelectionMenu={handleOpenSelectionMenu}
        onSelectionChange={handleSelectionChange}
        onSelectionScrub={handleSelectionScrub}
        onSelectionCommit={handleSelectionCommit}
        onTrackSelect={handleTrackSelect}
        onScrubStart={handleScrubStart}
        onScrubMove={handleScrubMove}
        onScrubEnd={handleScrubEnd}
        onZoomChange={handleZoomChange}
        onFirstVisibleColumnChange={setViewportFirstColumn}
      />

      {isMobileUi && (
        <div className="pointer-events-none touch-no-select absolute right-3 bottom-3 z-30">
          <div className="pointer-events-auto flex items-center">
            <button
              type="button"
              disabled={!canPlayToggle}
              onClick={() => {
                setMobileInteractionMode('navigate');
                if (isPlaying) {
                  handlePause();
                } else {
                  handlePlay();
                }
              }}
              className={`flex h-[var(--control-size)] w-[var(--control-size)] items-center justify-center rounded-full border shadow-xl transition-colors ${
                canPlayToggle ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-gray-100 text-gray-400'
              }`}
              title={isPlaying ? t('transport.pauseTitle') : t('transport.playTitle')}
            >
              {isPlaying ? (
                <Pause className="h-6 w-6" />
              ) : (
                <Play className="h-6 w-6 translate-x-[1px]" />
              )}
            </button>
          </div>
        </div>
      )}

      <EditPalette
        selectionCount={selectionCount}
        targetLabel={targetLabel}
        anchor={selectionMenu}
        hasClipboard={clipboardClip !== null}
        t={t}
        onClose={() => setSelectionMenu(null)}
        onCut={() => {
          setSelectionMenu(null);
          void handleCut();
        }}
        onDelete={() => {
          setSelectionMenu(null);
          void handleDeleteSelection();
        }}
        onPasteInsert={() => {
          setSelectionMenu(null);
          void handlePasteInsert();
        }}
        onPasteOverwrite={() => {
          setSelectionMenu(null);
          void handlePasteOverwrite();
        }}
        onClearClipboard={() => {
          setSelectionMenu(null);
          setClipboardClip(null);
        }}
        onMarkSpeech={handleMarkSpeech}
        onMarkNonSpeech={handleMarkNonSpeech}
        onResetSpeechLabel={handleResetSpeechLabel}
        onClearSelection={() => {
          clearSelectionImmediate();
        }}
      />

      <MoreSheet
        isOpen={isMoreOpen}
        tracks={tracks}
        recordTrackId={recordTrackId}
        vadPreset={vadPreset}
        vadStability={vadStability}
        vadThresholdScale={vadThresholdScale}
        isVadAuto={isVadAuto}
        vadEngineStatus={vadEngineStatus}
        vadEngineError={vadEngineError}
        inputRmsRef={inputRmsRef}
        inputGainDb={inputGainDb}
        isLimiterEnabled={isLimiterEnabled}
        inputTestState={inputTestState}
        isInputTestBusy={inputTestState.status === 'running'}
        isInputConfigLocked={recordingState !== RecordingState.IDLE}
        t={t}
        playWhileRecording={playWhileRecording}
        isResetDisabled={recordingState === RecordingState.RECORDING || recordingState === RecordingState.PROCESSING}
        isZoomInDisabled={isZoomInDisabled}
        isZoomOutDisabled={isZoomOutDisabled}
        mutedCount={mutedCount}
        onClose={() => setIsMoreOpen(false)}
        onOpenHelp={() => {
          setIsHelpOpen(true);
          setIsMoreOpen(false);
          setMuteMenu(null);
        }}
        onOpenMuteMenu={handleOpenMuteMenu}
        onReset={handleResetProject}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onExportAudio={() => void handleExportAudio()}
        onExportSheetImagesCurrent={() => void handleExportSheetImagesCurrent()}
        onExportSheetImagesAll={() => void handleExportSheetImagesAll()}
        onFileUpload={handleFileUpload}
        onStartInputTest={handleStartInputTest}
        onChangeInputGainDb={handleChangeInputGainDb}
        onToggleLimiter={handleToggleLimiter}
        onChangeVadPreset={setVadPreset}
        onChangeVadStability={handleVadStabilityChange}
        onToggleVadAuto={handleToggleVadAuto}
        onChangeVadThresholdScale={handleVadThresholdScaleChange}
        onCommitVadThresholdScale={commitVadThresholdHistory}
        onTogglePlayWhileRecording={() => setPlayWhileRecording((prev) => !prev)}
        uiScale={uiScale}
        onChangeUiScale={handleChangeUiScale}
      />

      <HelpSheet isOpen={isHelpOpen} t={t} list={tList} onClose={() => setIsHelpOpen(false)} />

      <TrackMuteMenu
        isOpen={muteMenu !== null}
        position={muteMenu}
        tracks={tracks}
        t={t}
        onToggleTrack={toggleTrackMute}
        onClose={handleCloseMuteMenu}
      />

      {showDebug && (
        <div
          className="fixed top-0 left-0 z-[9999] max-w-[min(22rem,90vw)] bg-black/85 text-[11px] leading-[1.45] text-green-300 font-mono p-2 rounded-br-lg pointer-events-none"
          style={{ wordBreak: 'break-all' }}
        >
          <div className="font-bold text-yellow-300 mb-1">Debug</div>
          <div>visualVP.w: {window.visualViewport?.width?.toFixed(1) ?? 'N/A'}</div>
          <div>innerWidth: {window.innerWidth}</div>
          <div>DPR: {window.devicePixelRatio}</div>
          <div>screen: {window.screen?.width}x{window.screen?.height}</div>
          <div className="mt-1 border-t border-green-800 pt-1">
            mobileVPWidth: {mobileViewportWidth.toFixed(1)} | bpWidth: {breakpointWidth}
          </div>
          <div>coarse: {String(isCoarsePointer)}</div>
          <div>
            mobile: {String(isMobileUi)} | compact: {String(isMobileCompactUi)} | tight: {String(isMobileTightUi)}
          </div>
          <div className="mt-1 border-t border-green-800 pt-1">
            barWidth: {topBarWidth}
          </div>
          <div>
            compactBar(&lt;720): {String(topBarWidth > 0 && topBarWidth < 720)} | tightBar(&lt;560): {String(topBarWidth > 0 && topBarWidth < 560)}
          </div>
          <div className="mt-1 border-t border-green-800 pt-1">
            --control-size: {typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--control-size').trim() : '?'}
          </div>
          <div>
            --control-icon: {typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--control-icon').trim() : '?'}
          </div>
          <div>
            --record-h: {typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--record-h').trim() : '?'}
          </div>
          <div>
            --ui-sm: {typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--ui-sm').trim() : '?'}
          </div>
          <div>
            uiScale: {uiScale}
          </div>
        </div>
      )}
    </AppShell>
  );
}
