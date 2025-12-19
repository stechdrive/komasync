export type TrackTheme = {
  activeTextClass: string;
  activeBorderClass: string;
  dotActiveClass: string;
  dotInactiveClass: string;
  vadBarClass: string;
  accentHex: string;
};

const DEFAULT_THEME: TrackTheme = {
  activeTextClass: 'text-gray-700',
  activeBorderClass: 'border-gray-400',
  dotActiveClass: 'bg-gray-500',
  dotInactiveClass: 'bg-gray-300',
  vadBarClass: 'bg-gray-500',
  accentHex: '#6b7280',
};

const TRACK_THEMES_BY_ID: Record<string, TrackTheme> = {
  '1': {
    activeTextClass: 'text-blue-700',
    activeBorderClass: 'border-blue-500',
    dotActiveClass: 'bg-blue-500',
    dotInactiveClass: 'bg-blue-300',
    vadBarClass: 'bg-blue-500',
    accentHex: '#3b82f6',
  },
  '2': {
    activeTextClass: 'text-red-700',
    activeBorderClass: 'border-red-500',
    dotActiveClass: 'bg-red-500',
    dotInactiveClass: 'bg-red-300',
    vadBarClass: 'bg-red-500',
    accentHex: '#ef4444',
  },
  '3': {
    activeTextClass: 'text-green-700',
    activeBorderClass: 'border-green-500',
    dotActiveClass: 'bg-green-500',
    dotInactiveClass: 'bg-green-300',
    vadBarClass: 'bg-green-500',
    accentHex: '#22c55e',
  },
};

export const getTrackTheme = (trackId: string): TrackTheme =>
  TRACK_THEMES_BY_ID[trackId] ?? DEFAULT_THEME;
