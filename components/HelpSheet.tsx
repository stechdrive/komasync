import React from 'react';
import { HelpCircle, X } from 'lucide-react';
import type { ListTranslator, Translator } from '@/domain/i18n';

type HelpSheetProps = {
  isOpen: boolean;
  t: Translator;
  list: ListTranslator;
  onClose: () => void;
};

export const HelpSheet: React.FC<HelpSheetProps> = ({ isOpen, t, list, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute inset-x-0 bottom-0 safe-area-bottom">
        <div className="bg-white rounded-t-2xl shadow-xl border-t border-gray-200 max-h-[calc(var(--app-height)-var(--topbar-h)-var(--dock-h))] overflow-hidden flex flex-col">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <div className="font-bold text-[var(--ui-sm)] text-gray-800 flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-indigo-600" />
              {t('help.title')}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-[var(--control-size)] h-[var(--control-size)] rounded-lg flex items-center justify-center hover:bg-gray-100"
              title={t('help.close')}
            >
              <X className="w-[var(--control-icon)] h-[var(--control-icon)]" />
            </button>
          </div>

          <div className="p-4 overflow-y-auto min-h-0 flex-1 space-y-5 text-[var(--ui-sm)] text-gray-700">
            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.overviewTitle')}</div>
              <p>{t('help.overviewBody')}</p>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.timesheetTitle')}</div>
              <ul className="list-disc ml-4 space-y-1">
                {list('help.timesheetItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.zoomTitle')}</div>
              <ul className="list-disc ml-4 space-y-1">
                {list('help.zoomItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.playbackTitle')}</div>
              <ul className="list-disc ml-4 space-y-1">
                {list('help.playbackItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.inputOptimizeTitle')}</div>
              <ul className="list-disc ml-4 space-y-1">
                {list('help.inputOptimizeItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.editTitle')}</div>
              <ul className="list-disc ml-4 space-y-1">
                {list('help.editItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.exportTitle')}</div>
              <ul className="list-disc ml-4 space-y-1">
                {list('help.exportItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.shortcutsTitle')}</div>
              <ul className="list-disc ml-4 space-y-1 font-mono text-[var(--ui-xs)]">
                {list('help.shortcutsItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <div className="text-[var(--ui-xs)] text-gray-500 font-semibold">{t('help.tipsTitle')}</div>
              <ul className="list-disc ml-4 space-y-1">
                {list('help.tipsItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
