import React from 'react';

type VuMeterProps = {
  value: number;
  threshold: number;
  max?: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const VuMeter: React.FC<VuMeterProps> = ({ value, threshold, max = 0.2 }) => {
  const valueNorm = clamp01(value / max);
  const thresholdNorm = clamp01(threshold / max);

  return (
    <div className="relative h-3 bg-gray-200 rounded overflow-hidden">
      <div className="absolute inset-y-0 left-0 bg-emerald-500/70" style={{ width: `${valueNorm * 100}%` }} />
      <div className="absolute inset-y-0" style={{ left: `${thresholdNorm * 100}%` }}>
        <div className="w-px h-full bg-red-500" />
      </div>
    </div>
  );
};

