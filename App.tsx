import React, { useState, useRef, useEffect, useCallback } from 'react';
import { blobToAudioBuffer } from './services/audioProcessor';
import {
  cutAudioRangeWithSilence,
  deleteAudioRangeRipple,
  extractAudioRangePadded,
  insertAudioAtFrame,
  insertSilenceFramesAtFrame,
  overwriteAudioAtFrame,
} from './services/audioEdit';
import { exportTracksToZip } from './services/audioExporter';
import { getVadTuning, VadPreset, VadTuning } from './services/vad';
import {
  analyzeAudioBufferWithSileroVadEngine,
  getSileroVadStatus,
  subscribeSileroVadStatus,
} from './services/sileroVadEngine';
import { exportSheetImagesToZip } from './services/sheetImageExporter';
import { computeVadAutoTuning } from './services/vadAutoTuner';
import { TimesheetViewport } from './components/TimesheetViewport';
import { HelpSheet } from './components/HelpSheet';
import { ClipboardMenu } from './components/ClipboardMenu';
import { TrackMuteMenu } from './components/TrackMuteMenu';
import { AppShell } from './components/AppShell';
import { EditPalette } from './components/EditPalette';
import { MoreSheet } from './components/MoreSheet';
import { TopBar } from './components/TopBar';
import { TransportDock } from './components/TransportDock';
import { useViewportHeight } from './hooks/useViewportHeight';
import { FrameData, RecordingState, Track } from './types';
import { ClipboardClip, EditTarget, SelectionRange } from './domain/editTypes';
import { DEFAULT_FPS, getFramesPerSheet } from './domain/timesheet';
import { formatTimecode } from './domain/timecode';

const FPS = DEFAULT_FPS;
const SCRUB_PREVIEW_SEC = 0.08;
const SCRUB_FADE_SEC = 0.01;
const SCRUB_THROTTLE_MS = 50;
const MIC_SLEEP_MS = 5 * 60 * 1000;
const MIC_SLEEP_CHECK_MS = 15 * 1000;
const MIN_SHEET_ZOOM = 1;
const MAX_SHEET_ZOOM = 3;
const SHEET_ZOOM_STEP = 0.1;
const AUTO_VAD_BASE_THRESHOLD_SCALE = 1;
const AUTO_VAD_BASE_STABILITY = 0.4;

const clampSheetZoom = (value: number): number => Math.min(MAX_SHEET_ZOOM, Math.max(MIN_SHEET_ZOOM, value));
const normalizeSheetZoom = (value: number): number => Math.round(clampSheetZoom(value) * 100) / 100;

