// Folio — shared browser-tab favicon for every HTML surface.
//
// The editor gets its icon from index.html, but every OTHER page Folio emits
// (the /library gallery, exported gallery/report/presentation/print HTML, the
// OAuth + token-required pages) rendered a blank tab. The icon is inlined as a
// data URI so self-contained exports stay self-contained and server-rendered
// pages don't depend on a /favicon.svg route. Source of truth for the artwork
// is public/favicon.svg — regenerate FAVICON_DATA_URI from it if it changes
// (`base64 -w0 public/favicon.svg`).

const FAVICON_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJGb2xpbyI+CiAgPCEtLSBSb3VuZGVkIGRhcmsgdGlsZSAobWF0Y2hlcyBEYXJrIFRlY2ggZWRpdG9yIGNocm9tZSkgLS0+CiAgPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzE1MTUxZiIvPgogIDwhLS0gQmFjayBzaGVldCAob2Zmc2V0IHVwLWxlZnQsIGRpbW1lcikgLS0+CiAgPHJlY3QgeD0iOC41IiB5PSI2LjUiIHdpZHRoPSIxMyIgaGVpZ2h0PSIxNyIgcng9IjIiCiAgICAgICAgZmlsbD0iIzJhMmEzZCIgc3Ryb2tlPSIjNmM1Y2U3IiBzdHJva2Utd2lkdGg9IjEuMSIgc3Ryb2tlLW9wYWNpdHk9IjAuNTUiLz4KICA8IS0tIEZyb250IHNoZWV0IChvZmZzZXQgZG93bi1yaWdodCwgYnJhbmQgaW5kaWdvKSAtLT4KICA8Zz4KICAgIDxyZWN0IHg9IjExLjUiIHk9IjkuNSIgd2lkdGg9IjEzIiBoZWlnaHQ9IjE3IiByeD0iMiIgZmlsbD0iIzZjNWNlNyIvPgogICAgPCEtLSBUZXh0IGxpbmVzIG9uIHRoZSBmcm9udCBzaGVldCAtLT4KICAgIDxyZWN0IHg9IjE0IiAgIHk9IjEzIiAgIHdpZHRoPSI4IiAgIGhlaWdodD0iMS42IiByeD0iMC44IiBmaWxsPSIjZmZmZmZmIiBmaWxsLW9wYWNpdHk9IjAuOTIiLz4KICAgIDxyZWN0IHg9IjE0IiAgIHk9IjE2IiAgIHdpZHRoPSI4IiAgIGhlaWdodD0iMS42IiByeD0iMC44IiBmaWxsPSIjZmZmZmZmIiBmaWxsLW9wYWNpdHk9IjAuNyIvPgogICAgPHJlY3QgeD0iMTQiICAgeT0iMTkiICAgd2lkdGg9IjUuNSIgaGVpZ2h0PSIxLjYiIHJ4PSIwLjgiIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC43Ii8+CiAgICA8cmVjdCB4PSIxNCIgICB5PSIyMiIgICB3aWR0aD0iOCIgICBoZWlnaHQ9IjEuNiIgcng9IjAuOCIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1vcGFjaXR5PSIwLjQ1Ii8+CiAgPC9nPgo8L3N2Zz4K';

/** `<link rel="icon">` tag ready to drop into any `<head>`. */
export const FAVICON_LINK =
  `<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">`;
