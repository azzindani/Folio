import type { ThemeSpec } from '../schema/types';

const SHARED_TYPOGRAPHY: ThemeSpec['typography'] = {
  scale: {
    display: { size: 96, weight: 800, line_height: 1.0 },
    h1:      { size: 72, weight: 700, line_height: 1.1 },
    h2:      { size: 48, weight: 700, line_height: 1.2 },
    h3:      { size: 32, weight: 600, line_height: 1.3 },
    body:    { size: 18, weight: 400, line_height: 1.6 },
    caption: { size: 14, weight: 400, line_height: 1.5 },
    label:   { size: 12, weight: 600, line_height: 1.0 },
  },
  families: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
};

const SHARED_SPACING: ThemeSpec['spacing'] = {
  unit: 8,
  scale: [0, 4, 8, 16, 24, 32, 48, 64, 80, 96, 128],
};

const SHARED_RADII: ThemeSpec['radii'] = {
  sm: 4, md: 8, lg: 16, xl: 24, full: 9999,
};

export const BUILTIN_THEMES: Record<string, ThemeSpec> = {
  'dark-tech': {
    _protocol: 'theme/v1',
    name: 'Dark Tech',
    version: '1.0.0',
    colors: {
      background: '#1A1A2E',
      surface: '#16213E',
      primary: '#E94560',
      secondary: '#3D9EE4',
      text: '#FFFFFF',
      text_muted: '#8892A4',
      border: '#2A2A4A',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 4px 24px rgba(0,0,0,0.4)',
      shadow_glow: '0 0 32px rgba(233,69,96,0.3)',
      blur_glass: 12,
    },
    radii: SHARED_RADII,
  },

  'light-clean': {
    _protocol: 'theme/v1',
    name: 'Light Clean',
    version: '1.0.0',
    colors: {
      background: '#FFFFFF',
      surface: '#F8F9FA',
      primary: '#6C5CE7',
      secondary: '#00B894',
      text: '#1A1A2E',
      text_muted: '#636E72',
      border: '#DFE6E9',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 2px 16px rgba(0,0,0,0.08)',
      shadow_glow: '0 0 24px rgba(108,92,231,0.2)',
      blur_glass: 8,
    },
    radii: SHARED_RADII,
  },

  'ocean-blue': {
    _protocol: 'theme/v1',
    name: 'Ocean Blue',
    version: '1.0.0',
    colors: {
      background: '#0A192F',
      surface: '#112240',
      primary: '#64FFDA',
      secondary: '#CCD6F6',
      text: '#CCD6F6',
      text_muted: '#8892B0',
      border: '#1E3A5F',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 4px 32px rgba(0,0,0,0.5)',
      shadow_glow: '0 0 40px rgba(100,255,218,0.15)',
      blur_glass: 16,
    },
    radii: SHARED_RADII,
  },
};
