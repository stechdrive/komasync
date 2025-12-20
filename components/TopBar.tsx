import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle, MoreHorizontal, Redo2, RefreshCw, Scan, Undo2, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import { APP_NAME } from '@/domain/appMeta';

type TopBarProps = {
  sheetNumber: number;
  totalTimecode: string;
  selectionTimecode?: string;
  isResetDisabled: boolean;
  isUndoDisabled: boolean;
  isRedoDisabled: boolean;
  mutedCount: number;
  isZoomInDisabled: boolean;
  isZoomOutDisabled: boolean;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onOpenMuteMenu: (point: { x: number; y: number }) => void;
  onOpenHelp: () => void;
  onOpenMore: () => void;
};

const RESET_HOLD_MS = 900;

export const TopBar: React.FC<TopBarProps> = ({
  sheetNumber,
  totalTimecode,
  selectionTimecode,
  isResetDisabled,
  isUndoDisabled,
  isRedoDisabled,
  mutedCount,
  isZoomInDisabled,
  isZoomOutDisabled,
  onReset,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onOpenMuteMenu,
  onOpenHelp,
  onOpenMore,
}) => {
  const timerRef = useRef<number | null>(null);
  const [isHoldingReset, setIsHoldingReset] = useState(false);
  const hasMuted = mutedCount > 0;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  const handleResetPointerDown = () => {
    if (isResetDisabled) return;
    clearTimer();
    setIsHoldingReset(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setIsHoldingReset(false);
      onReset();
    }, RESET_HOLD_MS);
  };

  const handleResetCancel = () => {
    clearTimer();
    setIsHoldingReset(false);
  };

  return (
    <div className="safe-area-top h-full bg-indigo-600 text-white border-b border-indigo-700/40">
      <div className="h-full px-3 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            disabled={isResetDisabled}
            onPointerDown={handleResetPointerDown}
            onPointerUp={handleResetCancel}
            onPointerCancel={handleResetCancel}
            onPointerLeave={handleResetCancel}
            className={`shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center border transition-colors ${
              isResetDisabled
                ? 'opacity-40 border-white/20'
                : isHoldingReset
                  ? 'bg-red-600 border-red-300'
                  : 'bg-indigo-700/40 hover:bg-indigo-700 border-white/20'
            }`}
            title="長押しでリセット（録音データも削除）"
          >
            <RefreshCw className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>

          <div className="min-w-0 flex flex-col gap-0.5 leading-tight">
            <div className="min-w-0 flex items-baseline gap-2">
              <div className="text-[var(--ui-sm)] font-bold truncate shrink-0">{APP_NAME}</div>
              <div className="text-[var(--ui-sm)] opacity-80 shrink-0 whitespace-nowrap">シート {sheetNumber}</div>
            </div>
            <div className="font-mono text-[var(--ui-sm)] truncate min-w-0">
              {totalTimecode}
              {selectionTimecode ? ` / 選 ${selectionTimecode}` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div className="hidden sm:flex items-center gap-1 mr-1">
            <button
              type="button"
              onClick={onZoomOut}
              disabled={isZoomOutDisabled}
              className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
              title="ズームアウト（100%まで）"
            >
              <ZoomOut className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
            <button
              type="button"
              onClick={onZoomReset}
              className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
              title="全体表示"
              aria-label="全体表示"
            >
              <Scan className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              disabled={isZoomInDisabled}
              className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
              title="ズームイン"
            >
              <ZoomIn className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
          </div>
          <button
            type="button"
            onClick={onUndo}
            disabled={isUndoDisabled}
            className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
            title="Undo"
          >
            <Undo2 className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={isRedoDisabled}
            className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
            title="Redo"
          >
            <Redo2 className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenMuteMenu({ x: rect.right - 8, y: rect.bottom + 6 });
            }}
            className={`w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 ${
              hasMuted ? 'text-amber-100' : ''
            }`}
            title="ミュート"
          >
            {hasMuted ? (
              <VolumeX className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            ) : (
              <Volume2 className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
            title="ヘルプ"
          >
            <HelpCircle className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
          <button
            type="button"
            onClick={onOpenMore}
            className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
            title="その他"
          >
            <MoreHorizontal className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
        </div>
      </div>
    </div>
  );
};
