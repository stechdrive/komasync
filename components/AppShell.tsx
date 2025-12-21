import React, { useEffect, useRef } from 'react';

type AppShellProps = {
  top: React.ReactNode;
  bottom: React.ReactNode;
  children: React.ReactNode;
};

export const AppShell: React.FC<AppShellProps> = ({ top, bottom, children }) => {
  const dockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const updateDockHeight = () => {
      const nextHeight = Math.max(0, Math.round(el.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--dock-h', `${nextHeight}px`);
    };

    updateDockHeight();
    const observer = new ResizeObserver(() => updateDockHeight());
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full bg-gray-50 text-gray-800 font-sans" style={{ height: 'var(--app-height, 100dvh)' }}>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="shrink-0 h-[var(--topbar-h)]">{top}</div>
        <div className="min-h-0 flex-1 relative overflow-hidden">{children}</div>
        <div ref={dockRef} className="shrink-0">
          {bottom}
        </div>
      </div>
    </div>
  );
};
