import React from 'react';

type AppShellProps = {
  top: React.ReactNode;
  bottom: React.ReactNode;
  children: React.ReactNode;
};

export const AppShell: React.FC<AppShellProps> = ({ top, bottom, children }) => {
  return (
    <div className="w-full bg-gray-50 text-gray-800 font-sans" style={{ height: 'var(--app-height, 100vh)' }}>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="shrink-0">{top}</div>
        <div className="flex-1 min-h-0 relative overflow-hidden">{children}</div>
        <div className="shrink-0">{bottom}</div>
      </div>
    </div>
  );
};

