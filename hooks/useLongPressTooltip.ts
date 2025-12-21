import { useCallback, useEffect, useRef, useState } from 'react';

export type LongPressTooltipState = {
  text: string;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
};

type TooltipOptions = {
  text?: string;
  placement?: 'top' | 'bottom';
};

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 8;
const TOOLTIP_MARGIN = 10;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const useLongPressTooltip = () => {
  const [tooltip, setTooltip] = useState<LongPressTooltipState | null>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<{ text: string; rect: DOMRect; placement: 'top' | 'bottom' } | null>(null);
  const activeRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
    startRef.current = null;
    activeRef.current = false;
    setTooltip(null);
  }, [clearTimer]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const getTooltipProps = useCallback(
    (options?: TooltipOptions) => {
      const placement = options?.placement ?? 'top';
      return {
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
          if (e.pointerType === 'mouse') return;
          const text =
            options?.text ??
            e.currentTarget.getAttribute('title') ??
            e.currentTarget.getAttribute('aria-label');
          if (!text) return;

          startRef.current = { x: e.clientX, y: e.clientY };
          pendingRef.current = {
            text,
            rect: e.currentTarget.getBoundingClientRect(),
            placement,
          };
          clearTimer();
          timerRef.current = window.setTimeout(() => {
            const pending = pendingRef.current;
            if (!pending) return;
            const maxX = window.innerWidth - TOOLTIP_MARGIN;
            const x = clamp(pending.rect.left + pending.rect.width / 2, TOOLTIP_MARGIN, maxX);
            const y =
              pending.placement === 'top'
                ? pending.rect.top - TOOLTIP_MARGIN
                : pending.rect.bottom + TOOLTIP_MARGIN;
            setTooltip({ text: pending.text, x, y, placement: pending.placement });
            activeRef.current = true;
            suppressClickRef.current = true;
          }, LONG_PRESS_MS);
        },
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
          if (e.pointerType === 'mouse') return;
          if (activeRef.current || !startRef.current) return;
          const dx = e.clientX - startRef.current.x;
          const dy = e.clientY - startRef.current.y;
          if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
            resetState();
          }
        },
        onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
          if (e.pointerType === 'mouse') return;
          const suppressClick = activeRef.current;
          resetState();
          if (suppressClick) suppressClickRef.current = true;
        },
        onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
          if (e.pointerType === 'mouse') return;
          const suppressClick = activeRef.current;
          resetState();
          if (suppressClick) suppressClickRef.current = true;
        },
        onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
          if (e.pointerType === 'mouse') return;
          const suppressClick = activeRef.current;
          resetState();
          if (suppressClick) suppressClickRef.current = true;
        },
        onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
        },
      };
    },
    [clearTimer, resetState]
  );

  return { tooltip, getTooltipProps };
};
