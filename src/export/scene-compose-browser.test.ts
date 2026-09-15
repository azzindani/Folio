// @vitest-environment node
// esbuild refuses to start under jsdom: its TextEncoder is not the Node one.
import { describe, it, expect } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { builtinModules } from 'module';
import * as path from 'path';

// The editor's Play all renders a multi-scene piece through the export's own
// compositor, so that whole module graph ships in the browser bundle. One Node
// import anywhere in it stops the editor loading: mcp/engine/fonts resolved a
// path at import and dragged in the asset library, crypto and zlib behind it.
// font-metrics is the known exception — its fs calls sit behind try/catch and
// the renderer has shipped it in the editor for months.
const ALLOWED = new Set(['src/utils/font-metrics.ts']);
const NODE = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);

async function nodeImports(entryPoints: string[]): Promise<string[]> {
  const found = new Set<string>();
  const watch: Plugin = {
    name: 'node-imports',
    setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (!NODE.has(args.path)) return undefined;
        const from = path.relative(process.cwd(), args.importer).split(path.sep).join('/');
        if (!ALLOWED.has(from)) found.add(`${from} → ${args.path}`);
        return { path: args.path, external: true };
      });
    },
  };
  await build({ entryPoints, bundle: true, write: false, outdir: 'out', platform: 'browser', format: 'esm', logLevel: 'silent', plugins: [watch] });
  return [...found].sort();
}

describe('the scene compositor runs in a browser', () => {
  it('imports nothing from Node outside font-metrics', async () => {
    expect(await nodeImports(['src/export/scene-compose.ts', 'src/export/scene-plan.ts', 'src/editor/scene-player.ts'])).toEqual([]);
  }, 60_000);
});
