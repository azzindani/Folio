/**
 * Where the bundled raster fonts live — asked without importing Node.
 *
 * mcp/engine/fonts.ts resolves the same folder with `path` at import time and
 * drags the asset library (fs, crypto, zlib) in behind it. That is fine on the
 * server and fatal in the editor bundle, where `path` is an empty stub and the
 * module throws while loading. The frame pipeline (gif-frames → frame-geometry)
 * now runs in both places — the editor plays a multi-scene piece through the
 * export's own compositor — so it asks here. A browser has no such folder: the
 * answer is null and text measures by the layout estimate.
 */
export function bundledFontsDir(): string | null {
  const proc = (globalThis as { process?: { cwd?: unknown } }).process;
  return typeof proc?.cwd === 'function' ? `${(proc.cwd as () => string)()}/src/mcp/fonts` : null;
}
