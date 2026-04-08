import React, { useEffect, useRef } from 'react';

type AppShellProps = {
  top: React.ReactNode;
  bottom: React.ReactNode;
  children: React.ReactNode;
};

export const AppShell: React.FC<AppShellProps> = ({ top, bottom, children }) => {
  const topRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const topEl = topRef.current;
    const dockEl = dockRef.current;
    if ((!topEl && !dockEl) || typeof ResizeObserver === 'undefined') return;

    const updateShellMetrics = () => {
      const nextTopHeight = topEl ? Math.max(0, Math.round(topEl.getBoundingClientRect().height)) : 0;
      const nextDockHeight = dockEl ? Math.max(0, Math.round(dockEl.getBoundingClientRect().height)) : 0;
      document.documentElement.style.setProperty('--topbar-h', `${nextTopHeight}px`);
      document.documentElement.style.setProperty('--dock-h', `${nextDockHeight}px`);
    };

    updateShellMetrics();
    const observer = new ResizeObserver(() => updateShellMetrics());
    if (topEl) observer.observe(topEl);
    if (dockEl) observer.observe(dockEl);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full bg-gray-50 text-gray-800 font-sans" style={{ height: 'var(--app-height, 100dvh)' }}>
      <div className="h-full flex flex-col overflow-hidden">
        <div ref={topRef} className="shrink-0">{top}</div>
        <div className="min-h-0 flex-1 relative overflow-hidden">{children}</div>
        <div ref={dockRef} className="shrink-0">
          {bottom}
        </div>
      </div>
    </div>
  );
};
