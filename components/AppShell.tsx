import React from 'react';

type AppShellProps = {
  top: React.ReactNode;
  bottom: React.ReactNode;
  children: React.ReactNode;
};

export const AppShell: React.FC<AppShellProps> = ({ top, bottom, children }) => {
  return (
    <div className="w-full bg-gray-50 text-gray-800 font-sans" style={{ height: 'var(--app-height, 100dvh)' }}>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="shrink-0 h-[var(--topbar-h)]">{top}</div>
        <div
          className="min-h-0 relative overflow-hidden"
          style={{ height: 'calc(var(--app-height, 100dvh) - var(--topbar-h) - var(--dock-h))' }}
        >
          {children}
        </div>
        <div className="shrink-0 h-[var(--dock-h)]">{bottom}</div>
      </div>
    </div>
  );
};
