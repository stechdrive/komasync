import React, { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

type ClipboardMenuProps = {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  canPaste: boolean;
  onPasteInsert: () => void;
  onPasteOverwrite: () => void;
  onClearClipboard: () => void;
  onClose: () => void;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const ClipboardMenu: React.FC<ClipboardMenuProps> = ({
  isOpen,
  position,
  canPaste,
  onPasteInsert,
  onPasteOverwrite,
  onClearClipboard,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuSize, setMenuSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuSize({ width: rect.width, height: rect.height });
  }, [isOpen, canPaste]);

  if (!isOpen || !position) return null;

  const padding = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = menuSize.width || 220;
  const height = menuSize.height || 160;
  const left = clamp(position.x, padding, viewportWidth - width - padding);
  const top = clamp(position.y, padding, viewportHeight - height - padding);

  const handlePasteInsert = () => {
    onClose();
    onPasteInsert();
  };

  const handlePasteOverwrite = () => {
    onClose();
    onPasteOverwrite();
  };

  const handleClearClipboard = () => {
    onClose();
    onClearClipboard();
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={menuRef}
        className="absolute min-w-[200px] max-h-[calc(var(--app-height)-var(--topbar-h)-var(--dock-h))] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden flex flex-col"
        style={{ left, top }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 text-[var(--ui-xs)] font-bold text-gray-500 border-b border-gray-100 flex items-center justify-between">
          クリップボード
          <button
            type="button"
            onClick={onClose}
            className="w-[var(--control-size)] h-[var(--control-size)] -mr-2 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            aria-label="閉じる"
          >
            <X className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
        </div>

        {canPaste ? (
          <div className="p-2 space-y-1 overflow-y-auto min-h-0">
            <button
              type="button"
              onClick={handlePasteInsert}
              className="w-full flex items-center text-left px-3 py-2 min-h-[var(--control-size)] rounded-lg text-[var(--ui-sm)] text-gray-700 hover:bg-indigo-50"
            >
              貼り付け（挿入）
            </button>
            <button
              type="button"
              onClick={handlePasteOverwrite}
              className="w-full flex items-center text-left px-3 py-2 min-h-[var(--control-size)] rounded-lg text-[var(--ui-sm)] text-gray-700 hover:bg-indigo-50"
            >
              貼り付け（上書き）
            </button>
            <div className="h-px bg-gray-100 my-1" />
            <button
              type="button"
              onClick={handleClearClipboard}
              className="w-full flex items-center text-left px-3 py-2 min-h-[var(--control-size)] rounded-lg text-[var(--ui-sm)] text-red-600 hover:bg-red-50"
            >
              クリップボードを消去
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 text-[var(--ui-xs)] text-gray-500">クリップボードが空です。</div>
        )}
      </div>
    </div>
  );
};
