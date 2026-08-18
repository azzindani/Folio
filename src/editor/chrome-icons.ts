// Folio editor — shared monoline chrome icons.
//
// The editor chrome previously mixed emoji (📁 ⭐ 🎨 ♿ ✋ …) with text glyphs;
// emoji render as full-colour bitmaps and clash with the flat UI. Every chrome
// icon is an inline stroke SVG on currentColor so buttons tint via CSS states.
// Design content icons (the icon LAYER type) are unaffected.

const paths: Record<string, string> = {
  layers: '<path d="m12 3.2 8.5 4.4L12 12 3.5 7.6 12 3.2Z"/><path d="m4.4 11.7-.9.5 8.5 4.4 8.5-4.4-.9-.5"/><path d="m4.4 16.1-.9.5 8.5 4.4 8.5-4.4-.9-.5"/>',
  folder: '<path d="M3.5 6.5a2 2 0 0 1 2-2h3.8l2 2.3h7.2a2 2 0 0 1 2 2v8.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.7" cy="9.7" r="1.5"/><path d="m20.3 15.5-4.5-4.5-7.5 7.5"/>',
  component: '<rect x="4" y="4" width="6.8" height="6.8" rx="1.2"/><rect x="13.2" y="4" width="6.8" height="6.8" rx="1.2"/><rect x="4" y="13.2" width="6.8" height="6.8" rx="1.2"/><rect x="13.2" y="13.2" width="6.8" height="6.8" rx="1.2"/>',
  star: '<path d="m12 3.6 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.6Z"/>',
  search: '<circle cx="11" cy="11" r="6.3"/><path d="m19.8 19.8-3.5-3.5"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L14 3.5Z"/><path d="M14 3.5v5h5"/>',
  sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z"/><path d="m18.8 15 .7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z"/>',
  moon: '<path d="M19.8 13.8A8 8 0 0 1 10.2 4.2 8 8 0 1 0 19.8 13.8Z"/>',
  sun: '<circle cx="12" cy="12" r="3.9"/><path d="M12 2.8v2M12 19.2v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.8 12h2M19.2 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sliders: '<path d="M4 7.2h8.4M16.4 7.2H20M4 12h2.4M10.4 12H20M4 16.8h11.4M19.4 16.8H20"/><circle cx="14.4" cy="7.2" r="1.9"/><circle cx="8.4" cy="12" r="1.9"/><circle cx="17.4" cy="16.8" r="1.9"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M9.3 10v9.5M14.7 10v9.5"/>',
  code: '<path d="m8.4 8-4 4 4 4M15.6 8l4 4-4 4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.4a1.9 1.9 0 0 0 0-3.8H12a1.6 1.6 0 0 1 0-3.2h6.1a2.4 2.4 0 0 0 2.4-2.4A8.1 8.1 0 0 0 12 3.5Z"/><circle cx="7.4" cy="11.2" r="1"/><circle cx="9.4" cy="7.4" r="1"/><circle cx="13.6" cy="6.8" r="1"/><circle cx="17" cy="9" r="1"/>',
  zap: '<path d="M13 2.8 4.6 13.4h5.8L11 21.2l8.4-10.6h-5.8l-.6-7.8Z"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.2V12l3.2 1.9"/>',
  alert: '<path d="M10.3 4.4 3.1 16.9a2 2 0 0 0 1.7 3h14.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z"/><path d="M12 9.2v4M12 16.6h.01"/>',
  a11y: '<circle cx="12" cy="4.9" r="1.9"/><path d="M4.8 9.2c4.7 1.3 9.7 1.3 14.4 0M12 10.2v4.4l-3 5.4M12 14.6l3 5.4"/>',
  cursor: '<path d="m4.6 4.6 6.9 15.7 2.1-6.7 6.7-2.1L4.6 4.6Z"/>',
  hand: '<path d="M8.6 12.6V6.7a1.4 1.4 0 0 1 2.8 0v4.6m0-5.6a1.4 1.4 0 0 1 2.8 0v5.6m0-4.3a1.4 1.4 0 0 1 2.8 0v6.2m0-3.3a1.4 1.4 0 0 1 2.8 0v4.8a6.2 6.2 0 0 1-6.2 6.2h-1.2a6.2 6.2 0 0 1-4.9-2.4l-2.8-3.6c-.8-1-.1-2.5 1.2-2.5.5 0 1 .2 1.4.7l1.3 1.6"/>',
  square: '<rect x="4.5" y="4.5" width="15" height="15" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>',
  hexagon: '<path d="M12 3.4 19.5 7.7v8.6L12 20.6 4.5 16.3V7.7L12 3.4Z"/>',
  line: '<path d="M5 19 19 5"/>',
  arrow: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>',
  pen: '<path d="m14.4 5.2 4.4 4.4L8.2 20.2H3.8v-4.4L14.4 5.2Z"/><path d="m12.4 7.2 4.4 4.4"/>',
  frame: '<path d="M7.2 3v18M16.8 3v18M3 7.2h18M3 16.8h18"/>',
  eyedropper: '<path d="m12.6 6.6 4.8 4.8M9.2 10 4 15.2a1.9 1.9 0 0 0-.6 1.4v2.6a1.4 1.4 0 0 0 1.4 1.4h2.6a1.9 1.9 0 0 0 1.4-.6l5.2-5.2M17.2 3.6a2.3 2.3 0 0 1 3.2 3.2L18 9.2l.9.9-1.8 1.8-6-6L12.9 4l.9.9 3.4-1.3Z"/>',
  // Asset manager chrome.
  upload: '<path d="M12 16.5V4.2M7.5 8.7 12 4.2l4.5 4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4.2v12.3M7.5 12l4.5 4.5 4.5-4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  list: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  expand: '<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>',
  shrink: '<path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-.7 4.4"/><path d="M20 4.5v6h-6"/>',
  library: '<path d="M4.5 5.5h3v14h-3zM10 5.5h3v14h-3z"/><path d="m16.2 6.3 2.9-.8 3.4 12.5-2.9.8z"/>',
};

/** Inline monoline SVG for editor chrome. Unknown names return the name so a
 *  typo is visible in the UI instead of silently rendering an empty button. */
export function chromeIcon(name: string, size = 16): string {
  const p = paths[name];
  if (!p) return name;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
