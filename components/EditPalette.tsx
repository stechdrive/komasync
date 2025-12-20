import React, { useLayoutEffect, useRef, useState } from 'react';
import { Ban, RotateCcw, Scissors, Tag, Trash2, X } from 'lucide-react';

type EditPaletteProps = {
  selectionCount: number;
  targetLabel: string;
  anchor: { x: number; y: number } | null;
  onCut: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  onClose: () => void;
  onMarkSpeech: () => void;
  onMarkNonSpeech: () => void;
  onResetSpeechLabel: () => void;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const EditPalette: React.FC<EditPaletteProps> = ({
  selectionCount,
  targetLabel,
  anchor,
  onCut,
  onDelete,
  onClearSelection,
  onClose,
  onMarkSpeech,
  onMarkNonSpeech,
  onResetSpeechLabel,
}) => {
  const showSelectionActions = selectionCount > 0;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuSize, setMenuSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!showSelectionActions || !anchor) return;
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuSize({ width: rect.width, height: rect.height });
  }, [anchor, showSelectionActions]);

  if (!showSelectionActions || !anchor) return null;

  const padding = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = menuSize.width || 280;
  const height = menuSize.height || 140;
  const left = clamp(anchor.x - width / 2, padding, viewportWidth - width - padding);
  const preferTop = anchor.y - height - 12;
  const top = preferTop >= padding
    ? preferTop
    : clamp(anchor.y + 12, padding, viewportHeight - height - padding);

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        ref={menuRef}
        className="pointer-events-auto w-[min(92vw,24rem)]"
        style={{ left, top, position: 'absolute' }}
      >
        {showSelectionActions && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[var(--ui-xs)] text-blue-700 font-bold">{selectionCount}コマ選択中</div>
              <div className="flex items-center gap-2">
                <div className="text-[var(--ui-xs)] text-blue-600">{targetLabel}</div>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[var(--control-size)] px-2 text-[var(--ui-xs)] text-blue-600 hover:text-blue-800 flex items-center rounded-md"
                  title="閉じる"
                >
                  閉じる
                </button>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="min-h-[var(--control-size)] px-2 text-[var(--ui-xs)] text-blue-700 hover:text-blue-900 flex items-center gap-1 rounded-md"
                  title="選択解除"
                >
                  <X className="w-3 h-3" />
                  解除
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onCut}
                className="min-h-[var(--control-size)] flex items-center justify-center gap-2 bg-white hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-lg border border-blue-100 text-[var(--ui-sm)] font-bold shadow-sm"
              >
                <Scissors className="w-4 h-4" /> 切り取り
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="min-h-[var(--control-size)] flex items-center justify-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg border border-red-200 text-[var(--ui-sm)] font-bold shadow-sm"
              >
                <Trash2 className="w-4 h-4" /> 削除
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <div className="text-[var(--ui-xs)] text-blue-600 font-semibold">セリフラベル</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={onMarkSpeech}
                  className="min-h-[var(--control-size)] flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-2 py-2 rounded-lg text-[var(--ui-xs)] font-bold shadow-sm"
                >
                  <Tag className="w-3.5 h-3.5" /> セリフ
                </button>
                <button
                  type="button"
                  onClick={onMarkNonSpeech}
                  className="min-h-[var(--control-size)] flex items-center justify-center gap-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-2 rounded-lg text-[var(--ui-xs)] font-bold"
                >
                  <Ban className="w-3.5 h-3.5" /> 解除
                </button>
                <button
                  type="button"
                  onClick={onResetSpeechLabel}
                  className="min-h-[var(--control-size)] flex items-center justify-center gap-1 bg-white hover:bg-blue-50 text-blue-700 px-2 py-2 rounded-lg border border-blue-100 text-[var(--ui-xs)] font-bold"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> 自動
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
