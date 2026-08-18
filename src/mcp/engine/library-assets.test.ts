import { describe, it, expect } from 'vitest';
import { ASSET_STYLE, ASSET_SCRIPT, ASSET_ASSETS, assetDrawerMarkup } from './library-assets';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Library's assets drawer — now a FRAME, not a file manager.
 *
 * It used to be a second implementation: its own picker, verbs, dialogs and
 * grid, sharing nothing with the editor's panel but the endpoints. The two
 * drifted exactly as duplicates do — the editor's manager was rebuilt three
 * times over while this one still had a "New folder" button that only primed
 * an upload and no way to delete a folder at all. Anyone standing here saw
 * none of the fixes.
 *
 * These checks defend the de-duplication: the drawer must HOST the shared
 * explorer and must not grow a file manager of its own again.
 */
describe('library assets drawer', () => {
  const markup = assetDrawerMarkup([{ name: 'automation-first-flow' }]);

  it('hosts the shared explorer instead of its own grid', () => {
    expect(markup).toContain('id="axmount"');
    expect(ASSET_SCRIPT).toContain('FolioAssets.mount');
  });

  it('loads the standalone explorer bundle by its stable name', () => {
    // vite.assets.config.ts exists to emit exactly these two filenames; hashed
    // names could not be linked from a server-rendered page.
    expect(ASSET_ASSETS).toContain('/asset-explorer.js');
    expect(ASSET_ASSETS).toContain('/asset-explorer.css');
  });

  it('does NOT re-implement a file manager', () => {
    // The ids of the drawer that used to duplicate the explorer. If any comes
    // back, the two managers have started to diverge again — which is the bug
    // this whole file is about, not a style preference.
    for (const id of ['aproj', 'aupload', 'anewfolder', 'arenfolder', 'adelfolder', 'agrid', 'achips', 'afile']) {
      expect(markup, `#${id} is back — the drawer is growing its own manager again`)
        .not.toContain(`id="${id}"`);
    }
    expect(ASSET_SCRIPT, 'the drawer is talking to the asset API directly again')
      .not.toContain('__assets/manage');
  });

  it('bridges every design token the shared stylesheet needs', () => {
    // The explorer is styled in the editor's tokens; this page has its own
    // names. A token used by the stylesheet but unmapped here renders as an
    // invalid value — invisible text, no borders — only on the Library.
    const css = fs.readFileSync(
      path.resolve(__dirname, '../../styles/asset-explorer.css'), 'utf8');
    const needed = new Set(
      [...css.matchAll(/var\((--color-[a-z0-9-]+|--radius-[a-z0-9-]+|--font-[a-z0-9-]+)/g)]
        .map(m => m[1] as string));
    expect(needed.size, 'no tokens found — did the stylesheet move?').toBeGreaterThan(5);
    for (const token of needed) {
      expect(ASSET_STYLE, `${token} is not mapped for the Library's palette`)
        .toContain(`${token}:`);
    }
  });

  it('says so when the deferred bundle has not arrived yet', () => {
    // Opening onto a blank pane is precisely how "I can't do anything" starts.
    expect(ASSET_SCRIPT).toContain('Still loading the file manager');
  });

  it('supports the ?assets=<project> deep link', () => {
    expect(ASSET_SCRIPT).toContain("get('assets')");
  });

  it('is an IIFE so it cannot leak names into the library page script', () => {
    expect(ASSET_SCRIPT.trim().startsWith('(function(){')).toBe(true);
    expect(ASSET_SCRIPT.trim().endsWith('})();')).toBe(true);
  });

  it('ships a touch-sized close control and a drawer that can hold the manager', () => {
    expect(ASSET_STYLE).toMatch(/\.abtn\{[^}]*min-height:44px/);
    // .ax is height:100%, so its box needs a definite height or the manager
    // collapses to nothing.
    expect(ASSET_STYLE).toMatch(/\.axmount\{[^}]*flex:1[^}]*min-height:0/);
  });
});
