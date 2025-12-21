import React from 'react';
import { LongPressTooltipState } from '@/hooks/useLongPressTooltip';

type LongPressTooltipProps = {
  tooltip: LongPressTooltipState | null;
};

export const LongPressTooltip: React.FC<LongPressTooltipProps> = ({ tooltip }) => {
  if (!tooltip) return null;

  const transform = tooltip.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';

  return (
    <div
      role="tooltip"
      className="fixed z-50 max-w-[80vw] rounded-md bg-gray-900/90 px-2.5 py-1.5 text-center text-[var(--ui-xs)] text-white shadow-lg pointer-events-none"
      style={{ left: tooltip.x, top: tooltip.y, transform }}
    >
      {tooltip.text}
    </div>
  );
};