// Use a factory function to ensure fresh references on reset
const createInitialTracks = (): Track[] => [
  { id: '1', name: 'Track 1', color: 'blue', audioBuffer: null, frames: [], isVisible: true, isMuted: false },
  { id: '2', name: 'Track 2', color: 'red', audioBuffer: null, frames: [], isVisible: true, isMuted: false },
  { id: '3', name: 'Track 3', color: 'green', audioBuffer: null, frames: [], isVisible: true, isMuted: false },
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

export default function App() {
  const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  
  // Multi-track State
  const [tracks, setTracks] = useState<Track[]>(createInitialTracks());
  const [recordTrackId, setRecordTrackId] = useState<string>('1');
  const [editTarget, setEditTarget] = useState<EditTarget>('1');

  // History State for Undo/Redo
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);

  // Clipboard State
  const [clipboardClip, setClipboardClip] = useState<ClipboardClip | null>(null);
  const [clipboardMenu, setClipboardMenu] = useState<{ x: number; y: number } | null>(null);
  const [muteMenu, setMuteMenu] = useState<{ x: number; y: number } | null>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [vadPreset, setVadPreset] = useState<VadPreset>('normal');
  const [vadStability, setVadStability] = useState(AUTO_VAD_BASE_STABILITY);
  const [vadThresholdScale, setVadThresholdScale] = useState(AUTO_VAD_BASE_THRESHOLD_SCALE);
  const [isVadAuto, setIsVadAuto] = useState(true);
  const [playWhileRecording, setPlayWhileRecording] = useState(true);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
  const [isMicPreparing, setIsMicPreparing] = useState(false);
  const [inputRms, setInputRms] = useState(0);
  const [viewportFirstColumn, setViewportFirstColumn] = useState(0);
  const [sheetZoom, setSheetZoom] = useState(1);
  const [isSileroActive, setIsSileroActive] = useState(() => getSileroVadStatus() === 'silero');
  
  // Selection State
  const [selection, setSelection] = useState<SelectionRange | null>(null);

  const tracksRef = useRef(tracks);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartFrameRef = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micPreparePromiseRef = useRef<Promise<MediaStream> | null>(null);
  const pendingRecordStartRef = useRef(false);
  const lastSingleTrackIdRef = useRef<string>('1');
  const currentFrameRef = useRef(0);
  const autoMicWarmupRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const recordingStateRef = useRef(recordingState);
  const isMicReadyRef = useRef(isMicReady);
  const isMicPreparingRef = useRef(isMicPreparing);
  const vadThresholdHistoryRef = useRef<{ startValue: number } | null>(null);
  const vadThresholdCommitTimerRef = useRef<number | null>(null);
  const vadReprocessIdRef = useRef(0);
  const lastAutoTuneRef = useRef<Map<string, AudioBuffer | null>>(new Map());

  const vuAnalyserRef = useRef<AnalyserNode | null>(null);
  const vuSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vuAnimationFrameRef = useRef<number>(0);
  
  // Store source nodes for each track for mixed playback
  const sourceNodesRef = useRef<Map<string, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map());
  const scrubNodesRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode }[]>([]);
  const scrubLastTimeRef = useRef(0);
  const isScrubbingRef = useRef(false);
  
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

  useViewportHeight();

  // Stats (Calculate total max duration across all tracks)
  const maxFrames = Math.max(0, ...tracks.map(t => t.frames.length));

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  useEffect(() => {
    isMicReadyRef.current = isMicReady;
  }, [isMicReady]);

  useEffect(() => {
    isMicPreparingRef.current = isMicPreparing;
  }, [isMicPreparing]);

  useEffect(() => {
    return subscribeSileroVadStatus((status) => {
      setIsSileroActive(status === 'silero');
    });
  }, []);

  useEffect(() => {
    if (!isVadAuto) return;
    const tracksWithAudio = tracks.filter((track) => track.audioBuffer);
    if (tracksWithAudio.length === 0) return;
    if (!tracksWithAudio.every((track) => track.frames.length > 0)) return;
    if (!tracksWithAudio.every((track) => track.frames.some((frame) => frame.volume > 0))) return;

    const shouldTune = tracksWithAudio.some(
      (track) => lastAutoTuneRef.current.get(track.id) !== track.audioBuffer
    );
    if (!shouldTune) return;

    const autoTuning = computeVadAutoTuning(
      tracksWithAudio.map((track) => track.frames),
      FPS
    );
    lastAutoTuneRef.current = new Map(tracks.map((track) => [track.id, track.audioBuffer]));
    setVadThresholdScale(autoTuning.thresholdScale);
    setVadStability(autoTuning.stability);
  }, [isVadAuto, tracks]);

  // Initialize Audio Context Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScrubSources();
      stopAllSources();
      stopVuMeter();
      stopMicStream();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const createEmptyFrames = useCallback((audioBuffer: AudioBuffer | null): FrameData[] => {
    if (!audioBuffer) return [];
    const totalFrames = Math.floor((audioBuffer.length * FPS) / audioBuffer.sampleRate);
    const frames: FrameData[] = [];
    for (let i = 0; i < totalFrames; i++) {
      frames.push({
        frameIndex: i,
        time: i / FPS,
        volume: 0,
        isSpeech: false,
      });
    }
    return frames;
  }, []);

  const scheduleVadAnalysis = useCallback((trackId: string, audioBuffer: AudioBuffer, tuning: VadTuning) => {
    const bufferRef = audioBuffer;
    const tuningToken = vadReprocessIdRef.current;
    void analyzeAudioBufferWithSileroVadEngine(bufferRef, FPS, tuning)
      .then((frames) => {
        if (vadReprocessIdRef.current !== tuningToken) return;
        setTracks((prev) =>
          prev.map((track) =>
            track.id === trackId && track.audioBuffer === bufferRef ? { ...track, frames } : track
          )
        );
      })
      .catch((error) => {
        console.warn('VAD解析に失敗しました。', error);
      });
  }, []);

  // Re-process when VAD settings change
  useEffect(() => {
    // VAD設定は非破壊の表示変更なので、履歴は別ロジックで管理する。
    // ここでは派生 frames の再生成のみを行う。
    const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
    const requestId = vadReprocessIdRef.current + 1;
    vadReprocessIdRef.current = requestId;
    const snapshot = tracksRef.current;

    const run = async () => {
      const results = await Promise.all(
        snapshot.map(async (track) => {
          if (!track.audioBuffer) return null;
          try {
            const frames = await analyzeAudioBufferWithSileroVadEngine(track.audioBuffer, FPS, tuning);
            return { id: track.id, buffer: track.audioBuffer, frames };
          } catch (error) {
            console.warn('VAD解析に失敗しました。', error);
            return null;
          }
        })
      );

      if (vadReprocessIdRef.current !== requestId) return;

      const resultMap = new Map(
        results
          .filter((result): result is { id: string; buffer: AudioBuffer; frames: FrameData[] } => Boolean(result))
          .map((result) => [result.id, result])
      );

      setTracks((prevTracks) =>
        prevTracks.map((track) => {
          if (!track.audioBuffer) return { ...track, frames: [] };
          const match = resultMap.get(track.id);
          if (match && match.buffer === track.audioBuffer) {
            return { ...track, frames: match.frames };
          }
          return track;
        })
      );
    };

    void run();
  }, [vadPreset, vadStability, vadThresholdScale]);

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
      lastAutoTuneRef.current = new Map();
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
      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
      const nextTracks = previous.tracks.map((track) =>
        track.audioBuffer ? { ...track, frames: createEmptyFrames(track.audioBuffer) } : { ...track, frames: [] }
      );
      setTracks(nextTracks);
      // Reset selection to avoid ghost selections
      setSelection(null);
      nextTracks.forEach((track) => {
        if (track.audioBuffer) {
          scheduleVadAnalysis(track.id, track.audioBuffer, tuning);
        }
      });
    } else {
      setVadThresholdScale(previous.value);
    }
    setHistoryPast(newPast);
  }, [
    createEmptyFrames,
    historyPast,
    scheduleVadAnalysis,
    tracks,
    vadPreset,
    vadStability,
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
      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
      const nextTracks = next.tracks.map((track) =>
        track.audioBuffer ? { ...track, frames: createEmptyFrames(track.audioBuffer) } : { ...track, frames: [] }
      );
      setTracks(nextTracks);
      setSelection(null);
      nextTracks.forEach((track) => {
        if (track.audioBuffer) {
          scheduleVadAnalysis(track.id, track.audioBuffer, tuning);
        }
      });
    } else {
      setVadThresholdScale(next.value);
    }
    setHistoryFuture(newFuture);
  }, [
    createEmptyFrames,
    historyFuture,
    scheduleVadAnalysis,
    tracks,
    vadPreset,
    vadStability,
    vadThresholdScale,
  ]);

  const handleResetProject = () => {
    if (window.confirm("プロジェクトを初期化します。\n録音データも含め、現在の作業内容はすべて失われます。\nよろしいですか？")) {
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
        setCurrentFrame(0);
        setSelection(null);
        setClipboardClip(null);
        setRecordingState(RecordingState.IDLE);
        recordingStartFrameRef.current = 0;
        recordingStartTimeRef.current = 0;
        isScrubbingRef.current = false;
    }
  };

  const handleExportAudio = async () => {
    try {
        await exportTracksToZip(tracks);
    } catch (error: any) {
        alert(error.message || "音声のエクスポートに失敗しました。");
        console.error(error);
    }
  };

  const handleExportSheetImagesCurrent = async () => {
    try {
      const sheetIndex = Math.max(0, Math.floor(viewportFirstColumn / 2));
      await exportSheetImagesToZip(tracks, FPS, { type: 'sheet', sheetIndex });
    } catch (error: any) {
      alert(error.message || 'シート画像のエクスポートに失敗しました。');
      console.error(error);
    }
  };

  const handleExportSheetImagesAll = async () => {
    try {
      await exportSheetImagesToZip(tracks, FPS, { type: 'all' });
    } catch (error: any) {
      alert(error.message || 'シート画像のエクスポートに失敗しました。');
      console.error(error);
    }
  };
  
  const handleBackgroundClick = () => {
    setSelection(null);
  };

  const handleOpenClipboardMenu = useCallback((point: { x: number; y: number }) => {
    setClipboardMenu(point);
  }, []);

  const handleCloseClipboardMenu = useCallback(() => {
    setClipboardMenu(null);
  }, []);

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

  const stopPlaybackLoop = () => {
    stopAllSources();
    cancelAnimationFrame(animationFrameRef.current);
  };

  const stopScrubSources = () => {
    scrubNodesRef.current.forEach(({ source, gain }) => {
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
    scrubNodesRef.current = [];
  };

  const playScrubPreview = (frame: number) => {
    const now = performance.now();
    if (now - scrubLastTimeRef.current < SCRUB_THROTTLE_MS) return;
    scrubLastTimeRef.current = now;

    const audibleTracks = tracks.filter((track) => track.audioBuffer && !track.isMuted);
    if (audibleTracks.length === 0) {
      stopScrubSources();
      return;
    }

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    stopScrubSources();

    const offset = frame / FPS;
    const nowTime = ctx.currentTime;

    audibleTracks.forEach((track) => {
      const buffer = track.audioBuffer;
      if (!buffer) return;
      if (offset >= buffer.duration) return;
      const duration = Math.min(SCRUB_PREVIEW_SEC, buffer.duration - offset);
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
      source.start(0, offset, duration);
      scrubNodesRef.current.push({ source, gain });
    });
  };

  // Helper to start playback (used by both Play button and Recording start)
  const startPlayback = (startFrame: number, mode: RecordingState) => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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

    const updateFrame = () => {
      if (!audioContextRef.current) return;
      const currentTime = audioContextRef.current.currentTime;
      const elapsed = currentTime - startTimeRef.current;
      const frame = Math.floor(elapsed * FPS);
      
      // Auto-stop logic
      // If we are just PLAYING, stop when audio ends.
      // If we are RECORDING, do NOT stop when audio ends (continue until user stops).
      if (mode === RecordingState.PLAYING && currentTime >= expectedEndTime) {
        stopPlaybackLoop();
        const endFrame = Math.max(0, Math.min(maxFrames - 1, Math.floor(maxDuration * FPS) - 1));
        setCurrentFrame(endFrame);
        setRecordingState(RecordingState.IDLE);
        return;
      }

      // Update frame if state matches or if we are recording (even if audio finished)
      // Note: We check the ref or current state. Since this is a closure, we need to be careful.
      // However, we'll rely on the animation frame cancellation to stop this loop.
      setCurrentFrame(frame);
      animationFrameRef.current = requestAnimationFrame(updateFrame);
    };
    
    animationFrameRef.current = requestAnimationFrame(updateFrame);
  };

  const stopVuMeter = () => {
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
    setInputRms(0);
  };

  const startVuMeter = (stream: MediaStream) => {
    stopVuMeter();

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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
      setInputRms((prev) => prev * 0.8 + rms * 0.2);
      vuAnimationFrameRef.current = requestAnimationFrame(tick);
    };

    vuAnimationFrameRef.current = requestAnimationFrame(tick);
  };

  const startRecordingWithStream = async (stream: MediaStream) => {
    // Ensure context is running first for better sync
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    stopScrubSources();
    isScrubbingRef.current = false;
    startVuMeter(stream);

    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : undefined;

    mediaRecorderRef.current = new MediaRecorder(stream, options);
    audioChunksRef.current = [];

    // Mark the frame where recording started (Punch-in support)
    recordingStartFrameRef.current = currentFrame;
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
        setRecordingState(RecordingState.IDLE);
        return;
      }

      if (audioChunksRef.current.length === 0 || (audioChunksRef.current.length === 1 && audioChunksRef.current[0].size === 0)) {
        console.warn("Recording was empty.");
        stopVuMeter();
        stopAllSources();
        cancelAnimationFrame(animationFrameRef.current);
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
    };

    // Start Recording
    mediaRecorderRef.current.start();
    setRecordingState(RecordingState.RECORDING);

    // Start Playback from CURRENT frame (not 0) if enabled
    if (playWhileRecording) {
      startPlayback(currentFrame, RecordingState.RECORDING);
    } else {
      // If not playing back, we still need to advance the frame counter for visual feedback
      // Adjust start time relative to current frame
      const offsetTime = currentFrame / FPS;
      startTimeRef.current = (Date.now() / 1000) - offsetTime;

      const updateFrameSimple = () => {
        const elapsed = (Date.now() / 1000) - startTimeRef.current;
        setCurrentFrame(Math.floor(elapsed * FPS));
        animationFrameRef.current = requestAnimationFrame(updateFrameSimple);
      };
      animationFrameRef.current = requestAnimationFrame(updateFrameSimple);
    }
  };

  const handleStartRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("お使いのブラウザは録音機能をサポートしていません。");
      return;
    }

    try {
      pendingRecordStartRef.current = true;
      const stream = await ensureMicReady();
      if (!pendingRecordStartRef.current) return;
      await startRecordingWithStream(stream);
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      
      if (err.name === 'NotFoundError' || err.message?.includes('device not found')) {
        alert("マイクが見つかりませんでした。マイクが接続されていることを確認してください。");
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("マイクの使用が許可されていません。ブラウザの設定を確認してください。");
      } else if (err.name === 'NotReadableError') {
        alert("マイクにアクセスできません。他のアプリが使用中の可能性があります。");
      } else {
        alert("録音の開始に失敗しました。");
      }
    } finally {
      pendingRecordStartRef.current = false;
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && recordingState === RecordingState.RECORDING) {
      stopVuMeter();
      mediaRecorderRef.current.stop();
      // State change to PROCESSING happens in onstop
      setRecordingState(RecordingState.PROCESSING);
    }
  };

  const loadAudioBlobToTrack = async (blob: Blob, trackId: string, insertAtFrame: number = 0) => {
    try {
      if (blob.size === 0) return; // Skip empty
      saveToHistory(); // Save before loading new audio

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
         audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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
      updateTrack(trackId, {
        audioBuffer: finalBuffer,
        frames: createEmptyFrames(finalBuffer),
      });
      scheduleVadAnalysis(trackId, finalBuffer, tuning);

      setRecordingState(RecordingState.IDLE);
      // Do not reset current frame to 0, let user stay where they are or seek manually
      // setCurrentFrame(0); 
      setSelection(null);
    } catch (e: any) {
      console.error("Error loading audio blob:", e);
      // More user friendly error
      if (e.message?.includes('Decode error')) {
         alert("音声データのデコードに失敗しました。録音が短すぎるか、ブラウザが対応していない形式の可能性があります。");
      } else {
         alert("音声ファイルの読み込みに失敗しました。");
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

  const getProjectSampleRate = (): number => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') return audioContextRef.current.sampleRate;
    return tracks.find((t) => t.audioBuffer)?.audioBuffer?.sampleRate ?? 48000;
  };

  const getNormalizedSelection = (): { startFrame: number; endFrame: number } | null => {
    if (!selection) return null;
    const startFrame = Math.max(0, Math.floor(Math.min(selection.startFrame, selection.endFrame)));
    const endFrame = Math.max(startFrame, Math.floor(Math.max(selection.startFrame, selection.endFrame)));
    return { startFrame, endFrame };
  };

  const handleCut = async () => {
    const range = getNormalizedSelection();
    if (!range) return;

    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();

      const projectSampleRate = getProjectSampleRate();
      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);

      const nextClipboard: ClipboardClip = {
        kind: editTarget === 'all' ? 'all' : 'single',
        byTrackId: {},
      };

      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
      const pendingVad: { id: string; buffer: AudioBuffer }[] = [];

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id)) return track;

        nextClipboard.byTrackId[track.id] = extractAudioRangePadded(track.audioBuffer, range.startFrame, range.endFrame, FPS, {
          sampleRate: track.audioBuffer?.sampleRate ?? projectSampleRate,
          numberOfChannels: track.audioBuffer?.numberOfChannels ?? 1,
        });

        if (!track.audioBuffer) return track;

        const { newBuffer } = cutAudioRangeWithSilence(track.audioBuffer, range.startFrame, range.endFrame, FPS);
        pendingVad.push({ id: track.id, buffer: newBuffer });
        return {
          ...track,
          audioBuffer: newBuffer,
          frames: createEmptyFrames(newBuffer),
        };
      });

      setTracks(nextTracks);
      pendingVad.forEach(({ id, buffer }) => scheduleVadAnalysis(id, buffer, tuning));
      setClipboardClip(nextClipboard);
      setSelection(null);
    } catch (error) {
      console.error('Cut failed:', error);
      alert('切り取り操作に失敗しました。');
    }
  };

  const handleDeleteSelection = async () => {
    const range = getNormalizedSelection();
    if (!range) return;

    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);

      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
      const pendingVad: { id: string; buffer: AudioBuffer }[] = [];

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id) || !track.audioBuffer) return track;

        const newBuffer = deleteAudioRangeRipple(track.audioBuffer, range.startFrame, range.endFrame, FPS);
        pendingVad.push({ id: track.id, buffer: newBuffer });
        return { ...track, audioBuffer: newBuffer, frames: createEmptyFrames(newBuffer) };
      });

      setTracks(nextTracks);
      pendingVad.forEach(({ id, buffer }) => scheduleVadAnalysis(id, buffer, tuning));
      setSelection(null);
      setCurrentFrame(range.startFrame);
    } catch (error) {
      console.error('Delete failed:', error);
      alert('削除操作に失敗しました。');
    }
  };

  const handlePasteInsert = async () => {
    if (!clipboardClip) return;
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);

      if (editTarget === 'all') {
        if (clipboardClip.kind !== 'all') {
          alert('全トラック貼り付けには、全トラックの切り取りクリップが必要です。');
          return;
        }

        const missing = tracks.find((t) => !clipboardClip.byTrackId[t.id]);
        if (missing) {
          alert('クリップデータが不足しています。もう一度切り取りしてください。');
          return;
        }

        const pendingVad: { id: string; buffer: AudioBuffer }[] = [];
        const nextTracks = tracks.map((track) => {
          const clip = clipboardClip.byTrackId[track.id];
          const newBuffer = insertAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
          pendingVad.push({ id: track.id, buffer: newBuffer });
          return { ...track, audioBuffer: newBuffer, frames: createEmptyFrames(newBuffer) };
        });
        setTracks(nextTracks);
        pendingVad.forEach(({ id, buffer }) => scheduleVadAnalysis(id, buffer, tuning));
      } else {
        const clip = clipboardClip.byTrackId[editTarget];
        if (!clip) {
          alert('対象トラックのクリップがありません。');
          return;
        }

        const nextTracks = tracks.map((track) => {
          if (track.id !== editTarget) return track;
          const newBuffer = insertAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
          return { ...track, audioBuffer: newBuffer, frames: createEmptyFrames(newBuffer) };
        });
        setTracks(nextTracks);
        const updatedTrack = nextTracks.find((track) => track.id === editTarget);
        if (updatedTrack?.audioBuffer) {
          scheduleVadAnalysis(editTarget, updatedTrack.audioBuffer, tuning);
        }
      }

      setSelection(null);
    } catch (error) {
      console.error('Paste insert failed:', error);
      alert('貼り付け（挿入）に失敗しました。');
    }
  };

  const handlePasteOverwrite = async () => {
    if (!clipboardClip) return;
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);

      if (editTarget === 'all') {
        if (clipboardClip.kind !== 'all') {
          alert('全トラック貼り付けには、全トラックの切り取りクリップが必要です。');
          return;
        }

        const missing = tracks.find((t) => !clipboardClip.byTrackId[t.id]);
        if (missing) {
          alert('クリップデータが不足しています。もう一度切り取りしてください。');
          return;
        }

        const pendingVad: { id: string; buffer: AudioBuffer }[] = [];
        const nextTracks = tracks.map((track) => {
          const clip = clipboardClip.byTrackId[track.id];
          const newBuffer = overwriteAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
          pendingVad.push({ id: track.id, buffer: newBuffer });
          return { ...track, audioBuffer: newBuffer, frames: createEmptyFrames(newBuffer) };
        });
        setTracks(nextTracks);
        pendingVad.forEach(({ id, buffer }) => scheduleVadAnalysis(id, buffer, tuning));
      } else {
        const clip = clipboardClip.byTrackId[editTarget];
        if (!clip) {
          alert('対象トラックのクリップがありません。');
          return;
        }

        const nextTracks = tracks.map((track) => {
          if (track.id !== editTarget) return track;
          const newBuffer = overwriteAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
          return { ...track, audioBuffer: newBuffer, frames: createEmptyFrames(newBuffer) };
        });
        setTracks(nextTracks);
        const updatedTrack = nextTracks.find((track) => track.id === editTarget);
        if (updatedTrack?.audioBuffer) {
          scheduleVadAnalysis(editTarget, updatedTrack.audioBuffer, tuning);
        }
      }

      setSelection(null);
    } catch (error) {
      console.error('Paste overwrite failed:', error);
      alert('貼り付け（上書き）に失敗しました。');
    }
  };

  const handleInsertOneFrame = async () => {
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const projectSampleRate = getProjectSampleRate();

      const targetIds = editTarget === 'all' ? tracks.map((t) => t.id) : [editTarget];
      const targetSet = new Set(targetIds);

      const tuning = getVadTuning(vadPreset, vadStability, vadThresholdScale);
      const pendingVad: { id: string; buffer: AudioBuffer }[] = [];

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id)) return track;
        const newBuffer = insertSilenceFramesAtFrame(track.audioBuffer, currentFrame, 1, FPS, {
          sampleRate: track.audioBuffer?.sampleRate ?? projectSampleRate,
          numberOfChannels: track.audioBuffer?.numberOfChannels ?? 1,
        });
        pendingVad.push({ id: track.id, buffer: newBuffer });
        return { ...track, audioBuffer: newBuffer, frames: createEmptyFrames(newBuffer) };
      });

      setTracks(nextTracks);
      pendingVad.forEach(({ id, buffer }) => scheduleVadAnalysis(id, buffer, tuning));
      setCurrentFrame((prev) => prev + 1);
    } catch (error) {
      console.error('Insert 1f failed:', error);
      alert('+1f 挿入に失敗しました。');
    }
  };

  // --- Playback Control ---

  const handlePlay = () => {
    const hasAudio = tracks.some(t => t.audioBuffer !== null);
    if (!hasAudio) return;

    stopScrubSources();
    isScrubbingRef.current = false;

    const endFrame = Math.max(0, maxFrames - 1);
    const startFrame = currentFrame >= endFrame ? 0 : currentFrame;
    if (startFrame !== currentFrame) {
      setCurrentFrame(startFrame);
    }

    setRecordingState(RecordingState.PLAYING);
    startPlayback(startFrame, RecordingState.PLAYING);
  };

  const stopAllSources = () => {
    sourceNodesRef.current.forEach(({ source, gain }) => {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    });
    sourceNodesRef.current.clear();
  };

  const stopMicStream = useCallback(() => {
    const stream = micStreamRef.current;
    pendingRecordStartRef.current = false;
    micPreparePromiseRef.current = null;
    setIsMicPreparing(false);
    setIsMicReady(false);
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  }, []);

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
    const prepare = navigator.mediaDevices.getUserMedia({ audio: true })
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

  const handlePause = () => {
    stopPlaybackLoop();
    setRecordingState(RecordingState.PAUSED);
  };

  const handleFrameTap = (frame: number) => {
    const nextFrame = Math.max(0, Math.floor(frame));

    if (recordingState === RecordingState.PLAYING) {
      handlePause();
    }

    setCurrentFrame(nextFrame);
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

  const handleSelectionChange = (range: SelectionRange | null) => {
    setSelection(range);
  };

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

  const handleScrubStart = (frame: number) => {
    if (recordingState === RecordingState.RECORDING || recordingState === RecordingState.PROCESSING) return;
    if (recordingState === RecordingState.PLAYING) handlePause();
    isScrubbingRef.current = true;
    scrubLastTimeRef.current = 0;
    const nextFrame = Math.max(0, Math.floor(frame));
    setCurrentFrame(nextFrame);
    playScrubPreview(nextFrame);
  };

  const handleScrubMove = (frame: number) => {
    if (!isScrubbingRef.current) return;
    if (recordingState === RecordingState.RECORDING || recordingState === RecordingState.PROCESSING) return;
    const nextFrame = Math.max(0, Math.floor(frame));
    setCurrentFrame(nextFrame);
    playScrubPreview(nextFrame);
  };

  const handleScrubEnd = () => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    stopScrubSources();
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

        const delta = e.key === 'ArrowUp' ? -1 : 1;
        const nextFrame = Math.max(0, currentFrameRef.current + delta);
        currentFrameRef.current = nextFrame;
        setCurrentFrame(nextFrame);
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
  ]);

  const framesPerSheet = getFramesPerSheet(FPS);
  const sheetNumber = Math.floor(currentFrame / framesPerSheet) + 1;

  const totalTimecode = formatTimecode(maxFrames, FPS);
  const hasAudio = tracks.some((t) => t.audioBuffer !== null);
  const mutedCount = tracks.filter((track) => track.isMuted).length;
  const isZoomOutDisabled = sheetZoom <= MIN_SHEET_ZOOM + 0.001;
  const isZoomInDisabled = sheetZoom >= MAX_SHEET_ZOOM - 0.001;

  const targetLabel =
    editTarget === 'all' ? '全トラック' : tracks.find((t) => t.id === editTarget)?.name ?? `Track ${editTarget}`;

  const selectionRange = getNormalizedSelection();
  const selectionCount = selectionRange ? selectionRange.endFrame - selectionRange.startFrame + 1 : 0;
  const selectionTimecode = selectionRange ? formatTimecode(selectionCount, FPS) : undefined;

  return (
    <AppShell
      top={
        <TopBar
          sheetNumber={sheetNumber}
          totalTimecode={totalTimecode}
          selectionTimecode={selectionTimecode}
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
        />
      }
      bottom={
        <TransportDock
          recordingState={recordingState}
          hasAudio={hasAudio}
          recordTrackId={recordTrackId}
          isMicReady={isMicReady}
          isMicPreparing={isMicPreparing}
          isAllTracks={editTarget === 'all'}
          onToggleAllTracks={handleToggleAllTracks}
          onInsertOneFrame={() => void handleInsertOneFrame()}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onPlay={handlePlay}
          onPause={handlePause}
        />
      }
    >
      <TimesheetViewport
        tracks={tracks}
        currentFrame={currentFrame}
        editTarget={editTarget}
        selection={selection}
        fps={FPS}
        zoom={sheetZoom}
        minZoom={MIN_SHEET_ZOOM}
        maxZoom={MAX_SHEET_ZOOM}
        isAutoScrollActive={
          recordingState === RecordingState.PLAYING || recordingState === RecordingState.RECORDING
        }
        onFrameTap={handleFrameTap}
        onBackgroundClick={handleBackgroundClick}
        onOpenContextMenu={handleOpenClipboardMenu}
        onSelectionChange={handleSelectionChange}
        onTrackSelect={handleTrackSelect}
        onScrubStart={handleScrubStart}
        onScrubMove={handleScrubMove}
        onScrubEnd={handleScrubEnd}
        onZoomChange={handleZoomChange}
        onFirstVisibleColumnChange={setViewportFirstColumn}
      />

      <EditPalette
        selectionCount={selectionCount}
        targetLabel={targetLabel}
        onCut={() => void handleCut()}
        onDelete={() => void handleDeleteSelection()}
        onClearSelection={() => {
          setSelection(null);
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
        isSileroActive={isSileroActive}
        inputRms={inputRms}
        playWhileRecording={playWhileRecording}
        onClose={() => setIsMoreOpen(false)}
        onExportAudio={() => void handleExportAudio()}
        onExportSheetImagesCurrent={() => void handleExportSheetImagesCurrent()}
        onExportSheetImagesAll={() => void handleExportSheetImagesAll()}
        onFileUpload={handleFileUpload}
        onChangeVadPreset={setVadPreset}
        onChangeVadStability={handleVadStabilityChange}
        onToggleVadAuto={handleToggleVadAuto}
        onChangeVadThresholdScale={handleVadThresholdScaleChange}
        onCommitVadThresholdScale={commitVadThresholdHistory}
        onTogglePlayWhileRecording={() => setPlayWhileRecording((prev) => !prev)}
      />

      <HelpSheet isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      <TrackMuteMenu
        isOpen={muteMenu !== null}
        position={muteMenu}
        tracks={tracks}
        onToggleTrack={toggleTrackMute}
        onClose={handleCloseMuteMenu}
      />

      <ClipboardMenu
        isOpen={clipboardMenu !== null}
        position={clipboardMenu}
        canPaste={clipboardClip !== null}
        onPasteInsert={() => void handlePasteInsert()}
        onPasteOverwrite={() => void handlePasteOverwrite()}
        onClearClipboard={() => setClipboardClip(null)}
        onClose={handleCloseClipboardMenu}
      />
    </AppShell>
  );
}
