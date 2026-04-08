import React from 'react';
import { HelpCircle, MoreHorizontal, Redo2, RefreshCw, Scan, Undo2, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import { APP_NAME } from '@/domain/appMeta';
import { useLongPressTooltip } from '@/hooks/useLongPressTooltip';
import { LongPressTooltip } from '@/components/LongPressTooltip';
import type { Translator } from '@/domain/i18n';

type TopBarProps = {
  sheetNumber: number;
  totalTimecode: string;
  currentTimecode: string;
  selectionTimecode?: string;
  t: Translator;
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

export const TopBar: React.FC<TopBarProps> = ({
  sheetNumber,
  totalTimecode,
  currentTimecode,
  selectionTimecode,
  t,
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
  const hasMuted = mutedCount > 0;
  const { tooltip, getTooltipProps } = useLongPressTooltip();
  const tooltipProps = getTooltipProps({ placement: 'bottom' });
  const sheetLabel = t('topBar.sheetLabel', { sheetNumber });
  const selectionSuffix = selectionTimecode ? t('topBar.selectionSuffix', { selection: selectionTimecode }) : '';

  return (
    <div className="safe-area-top bg-indigo-600 text-white border-b border-indigo-700/40">
      <div className="px-2 sm:px-3 py-1.5 sm:py-2 flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            disabled={isResetDisabled}
            onClick={onReset}
            {...tooltipProps}
            className={`mobile-compact-hide shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center border transition-colors ${
              isResetDisabled
                ? 'opacity-40 border-white/20'
                : 'bg-indigo-700/40 hover:bg-indigo-700 border-white/20'
            }`}
            title={t('topBar.resetTitle')}
          >
            <RefreshCw className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>

          <div className="min-w-0 flex flex-col gap-0.5 leading-tight">
            <div className="min-w-0 flex items-baseline gap-2">
              <div className="mobile-compact-hide text-[var(--ui-sm)] font-bold truncate shrink-0">{APP_NAME}</div>
              <div className="text-[var(--ui-sm)] opacity-90 font-semibold shrink-0 whitespace-nowrap">{sheetLabel}</div>
            </div>
            <div className="font-mono text-[var(--ui-xs)] sm:text-[var(--ui-sm)] truncate min-w-0">
              <span className="inline sm:hidden font-semibold">{currentTimecode}</span>
              <span className="hidden sm:inline">{totalTimecode}</span>
              {selectionSuffix}
            </div>
          </div>
        </div>

        <div className="flex flex-nowrap items-center gap-0.5 sm:gap-1 shrink-0 justify-end">
          <div className="mobile-compact-hide flex items-center gap-0.5 sm:gap-1 mr-0.5 sm:mr-1">
            <button
              type="button"
              onClick={onZoomOut}
              disabled={isZoomOutDisabled}
              {...tooltipProps}
              className="shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
              title={t('topBar.zoomOutTitle')}
            >
              <ZoomOut className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
            <button
              type="button"
              onClick={onZoomReset}
              {...tooltipProps}
              className="shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
              title={t('topBar.zoomResetTitle')}
              aria-label={t('topBar.zoomResetAria')}
            >
              <Scan className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              disabled={isZoomInDisabled}
              {...tooltipProps}
              className="shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
              title={t('topBar.zoomInTitle')}
            >
              <ZoomIn className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
          </div>
          <button
            type="button"
            onClick={onUndo}
            disabled={isUndoDisabled}
            {...tooltipProps}
            className="shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
            title={t('topBar.undoTitle')}
          >
            <Undo2 className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={isRedoDisabled}
            {...tooltipProps}
            className="shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 disabled:opacity-40"
            title={t('topBar.redoTitle')}
          >
            <Redo2 className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenMuteMenu({ x: rect.right - 8, y: rect.bottom + 6 });
            }}
            {...tooltipProps}
            className={`mobile-tight-hide shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40 ${
              hasMuted ? 'text-amber-100' : ''
            }`}
            title={t('topBar.muteTitle')}
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
            {...tooltipProps}
            className="mobile-compact-hide shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
            title={t('topBar.helpTitle')}
          >
            <HelpCircle className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
          <button
            type="button"
            onClick={onOpenMore}
            {...tooltipProps}
            className="shrink-0 w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-indigo-700/40"
            title={t('topBar.moreTitle')}
          >
            <MoreHorizontal className="w-[var(--control-icon)] h-[var(--control-icon)]" />
          </button>
        </div>
      </div>
      <LongPressTooltip tooltip={tooltip} />
    </div>
  );
};
