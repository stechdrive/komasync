import React, { useState, useRef, useEffect, useCallback } from 'react';
import { processAudioBuffer, blobToAudioBuffer, cutAudioBuffer, extractAudioSlice, overwriteAudioBuffer } from './services/audioProcessor';
import { exportTracksToZip } from './services/audioExporter';
import { TimesheetGrid } from './components/TimesheetGrid';
import { FrameData, RecordingState, Track } from './types';
import { Mic, Upload, Play, Pause, StopCircle, RefreshCw, Volume2, FileAudio, ZoomIn, ZoomOut, Maximize, Trash2, CheckSquare, Clock, Layers, Scissors, Clipboard, Undo2, Redo2, Headphones, Download } from 'lucide-react';

const FPS = 24;

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
  const [activeTrackId, setActiveTrackId] = useState<string>('1');

  // History State for Undo/Redo
  const [historyPast, setHistoryPast] = useState<Track[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<Track[][]>([]);

  // Clipboard State
  const [clipboardBuffer, setClipboardBuffer] = useState<AudioBuffer | null>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [threshold, setThreshold] = useState(0.05);
  const [rowHeight, setRowHeight] = useState(20);
  const [playWhileRecording, setPlayWhileRecording] = useState(true);
  
  // Selection State
  const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false); // For mobile multi-selection
  const lastClickedFrameRef = useRef<number | null>(null);
  
  // Drag Selection State
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartFrame, setDragStartFrame] = useState<number | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] = useState<Set<number>>(new Set());

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartFrameRef = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);
  
  // Store source nodes for each track for mixed playback
  const sourceNodesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stats (Calculate total max duration across all tracks)
  const maxFrames = Math.max(0, ...tracks.map(t => t.frames.length));
  const durationSec = Math.floor(maxFrames / FPS);
  const durationRemFrame = maxFrames % FPS;

  // Initialize Audio Context Cleanup on unmount
  useEffect(() => {
    // Initial Auto-Fit
    handleFitToScreen();
    
    // Global pointer up to catch releases outside the grid
    const handleGlobalPointerUp = () => {
        if (isDragging) {
            handleDragSelectEnd();
        }
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('resize', handleFitToScreen);
    
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('resize', handleFitToScreen);
    };
  }, [isDragging]);

  // Re-process when threshold changes
  useEffect(() => {
    // Note: Threshold changes usually don't need undo history as they are non-destructive view changes,
    // but here we modify the derived 'frames' property. We won't push to history for threshold slider
    // to avoid spamming the undo stack.
    setTracks(prevTracks => prevTracks.map(track => {
      if (track.audioBuffer) {
        return {
          ...track,
          frames: processAudioBuffer(track.audioBuffer, threshold, FPS)
        };
      }
      return track;
    }));
  }, [threshold]);

  // --- History Management ---
  const saveToHistory = useCallback(() => {
    setHistoryPast(prev => [...prev, tracks]);
    setHistoryFuture([]); // Clear future on new action
  }, [tracks]);

  const handleUndo = useCallback(() => {
    if (historyPast.length === 0) return;
    
    const previous = historyPast[historyPast.length - 1];
    const newPast = historyPast.slice(0, -1);
    
    setHistoryFuture(prev => [tracks, ...prev]);
    setTracks(previous);
    setHistoryPast(newPast);
    
    // Reset selection to avoid ghost selections
    setSelectedFrames(new Set());
  }, [historyPast, tracks]);

  const handleRedo = useCallback(() => {
    if (historyFuture.length === 0) return;

    const next = historyFuture[0];
    const newFuture = historyFuture.slice(1);

    setHistoryPast(prev => [...prev, tracks]);
    setTracks(next);
    setHistoryFuture(newFuture);
  }, [historyFuture, tracks]);

  const handleResetProject = () => {
    if (window.confirm("プロジェクトを初期化しますか？\n現在の作業内容はすべて失われます。")) {
        // Stop playback/recording first
        stopAllSources();
        cancelAnimationFrame(animationFrameRef.current);
        
        // Reset all states
        setTracks(createInitialTracks());
        setHistoryPast([]);
        setHistoryFuture([]);
        setActiveTrackId('1');
        setCurrentFrame(0);
        setSelectedFrames(new Set());
        setClipboardBuffer(null);
        setDragStartFrame(null);
        setSelectionSnapshot(new Set());
        setRecordingState(RecordingState.IDLE);
        lastClickedFrameRef.current = null;
        recordingStartFrameRef.current = 0;
        recordingStartTimeRef.current = 0;
    }
  };

  const handleExportCSV = () => {
    if (tracks.every(t => t.frames.length === 0)) {
        alert("エクスポートするデータがありません。");
        return;
    }

    const maxLen = Math.max(...tracks.map(t => t.frames.length));
    
    // BOM for Excel compatibility (UTF-8 with BOM)
    let csvContent = "\uFEFF";
    
    // Headers: Frame No, Time (sec+koma), Track Columns...
    csvContent += "Frame,Time," + tracks.map(t => t.name.replace(/,/g, "")).join(",") + "\n";

    for (let i = 0; i < maxLen; i++) {
        const sec = Math.floor(i / FPS);
        const frm = (i % FPS) + 1; // 1-based frame count for display
        const timeStr = `${sec}+${frm}`;
        
        const row = [
            i + 1, // Global Frame Count
            timeStr
        ];

        tracks.forEach(t => {
            const frame = t.frames[i];
            // Mark with '〇' if speech (VAD active), otherwise empty
            row.push(frame?.isSpeech ? "〇" : "");
        });

        csvContent += row.join(",") + "\n";
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    link.setAttribute("download", `komasync_sheet_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportAudio = async () => {
    try {
        await exportTracksToZip(tracks);
    } catch (error: any) {
        alert(error.message || "音声のエクスポートに失敗しました。");
        console.error(error);
    }
  };
  
  const handleBackgroundClick = () => {
    if (selectedFrames.size > 0) {
      setSelectedFrames(new Set());
      lastClickedFrameRef.current = null;
    }
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
        if (((e.ctrlKey || e.metaKey) && e.key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
            e.preventDefault();
            handleRedo();
        }
        // Cut: Ctrl+X
        if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
            e.preventDefault();
            handleCut();
        }
        // Paste: Ctrl+V
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            e.preventDefault();
            handlePaste();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, tracks, selectedFrames, activeTrackId, clipboardBuffer, currentFrame]);


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
             stream.getTracks().forEach(track => track.stop());
             stopAllSources();
             cancelAnimationFrame(animationFrameRef.current);
             setRecordingState(RecordingState.IDLE);
             return;
        }

        if (audioChunksRef.current.length === 0 || (audioChunksRef.current.length === 1 && audioChunksRef.current[0].size === 0)) {
             console.warn("Recording was empty.");
             stream.getTracks().forEach(track => track.stop());
             stopAllSources();
             cancelAnimationFrame(animationFrameRef.current);
             setRecordingState(RecordingState.IDLE);
             return;
        }

        const finalMimeType = mediaRecorderRef.current?.mimeType || mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });
        
        // Pass the start frame to the loader to overwrite at correct position
        await loadAudioBlobToTrack(audioBlob, activeTrackId, recordingStartFrameRef.current);
        
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

      // 3. If track exists and we are inserting (overdubbing/punch-in)
      //    We merge the new clip into the existing buffer
      if (track) {
         let baseBuffer = track.audioBuffer;
         // If track has no buffer yet, create a silent one up to the insertion point if needed, or just use clip
         if (!baseBuffer) {
             if (insertAtFrame > 0) {
                 // Create silence up to insert point is a bit complex, simpler to just treat new clip as start
                 // But strictly, we should pad silence. 
                 // For now, 'overwriteAudioBuffer' handles expanding.
                 // We create a dummy empty buffer of length 1 to serve as base.
                 baseBuffer = audioContextRef.current.createBuffer(1, 1, audioContextRef.current.sampleRate);
             } else {
                 baseBuffer = newClipBuffer; // Just use the new one
             }
         }

         // Use overwrite logic if we have a base and we are not just replacing everything from 0 (though overwrite at 0 is also valid)
         // Note: If we just uploaded a file (File Upload), insertAtFrame is usually 0.
         // If we recorded, insertAtFrame is where we started.
         if (track.audioBuffer || insertAtFrame > 0) {
             finalBuffer = overwriteAudioBuffer(baseBuffer, newClipBuffer, insertAtFrame, FPS);
         }
      }

      const newFrames = processAudioBuffer(finalBuffer, threshold, FPS);
      
      updateTrack(trackId, {
        audioBuffer: finalBuffer,
        frames: newFrames
      });

      setRecordingState(RecordingState.IDLE);
      // Do not reset current frame to 0, let user stay where they are or seek manually
      // setCurrentFrame(0); 
      setSelectedFrames(new Set());
      lastClickedFrameRef.current = null;
      setTimeout(handleFitToScreen, 10);
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
      loadAudioBlobToTrack(file, activeTrackId, 0);
      e.target.value = ''; 
    }
  };

  // --- Audio Editing ---

  const handleCut = async () => {
    const activeTrack = tracks.find(t => t.id === activeTrackId);
    if (selectedFrames.size === 0 || !activeTrack || !activeTrack.audioBuffer) return;
    
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();

      // 1. Determine Range
      const sortedFrames: number[] = [...selectedFrames].sort((a, b) => a - b);
      const startFrame = sortedFrames[0];
      const endFrame = sortedFrames[sortedFrames.length - 1];

      // 2. Extract to Clipboard
      const clip = extractAudioSlice(activeTrack.audioBuffer, startFrame, endFrame, FPS);
      if (clip) {
          setClipboardBuffer(clip);
      }

      // 3. Delete from Track
      const newBuffer = cutAudioBuffer(activeTrack.audioBuffer, selectedFrames, FPS);
      const newFrames = processAudioBuffer(newBuffer, threshold, FPS);
      
      updateTrack(activeTrackId, {
          audioBuffer: newBuffer,
          frames: newFrames
      });

      setSelectedFrames(new Set());
      lastClickedFrameRef.current = null;
      setCurrentFrame(0);
      
    } catch (error) {
      console.error("Cut failed:", error);
      alert("カット操作に失敗しました。");
    }
  };

  const handlePaste = async () => {
    const activeTrack = tracks.find(t => t.id === activeTrackId);
    if (!clipboardBuffer || !activeTrack) return;
    
    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      
      let baseBuffer = activeTrack.audioBuffer;
      
      if (!baseBuffer) {
        if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        baseBuffer = audioContextRef.current.createBuffer(1, 1, 44100); // Dummy
      }

      // Overwrite
      const newBuffer = overwriteAudioBuffer(baseBuffer, clipboardBuffer, currentFrame, FPS);
      const newFrames = processAudioBuffer(newBuffer, threshold, FPS);
      
      updateTrack(activeTrackId, {
          audioBuffer: newBuffer,
          frames: newFrames
      });
      
    } catch (error) {
       console.error("Paste failed:", error);
       alert("ペースト操作に失敗しました。");
    }
  };

  const handleDeleteSelected = async () => {
    const activeTrack = tracks.find(t => t.id === activeTrackId);
    if (selectedFrames.size === 0 || !activeTrack || !activeTrack.audioBuffer) return;

    if (recordingState === RecordingState.PLAYING) handlePause();

    try {
      saveToHistory();
      const newBuffer = cutAudioBuffer(activeTrack.audioBuffer, selectedFrames, FPS);
      const newFrames = processAudioBuffer(newBuffer, threshold, FPS);
      updateTrack(activeTrackId, {
          audioBuffer: newBuffer,
          frames: newFrames
      });

      setSelectedFrames(new Set());
      lastClickedFrameRef.current = null;
      setCurrentFrame(0);
      setTimeout(handleFitToScreen, 10);
    } catch (error) {
      console.error("Delete failed:", error);
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

  const handleSeek = (frame: number, e: React.MouseEvent) => {
    if (recordingState === RecordingState.PLAYING) {
      handlePause();
    }

    const newSelected = new Set(selectedFrames);
    const last = lastClickedFrameRef.current;

    if (e.shiftKey && last !== null) {
      const start = Math.min(last, frame);
      const end = Math.max(last, frame);
      
      if (!e.ctrlKey && !e.metaKey) {
        newSelected.clear();
      }
      for (let i = start; i <= end; i++) newSelected.add(i);
    } else if (e.ctrlKey || e.metaKey) {
      if (newSelected.has(frame)) newSelected.delete(frame);
      else newSelected.add(frame);
      lastClickedFrameRef.current = frame;
    } else {
      newSelected.clear();
      newSelected.add(frame);
      lastClickedFrameRef.current = frame;
    }

    setSelectedFrames(newSelected);
    setCurrentFrame(frame);
  };

  // --- Drag Selection Handlers ---
  const handleDragSelectStart = (frame: number) => {
    if (!isSelectionMode) return;
    setIsDragging(true);
    setDragStartFrame(frame);
    setSelectionSnapshot(new Set(selectedFrames));
    lastClickedFrameRef.current = frame; 
    setCurrentFrame(frame);
    
    const newSet = new Set(selectedFrames);
    if (!newSet.has(frame)) {
        newSet.add(frame);
        setSelectedFrames(newSet);
    }
  };

  const handleDragSelectEnter = (frame: number) => {
    if (!isDragging || dragStartFrame === null || !isSelectionMode) return;
    const start = Math.min(dragStartFrame, frame);
    const end = Math.max(dragStartFrame, frame);
    const newSet = new Set(selectionSnapshot);
    for (let i = start; i <= end; i++) newSet.add(i);
    setSelectedFrames(newSet);
    setCurrentFrame(frame);
  };

  const handleDragSelectEnd = () => {
    setIsDragging(false);
    setDragStartFrame(null);
    setSelectionSnapshot(new Set());
  };

  const handleFitToScreen = () => {
    if (containerRef.current) {
      const containerHeight = containerRef.current.clientHeight;
      const availableForRows = containerHeight - 86;
      const isMobile = window.innerWidth < 768;
      const minHeight = isMobile ? 16 : 4; 
      const fitHeight = Math.max(minHeight, availableForRows / 72);
      setRowHeight(fitHeight);
    }
  };

  const handleZoomIn = () => setRowHeight(prev => Math.min(100, prev * 1.2));
  const handleZoomOut = () => setRowHeight(prev => Math.max(4, prev / 1.2));

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-50 text-gray-800 font-sans overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden h-10 bg-indigo-600 text-white flex items-center px-3 justify-between shrink-0 z-30 shadow-md">
            <h1 className="font-bold flex items-center gap-1 text-xs">
                <button onClick={handleResetProject} className="hover:text-indigo-200 transition-colors p-1" title="プロジェクトをリセット">
                    <RefreshCw className="w-3 h-3" />
                </button>
                 <button onClick={handleExportCSV} className="hover:text-indigo-200 transition-colors p-1" title="エクセル形式でエクスポート">
                    <Download className="w-3 h-3" />
                </button>
                 <button onClick={handleExportAudio} className="hover:text-indigo-200 transition-colors p-1" title="音声をZIPでエクスポート">
                    <FileAudio className="w-3 h-3" />
                </button>
                <span className="ml-1">KomaSync</span>
            </h1>
            <div className="flex items-center gap-2">
                 {/* Mobile Undo/Redo */}
                 <button onClick={handleUndo} disabled={historyPast.length===0} className="p-1 disabled:opacity-30"><Undo2 className="w-3 h-3" /></button>
                 <button onClick={handleRedo} disabled={historyFuture.length===0} className="p-1 disabled:opacity-30"><Redo2 className="w-3 h-3" /></button>

                 <div className="flex flex-col items-end leading-none mr-1 ml-1">
                    <span className="text-[8px] opacity-70 tracking-tighter">TOTAL</span>
                    <span className="text-[10px] font-mono font-bold">{durationSec}s+{durationRemFrame}</span>
                 </div>
                 <div className="font-mono text-xs bg-indigo-700 px-2 py-0.5 rounded border border-indigo-500 min-w-[50px] text-center">
                    {currentFrame}
                 </div>
            </div>
        </div>

        {/* Main Content: Timesheet */}
        <div 
            ref={containerRef}
            className="flex-1 flex flex-col h-full overflow-hidden bg-gray-200 relative order-1 md:order-2"
        >
            <TimesheetGrid 
              tracks={tracks}
              activeTrackId={activeTrackId}
              currentFrame={currentFrame} 
              selectedFrames={selectedFrames}
              fps={FPS}
              rowHeight={rowHeight}
              onSeek={handleSeek}
              isSelectionMode={isSelectionMode}
              onDragStart={handleDragSelectStart}
              onDragEnter={handleDragSelectEnter}
              onDragEnd={handleDragSelectEnd}
              onBackgroundClick={handleBackgroundClick}
            />
        </div>

        {/* Controls */}
        <div className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-r border-gray-200 z-20 order-2 md:order-1 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.1)] md:shadow-none safe-area-bottom flex flex-col">
            {/* Desktop Header */}
            <div className="hidden md:flex p-6 border-b border-gray-200 bg-indigo-600 text-white flex-col">
                 <div className="flex justify-between items-start">
                    <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                         <div className="flex items-center gap-1">
                            <button onClick={handleResetProject} className="hover:text-indigo-200 transition-colors p-1 rounded hover:bg-indigo-700" title="プロジェクトをリセット">
                                <RefreshCw className="w-5 h-5" />
                            </button>
                             <button onClick={handleExportCSV} className="hover:text-indigo-200 transition-colors p-1 rounded hover:bg-indigo-700" title="エクセル形式でエクスポート">
                                <Download className="w-5 h-5" />
                            </button>
                            <button onClick={handleExportAudio} className="hover:text-indigo-200 transition-colors p-1 rounded hover:bg-indigo-700" title="音声をZIPでエクスポート">
                                <FileAudio className="w-5 h-5" />
                            </button>
                         </div>
                        KomaSync
                    </h1>
                    {/* Desktop Undo/Redo */}
                    <div className="flex gap-1 bg-indigo-700 rounded-lg p-1">
                        <button onClick={handleUndo} disabled={historyPast.length===0} className="p-1.5 hover:bg-indigo-600 rounded disabled:opacity-30 text-indigo-100"><Undo2 className="w-4 h-4" /></button>
                        <div className="w-px bg-indigo-500 my-1"></div>
                        <button onClick={handleRedo} disabled={historyFuture.length===0} className="p-1.5 hover:bg-indigo-600 rounded disabled:opacity-30 text-indigo-100"><Redo2 className="w-4 h-4" /></button>
                    </div>
                 </div>

                 <p className="text-indigo-100 text-xs mt-2">音声検出タイムシート生成</p>

                 <div className="mt-4 bg-indigo-700/40 rounded-lg p-3 border border-indigo-500/30">
                    <div className="text-indigo-200 text-xs mb-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> 合計デュレーション
                    </div>
                    <div className="text-white font-mono text-xl font-bold flex items-baseline gap-2">
                        {durationSec}<span className="text-sm font-normal text-indigo-300">秒</span> 
                        + {durationRemFrame}<span className="text-sm font-normal text-indigo-300">コマ</span>
                    </div>
                 </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 md:p-6 space-y-2 md:space-y-6">
                
                {/* Mobile Toolbar */}
                <div className="flex md:hidden items-center justify-between gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-1 shrink-0">
                         <button onClick={handleZoomOut} className="p-1 text-gray-500"><ZoomOut className="w-4 h-4" /></button>
                         <button onClick={handleFitToScreen} className="p-1 text-indigo-600"><Maximize className="w-3 h-3" /></button>
                         <button onClick={handleZoomIn} className="p-1 text-gray-500"><ZoomIn className="w-4 h-4" /></button>
                    </div>
                    <div className="w-px h-4 bg-gray-300"></div>
                    <div className="flex items-center flex-1 min-w-0 gap-1">
                        <button 
                            onClick={() => setPlayWhileRecording(!playWhileRecording)}
                            className={`p-1 shrink-0 rounded transition-colors ${playWhileRecording ? 'text-indigo-600 bg-indigo-100' : 'text-gray-400'}`}
                        >
                            <Headphones className="w-3 h-3" />
                        </button>
                        <input 
                            type="range" 
                            min="0.01" 
                            max="0.5" 
                            step="0.01" 
                            value={threshold} 
                            onChange={(e) => setThreshold(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                    </div>
                    <div className="w-px h-4 bg-gray-300"></div>
                    <button 
                        onClick={() => setIsSelectionMode(!isSelectionMode)}
                        className={`p-1.5 rounded transition-colors ${
                            isSelectionMode 
                            ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-300' 
                            : 'text-gray-400 hover:bg-gray-200'
                        }`}
                    >
                        <CheckSquare className="w-4 h-4" />
                    </button>
                </div>

                {/* Desktop: Frame Counter & Zoom */}
                <div className="hidden md:flex items-center justify-between gap-2">
                     <div className="font-mono text-lg text-gray-700 bg-gray-50 px-2 py-1 rounded border border-gray-200 min-w-[80px] text-center">
                        {currentFrame} <span className="text-xs text-gray-400">frm</span>
                     </div>
                     <div className="flex items-center bg-gray-50 rounded-lg border border-gray-200 p-0.5">
                        <button onClick={handleZoomOut} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><ZoomOut className="w-4 h-4" /></button>
                        <div className="w-px h-4 bg-gray-300 mx-0.5"></div>
                        <button onClick={handleFitToScreen} className="p-1.5 hover:bg-gray-200 rounded text-indigo-600"><Maximize className="w-4 h-4" /></button>
                        <div className="w-px h-4 bg-gray-300 mx-0.5"></div>
                        <button onClick={handleZoomIn} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><ZoomIn className="w-4 h-4" /></button>
                     </div>
                </div>

                {/* Desktop: Threshold & Settings */}
                <div className="hidden md:flex flex-col gap-2">
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <Volume2 className="w-4 h-4 text-gray-400 shrink-0" />
                        <input 
                            type="range" 
                            min="0.01" 
                            max="0.5" 
                            step="0.01" 
                            value={threshold} 
                            onChange={(e) => setThreshold(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                    </div>
                    <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 text-xs text-gray-600">
                            <Headphones className="w-4 h-4" /> 録音中の再生
                        </div>
                        <button 
                            onClick={() => setPlayWhileRecording(!playWhileRecording)}
                            className={`w-8 h-4 rounded-full transition-colors relative ${playWhileRecording ? 'bg-indigo-600' : 'bg-gray-300'}`}
                        >
                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${playWhileRecording ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>

                {/* Selection / Clipboard Actions */}
                <div className="space-y-2">
                    {/* Clipboard Paste Action */}
                    {clipboardBuffer && (
                         <button 
                            onClick={handlePaste}
                            className="w-full flex items-center justify-center gap-2 bg-indigo-50 p-2 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors"
                         >
                            <Clipboard className="w-4 h-4" />
                            <span className="text-xs font-bold">現在のコマにペースト ({currentFrame})</span>
                         </button>
                    )}

                    {/* Selection Actions */}
                    {selectedFrames.size > 0 && (
                      <div className="flex flex-col gap-2 bg-blue-50 p-2 rounded-lg border border-blue-200 animate-in fade-in slide-in-from-bottom-2">
                          <div className="flex justify-between items-center mb-1">
                              <div className="text-xs text-blue-700 font-bold">{selectedFrames.size}コマ選択中</div>
                              <div className="text-[10px] text-blue-500">{tracks.find(t=>t.id===activeTrackId)?.name}</div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-1">
                             <button 
                                onClick={handleCut}
                                className="flex items-center justify-center gap-1 bg-white hover:bg-blue-100 text-blue-700 px-2 py-1.5 rounded border border-blue-100 text-xs font-bold shadow-sm"
                                title="カット (Ctrl+X)"
                              >
                                <Scissors className="w-3 h-3" /> カット
                              </button>
                              <button 
                                onClick={handleDeleteSelected}
                                className="flex items-center justify-center gap-1 bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1.5 rounded border border-red-200 text-xs font-bold shadow-sm"
                              >
                                <Trash2 className="w-3 h-3" /> 削除
                              </button>
                          </div>
                          <div className="text-[10px] text-center text-blue-400 mt-0.5">カットして移動先にペースト可能</div>
                      </div>
                    )}
                </div>
                
                {/* Track Switcher */}
                <div className="flex bg-gray-100 p-1 rounded-lg gap-1">
                    {tracks.map(track => {
                        const isActive = activeTrackId === track.id;
                        return (
                            <button
                                key={track.id}
                                onClick={() => setActiveTrackId(track.id)}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-bold transition-all border-b-2 ${
                                    isActive 
                                    ? `bg-white shadow-sm text-${track.color}-700 border-${track.color}-500` 
                                    : 'text-gray-400 border-transparent hover:bg-gray-200 hover:text-gray-600'
                                }`}
                            >
                                <div className={`w-2 h-2 rounded-full ${isActive ? `bg-${track.color}-500` : `bg-${track.color}-300 grayscale opacity-50`}`} />
                                {track.name}
                            </button>
                        )
                    })}
                </div>

                {/* Main Actions */}
                <div className="grid grid-cols-3 gap-1 md:grid-cols-1 md:gap-4">
                    <button 
                        onClick={recordingState === RecordingState.RECORDING ? handleStopRecording : handleStartRecording}
                        className={`flex flex-row md:flex-row items-center justify-center p-2 md:p-4 rounded-lg md:rounded-xl border transition-all active:scale-95 ${
                        recordingState === RecordingState.RECORDING 
                            ? 'border-red-500 bg-red-50 text-red-600 animate-pulse' 
                            : 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-600'
                        }`}
                    >
                        {recordingState === RecordingState.RECORDING ? 
                            <StopCircle className="w-4 h-4 md:w-5 md:h-5 md:mr-2" /> : 
                            <Mic className="w-4 h-4 md:w-5 md:h-5 md:mr-2" />
                        }
                        <div className="flex flex-col items-start ml-1 md:ml-2">
                            <span className="text-xs md:text-sm font-bold leading-none">
                                {recordingState === RecordingState.RECORDING ? "停止" : "録音"}
                            </span>
                            <span className="text-[8px] md:text-[10px] opacity-70 leading-none mt-0.5">
                                Target: {tracks.find(t=>t.id===activeTrackId)?.name}
                            </span>
                        </div>
                    </button>

                    <label className="flex flex-row md:flex-row items-center justify-center p-2 md:p-4 rounded-lg md:rounded-xl border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-600 cursor-pointer transition-all active:scale-95">
                        <Upload className="w-4 h-4 md:w-5 md:h-5 md:mr-2" />
                        <div className="flex flex-col items-start ml-1 md:ml-2">
                            <span className="text-xs md:text-sm font-bold leading-none">UP</span>
                            <span className="text-[8px] md:text-[10px] opacity-70 leading-none mt-0.5">
                                Target: {tracks.find(t=>t.id===activeTrackId)?.name}
                            </span>
                        </div>
                        <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                    </label>

                     <button 
                        onClick={recordingState === RecordingState.PLAYING ? handlePause : handlePlay}
                        disabled={tracks.every(t => t.audioBuffer === null)}
                        className={`flex flex-row md:flex-row items-center justify-center p-2 md:p-4 rounded-lg md:rounded-xl border transition-all active:scale-95 ${
                             recordingState === RecordingState.PLAYING
                             ? 'bg-amber-100 border-amber-400 text-amber-700'
                             : 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                        } disabled:opacity-50 disabled:bg-gray-200 disabled:border-gray-200 disabled:text-gray-400 disabled:shadow-none`}
                     >
                        {recordingState === RecordingState.PLAYING ? (
                             <Pause className="w-4 h-4 md:w-5 md:h-5 md:mr-2" />
                        ) : (
                             <Play className="w-4 h-4 md:w-5 md:h-5 md:mr-2" />
                        )}
                        <span className="text-xs md:text-sm font-bold ml-1 md:ml-0">
                            {recordingState === RecordingState.PLAYING ? "停止" : "再生"}
                        </span>
                     </button>
                </div>
            </div>
        </div>
    </div>
  );
}
