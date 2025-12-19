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
import { analyzeAudioBufferWithVad, getVadTuning, VadPreset } from './services/vad';
import { exportSheetImagesToZip } from './services/sheetImageExporter';
import { TimesheetViewport } from './components/TimesheetViewport';
import { AppShell } from './components/AppShell';
import { EditPalette } from './components/EditPalette';
import { MoreSheet } from './components/MoreSheet';
import { TopBar } from './components/TopBar';
import { TransportDock } from './components/TransportDock';
import { useViewportHeight } from './hooks/useViewportHeight';
import { RecordingState, Track } from './types';
import { ClipboardClip, EditTarget, SelectionRange } from './domain/editTypes';
import { DEFAULT_FPS, getFramesPerSheet } from './domain/timesheet';
import { formatTimecode } from './domain/timecode';

const FPS = DEFAULT_FPS;

// Use a factory function to ensure fresh references on reset
const createInitialTracks = (): Track[] => [
  { id: '1', name: 'Track 1', color: 'blue', audioBuffer: null, frames: [], isVisible: true, isMuted: false },
  { id: '2', name: 'Track 2', color: 'red', audioBuffer: null, frames: [], isVisible: true, isMuted: false },
  { id: '3', name: 'Track 3', color: 'green', audioBuffer: null, frames: [], isVisible: true, isMuted: false },
];

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
  const [historyPast, setHistoryPast] = useState<Track[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<Track[][]>([]);

  // Clipboard State
  const [clipboardClip, setClipboardClip] = useState<ClipboardClip | null>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [vadPreset, setVadPreset] = useState<VadPreset>('normal');
  const [vadStability, setVadStability] = useState(0.6);
  const [playWhileRecording, setPlayWhileRecording] = useState(true);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [inputRms, setInputRms] = useState(0);
  const [viewportFirstColumn, setViewportFirstColumn] = useState(0);
  
  // Selection State
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [selectionDraftStartFrame, setSelectionDraftStartFrame] = useState<number | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartFrameRef = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);

  const vuAnalyserRef = useRef<AnalyserNode | null>(null);
  const vuSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vuAnimationFrameRef = useRef<number>(0);
  
  // Store source nodes for each track for mixed playback
  const sourceNodesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

  useViewportHeight();

  // Stats (Calculate total max duration across all tracks)
  const maxFrames = Math.max(0, ...tracks.map(t => t.frames.length));

  // Initialize Audio Context Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllSources();
      stopVuMeter();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // Re-process when VAD settings change
  useEffect(() => {
    // Note: VAD settings changes usually don't need undo history as they are non-destructive view changes,
    // but here we modify the derived 'frames' property. We won't push to history for VAD調整
    // to avoid spamming the undo stack.
    const tuning = getVadTuning(vadPreset, vadStability);
    setTracks((prevTracks) =>
      prevTracks.map((track) =>
        track.audioBuffer ? { ...track, frames: analyzeAudioBufferWithVad(track.audioBuffer, FPS, tuning) } : { ...track, frames: [] }
      )
    );
  }, [vadPreset, vadStability]);

  // --- History Management ---
  const HISTORY_LIMIT = 30;

  const saveToHistory = useCallback(() => {
    setHistoryPast(prev => [...prev.slice(-(HISTORY_LIMIT - 1)), tracks]);
    setHistoryFuture([]); // Clear future on new action
  }, [tracks]);

  const handleUndo = useCallback(() => {
    if (historyPast.length === 0) return;
    
    const previous = historyPast[historyPast.length - 1];
    const newPast = historyPast.slice(0, -1);
    
    setHistoryFuture(prev => [tracks, ...prev]);
    setTracks(
      previous.map((t) =>
        t.audioBuffer
          ? { ...t, frames: analyzeAudioBufferWithVad(t.audioBuffer, FPS, getVadTuning(vadPreset, vadStability)) }
          : { ...t, frames: [] }
      )
    );
    setHistoryPast(newPast);
    
    // Reset selection to avoid ghost selections
    setSelection(null);
    setSelectionDraftStartFrame(null);
  }, [historyPast, tracks, vadPreset, vadStability]);

  const handleRedo = useCallback(() => {
    if (historyFuture.length === 0) return;

    const next = historyFuture[0];
    const newFuture = historyFuture.slice(1);

    setHistoryPast(prev => [...prev, tracks]);
    setTracks(
      next.map((t) =>
        t.audioBuffer
          ? { ...t, frames: analyzeAudioBufferWithVad(t.audioBuffer, FPS, getVadTuning(vadPreset, vadStability)) }
          : { ...t, frames: [] }
      )
    );
    setHistoryFuture(newFuture);

    setSelection(null);
    setSelectionDraftStartFrame(null);
  }, [historyFuture, tracks, vadPreset, vadStability]);

  const handleResetProject = () => {
    if (window.confirm("プロジェクトを初期化します。\n録音データも含め、現在の作業内容はすべて失われます。\nよろしいですか？")) {
        // Stop playback/recording first
        stopAllSources();
        stopVuMeter();
        cancelAnimationFrame(animationFrameRef.current);
        
        // Reset all states
        setTracks(createInitialTracks());
        setHistoryPast([]);
        setHistoryFuture([]);
        setRecordTrackId('1');
        setEditTarget('1');
        setCurrentFrame(0);
        setSelection(null);
        setSelectionDraftStartFrame(null);
        setIsSelectionMode(false);
        setClipboardClip(null);
        setRecordingState(RecordingState.IDLE);
        recordingStartFrameRef.current = 0;
        recordingStartTimeRef.current = 0;
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
    setSelectionDraftStartFrame(null);
  };


  const updateTrack = (trackId: string, updates: Partial<Track>) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t));
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

    const offsetTime = startFrame / FPS;
    let maxDuration = 0;

    // Create sources for all tracks
    tracks.forEach(track => {
      // During recording, we might want to mute the active track to avoid doubling,
      // but usually for overdubs you might want to hear what was there (if overwriting) or not.
      // For now, we respect the mute flag.
      if (track.audioBuffer && !track.isMuted) {
        const source = ctx.createBufferSource();
        source.buffer = track.audioBuffer;
        source.connect(ctx.destination);
        
        const duration = source.buffer?.duration || 0;
        if (duration > maxDuration) maxDuration = duration;

        if (offsetTime < duration) {
          source.start(0, offsetTime);
          sourceNodesRef.current.set(track.id, source);
        }
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
         handlePause();
         setCurrentFrame(0);
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

  const handleStartRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("お使いのブラウザは録音機能をサポートしていません。");
        return;
    }

    try {
      // Ensure context is running first for better sync
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
             stream.getTracks().forEach(track => track.stop());
             stopAllSources();
             cancelAnimationFrame(animationFrameRef.current);
             setRecordingState(RecordingState.IDLE);
             return;
        }

        if (audioChunksRef.current.length === 0 || (audioChunksRef.current.length === 1 && audioChunksRef.current[0].size === 0)) {
             console.warn("Recording was empty.");
             stopVuMeter();
             stream.getTracks().forEach(track => track.stop());
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
        // Properly stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
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

      const newFrames = analyzeAudioBufferWithVad(finalBuffer, FPS, getVadTuning(vadPreset, vadStability));
      
      updateTrack(trackId, {
        audioBuffer: finalBuffer,
        frames: newFrames
      });

      setRecordingState(RecordingState.IDLE);
      // Do not reset current frame to 0, let user stay where they are or seek manually
      // setCurrentFrame(0); 
      setSelection(null);
      setSelectionDraftStartFrame(null);
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

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id)) return track;

        nextClipboard.byTrackId[track.id] = extractAudioRangePadded(track.audioBuffer, range.startFrame, range.endFrame, FPS, {
          sampleRate: track.audioBuffer?.sampleRate ?? projectSampleRate,
          numberOfChannels: track.audioBuffer?.numberOfChannels ?? 1,
        });

        if (!track.audioBuffer) return track;

        const { newBuffer } = cutAudioRangeWithSilence(track.audioBuffer, range.startFrame, range.endFrame, FPS);
        return {
          ...track,
          audioBuffer: newBuffer,
          frames: analyzeAudioBufferWithVad(newBuffer, FPS, getVadTuning(vadPreset, vadStability)),
        };
      });

      setTracks(nextTracks);
      setClipboardClip(nextClipboard);
      setSelection(null);
      setSelectionDraftStartFrame(null);
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

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id) || !track.audioBuffer) return track;

        const newBuffer = deleteAudioRangeRipple(track.audioBuffer, range.startFrame, range.endFrame, FPS);
        return { ...track, audioBuffer: newBuffer, frames: analyzeAudioBufferWithVad(newBuffer, FPS, getVadTuning(vadPreset, vadStability)) };
      });

      setTracks(nextTracks);
      setSelection(null);
      setSelectionDraftStartFrame(null);
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

        setTracks(
          tracks.map((track) => {
            const clip = clipboardClip.byTrackId[track.id];
            const newBuffer = insertAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
            return { ...track, audioBuffer: newBuffer, frames: analyzeAudioBufferWithVad(newBuffer, FPS, getVadTuning(vadPreset, vadStability)) };
          })
        );
      } else {
        const clip = clipboardClip.byTrackId[editTarget];
        if (!clip) {
          alert('対象トラックのクリップがありません。');
          return;
        }

        setTracks(
          tracks.map((track) => {
            if (track.id !== editTarget) return track;
            const newBuffer = insertAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
            return { ...track, audioBuffer: newBuffer, frames: analyzeAudioBufferWithVad(newBuffer, FPS, getVadTuning(vadPreset, vadStability)) };
          })
        );
      }

      setSelection(null);
      setSelectionDraftStartFrame(null);
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

        setTracks(
          tracks.map((track) => {
            const clip = clipboardClip.byTrackId[track.id];
            const newBuffer = overwriteAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
            return { ...track, audioBuffer: newBuffer, frames: analyzeAudioBufferWithVad(newBuffer, FPS, getVadTuning(vadPreset, vadStability)) };
          })
        );
      } else {
        const clip = clipboardClip.byTrackId[editTarget];
        if (!clip) {
          alert('対象トラックのクリップがありません。');
          return;
        }

        setTracks(
          tracks.map((track) => {
            if (track.id !== editTarget) return track;
            const newBuffer = overwriteAudioAtFrame(track.audioBuffer, clip, currentFrame, FPS);
            return { ...track, audioBuffer: newBuffer, frames: analyzeAudioBufferWithVad(newBuffer, FPS, getVadTuning(vadPreset, vadStability)) };
          })
        );
      }

      setSelection(null);
      setSelectionDraftStartFrame(null);
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

      const nextTracks = tracks.map((track) => {
        if (!targetSet.has(track.id)) return track;
        const newBuffer = insertSilenceFramesAtFrame(track.audioBuffer, currentFrame, 1, FPS, {
          sampleRate: track.audioBuffer?.sampleRate ?? projectSampleRate,
          numberOfChannels: track.audioBuffer?.numberOfChannels ?? 1,
        });
        return { ...track, audioBuffer: newBuffer, frames: analyzeAudioBufferWithVad(newBuffer, FPS, getVadTuning(vadPreset, vadStability)) };
      });

      setTracks(nextTracks);
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
    
    setRecordingState(RecordingState.PLAYING);
    startPlayback(currentFrame, RecordingState.PLAYING);
  };

  const stopAllSources = () => {
    sourceNodesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
      source.disconnect();
    });
    sourceNodesRef.current.clear();
  };

  const handlePause = () => {
    stopAllSources();
    cancelAnimationFrame(animationFrameRef.current);
    setRecordingState(RecordingState.PAUSED);
  };

  const handleFrameTap = (frame: number) => {
    const nextFrame = Math.max(0, Math.floor(frame));

    if (recordingState === RecordingState.PLAYING) {
      handlePause();
    }

    setCurrentFrame(nextFrame);

    if (!isSelectionMode) {
      setSelectionDraftStartFrame(null);
      return;
    }

    if (selectionDraftStartFrame === null) {
      setSelectionDraftStartFrame(nextFrame);
      setSelection({ startFrame: nextFrame, endFrame: nextFrame });
      return;
    }

    setSelection({ startFrame: selectionDraftStartFrame, endFrame: nextFrame });
    setSelectionDraftStartFrame(null);
  };

  const handleSelectTarget = (target: EditTarget) => {
    setEditTarget(target);
    if (target !== 'all') setRecordTrackId(target);
  };

  const handleToggleSelectionMode = () => {
    setIsSelectionMode((prev) => {
      const next = !prev;
      if (prev) {
        setSelectionDraftStartFrame(null);
      }
      return next;
    });
  };

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [handleUndo, handleRedo, handleCut, handlePasteInsert, handlePasteOverwrite]);

  const framesPerSheet = getFramesPerSheet(FPS);
  const sheetNumber = Math.floor(currentFrame / framesPerSheet) + 1;

  const totalTimecode = formatTimecode(maxFrames, FPS);
  const hasAudio = tracks.some((t) => t.audioBuffer !== null);

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
          onReset={handleResetProject}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onOpenMore={() => setIsMoreOpen(true)}
        />
      }
      bottom={
        <TransportDock
          recordingState={recordingState}
          hasAudio={hasAudio}
          tracks={tracks}
          recordTrackId={recordTrackId}
          editTarget={editTarget}
          isSelectionMode={isSelectionMode}
          onSelectTarget={handleSelectTarget}
          onToggleSelectionMode={handleToggleSelectionMode}
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
        isPlaying={recordingState === RecordingState.PLAYING}
        onFrameTap={handleFrameTap}
        onBackgroundClick={handleBackgroundClick}
        onFirstVisibleColumnChange={setViewportFirstColumn}
      />

      <EditPalette
        selectionCount={selectionCount}
        targetLabel={targetLabel}
        canPaste={clipboardClip !== null}
        onCut={() => void handleCut()}
        onDelete={() => void handleDeleteSelection()}
        onClearSelection={() => {
          setSelection(null);
          setSelectionDraftStartFrame(null);
        }}
        onPasteInsert={() => void handlePasteInsert()}
        onPasteOverwrite={() => void handlePasteOverwrite()}
      />

      <MoreSheet
        isOpen={isMoreOpen}
        tracks={tracks}
        recordTrackId={recordTrackId}
        vadPreset={vadPreset}
        vadStability={vadStability}
        inputRms={inputRms}
        playWhileRecording={playWhileRecording}
        onClose={() => setIsMoreOpen(false)}
        onExportAudio={() => void handleExportAudio()}
        onExportSheetImagesCurrent={() => void handleExportSheetImagesCurrent()}
        onExportSheetImagesAll={() => void handleExportSheetImagesAll()}
        onFileUpload={handleFileUpload}
        onChangeVadPreset={setVadPreset}
        onChangeVadStability={setVadStability}
        onTogglePlayWhileRecording={() => setPlayWhileRecording((prev) => !prev)}
      />
    </AppShell>
  );
}
