import { useEffect } from 'react';

export const useViewportHeight = (): void => {
  useEffect(() => {
    const setAppHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };

    setAppHeight();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', setAppHeight);
    vv?.addEventListener('scroll', setAppHeight);
    window.addEventListener('resize', setAppHeight);

    return () => {
      vv?.removeEventListener('resize', setAppHeight);
      vv?.removeEventListener('scroll', setAppHeight);
      window.removeEventListener('resize', setAppHeight);
    };
  }, []);
};

