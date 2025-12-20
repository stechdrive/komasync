import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle, MoreHorizontal, Redo2, RefreshCw, Undo2, Volume2, VolumeX } from 'lucide-react';
import { APP_NAME, APP_VERSION } from '@/domain/appMeta';

type TopBarProps = {
  sheetNumber: number;
  totalTimecode: string;
  selectionTimecode?: string;
  isResetDisabled: boolean;
  isUndoDisabled: boolean;
  isRedoDisabled: boolean;
  mutedCount: number;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
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
  onReset,
  onUndo,
  onRedo,
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
    <div className="safe-area-top bg-indigo-600 text-white border-b border-indigo-700/40">
      <div className="h-[var(--topbar-h)] px-3 flex items-center justify-between gap-3">
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

          <div className="min-w-0 leading-tight">
            <div className="text-[var(--ui-sm)] font-bold truncate">
              {APP_NAME} v{APP_VERSION}
            </div>
            <div className="text-[var(--ui-xs)] opacity-80 truncate">シート {sheetNumber}</div>
            <div className="font-mono text-[var(--ui-sm)] truncate">
              総 {totalTimecode}
              {selectionTimecode ? ` / 選 ${selectionTimecode}` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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
