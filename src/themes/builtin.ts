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

  'neon-bloom': {
    _protocol: 'theme/v1',
    name: 'Neon Bloom',
    version: '1.0.0',
    colors: {
      background: '#03001C',
      surface: '#0D0020',
      primary: '#00FFF0',
      secondary: '#FF006E',
      text: '#F0F0FF',
      text_muted: '#8888BB',
      border: '#1F0040',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 8px 40px rgba(0,255,240,0.15)',
      shadow_glow: '0 0 48px rgba(0,255,240,0.35)',
      blur_glass: 20,
    },
    radii: SHARED_RADII,
  },

  'indigo-pro': {
    _protocol: 'theme/v1',
    name: 'Indigo Pro',
    version: '1.0.0',
    colors: {
      background: '#0F172A',
      surface: '#1E293B',
      primary: '#6366F1',
      secondary: '#8B5CF6',
      text: '#F1F5F9',
      text_muted: '#94A3B8',
      border: '#334155',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 6px 28px rgba(99,102,241,0.20)',
      shadow_glow: '0 0 32px rgba(139,92,246,0.25)',
      blur_glass: 12,
    },
    radii: SHARED_RADII,
  },

  'sunset-glow': {
    _protocol: 'theme/v1',
    name: 'Sunset Glow',
    version: '1.0.0',
    colors: {
      background: '#1A0B2E',
      surface: '#2C1244',
      primary: '#FF6B35',
      secondary: '#FFD93D',
      text: '#FFF5E1',
      text_muted: '#C0A7C9',
      border: '#3E1F5A',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 8px 32px rgba(255,107,53,0.18)',
      shadow_glow: '0 0 40px rgba(255,217,61,0.25)',
      blur_glass: 14,
    },
    radii: SHARED_RADII,
  },

  'mono-print': {
    _protocol: 'theme/v1',
    name: 'Mono Print',
    version: '1.0.0',
    colors: {
      background: '#FAFAF7',
      surface: '#F0EFE9',
      primary: '#1A1A1A',
      secondary: '#5C5C5C',
      text: '#0A0A0A',
      text_muted: '#737373',
      border: '#D4D4D0',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 1px 8px rgba(0,0,0,0.10)',
      shadow_glow: '0 0 16px rgba(0,0,0,0.08)',
      blur_glass: 4,
    },
    radii: SHARED_RADII,
  },

  'forest-deep': {
    _protocol: 'theme/v1',
    name: 'Forest Deep',
    version: '1.0.0',
    colors: {
      background: '#0E1F1A',
      surface: '#16332B',
      primary: '#34D399',
      secondary: '#FCD34D',
      text: '#ECFDF5',
      text_muted: '#86B8A5',
      border: '#1F4034',
    },
    typography: SHARED_TYPOGRAPHY,
    spacing: SHARED_SPACING,
    effects: {
      shadow_card: '0 4px 24px rgba(0,0,0,0.4)',
      shadow_glow: '0 0 32px rgba(52,211,153,0.22)',
      blur_glass: 12,
    },
    radii: SHARED_RADII,
  },
};
