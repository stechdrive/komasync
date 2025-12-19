import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle, MoreHorizontal, Redo2, RefreshCw, Undo2 } from 'lucide-react';

type TopBarProps = {
  sheetNumber: number;
  totalTimecode: string;
  selectionTimecode?: string;
  isResetDisabled: boolean;
  isUndoDisabled: boolean;
  isRedoDisabled: boolean;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
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
  onReset,
  onUndo,
  onRedo,
  onOpenHelp,
  onOpenMore,
}) => {
  const timerRef = useRef<number | null>(null);
  const [isHoldingReset, setIsHoldingReset] = useState(false);

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
      <div className="h-12 px-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            disabled={isResetDisabled}
            onPointerDown={handleResetPointerDown}
            onPointerUp={handleResetCancel}
            onPointerCancel={handleResetCancel}
            onPointerLeave={handleResetCancel}
            className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center border transition-colors ${
              isResetDisabled
                ? 'opacity-40 border-white/20'
                : isHoldingReset
                  ? 'bg-red-600 border-red-300'
                  : 'bg-indigo-700/40 hover:bg-indigo-700 border-white/20'
            }`}
            title="長押しでリセット（録音データも削除）"
          >
            <RefreshCw className="w-5 h-5" />
          </button>

          <div className="min-w-0 leading-tight">
            <div className="text-[10px] opacity-80 truncate">シート {sheetNumber}</div>
            <div className="font-mono text-xs truncate">
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
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
            title="Undo"
          >
            <Undo2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={isRedoDisabled}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
            title="Redo"
          >
            <Redo2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
            title="ヘルプ"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onOpenMore}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
            title="その他"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
