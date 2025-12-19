import React, { useLayoutEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Track } from '@/types';
import { getTrackTheme } from '@/domain/trackTheme';

type TrackMuteMenuProps = {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  tracks: Track[];
  onToggleTrack: (trackId: string) => void;
  onClose: () => void;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const TrackMuteMenu: React.FC<TrackMuteMenuProps> = ({
  isOpen,
  position,
  tracks,
  onToggleTrack,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuSize, setMenuSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuSize({ width: rect.width, height: rect.height });
  }, [isOpen, tracks]);

  if (!isOpen || !position) return null;

  const padding = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = menuSize.width || 220;
  const height = menuSize.height || 200;
  const left = clamp(position.x, padding, viewportWidth - width - padding);
  const top = clamp(position.y, padding, viewportHeight - height - padding);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={menuRef}
        className="absolute min-w-[200px] rounded-xl border border-gray-200 bg-white shadow-xl"
        style={{ left, top }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 text-[10px] font-bold text-gray-500 border-b border-gray-100">
          ミュート
        </div>

        <div className="p-2 space-y-1">
          {tracks.map((track) => {
            const theme = getTrackTheme(track.id);
            const isMuted = track.isMuted;
            return (
              <button
                key={track.id}
                type="button"
                onClick={() => onToggleTrack(track.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  isMuted ? 'text-gray-400 hover:bg-gray-50' : 'text-gray-700 hover:bg-indigo-50'
                }`}
                aria-pressed={isMuted}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${isMuted ? theme.dotInactiveClass : theme.dotActiveClass}`}
                />
                <span className="flex-1 text-left">{track.name}</span>
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
