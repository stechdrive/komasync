import { useEffect, useRef } from 'react';

export const useViewportHeight = (): void => {
  const heightRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const setAppHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      if (heightRef.current === height) return;
      heightRef.current = height;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };

    const scheduleAppHeight = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setAppHeight();
      });
    };

    setAppHeight();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', scheduleAppHeight);
    vv?.addEventListener('scroll', scheduleAppHeight);
    window.addEventListener('resize', scheduleAppHeight);

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      vv?.removeEventListener('resize', scheduleAppHeight);
      vv?.removeEventListener('scroll', scheduleAppHeight);
      window.removeEventListener('resize', scheduleAppHeight);
    };
  }, []);
};
