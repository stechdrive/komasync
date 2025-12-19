import React from 'react';
import { Scissors, Trash2, X } from 'lucide-react';

type EditPaletteProps = {
  selectionCount: number;
  targetLabel: string;
  onCut: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
};

export const EditPalette: React.FC<EditPaletteProps> = ({
  selectionCount,
  targetLabel,
  onCut,
  onDelete,
  onClearSelection,
}) => {
  const showSelectionActions = selectionCount > 0;
  if (!showSelectionActions) return null;

  return (
    <div className="pointer-events-none absolute left-0 right-0 bottom-0 pb-[96px] px-3">
      <div className="pointer-events-auto max-w-md mx-auto">
        {showSelectionActions && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-blue-700 font-bold">{selectionCount}コマ選択中</div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] text-blue-600">{targetLabel}</div>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="text-[10px] text-blue-700 hover:text-blue-900 flex items-center gap-1"
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
                className="flex items-center justify-center gap-2 bg-white hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-lg border border-blue-100 text-sm font-bold shadow-sm"
              >
                <Scissors className="w-4 h-4" /> 切り取り
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center justify-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg border border-red-200 text-sm font-bold shadow-sm"
              >
                <Trash2 className="w-4 h-4" /> 削除
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
