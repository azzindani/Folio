import { describe, it, expect } from 'vitest';
import { ASSET_STYLE, ASSET_SCRIPT, assetDrawerMarkup } from './library-assets';

describe('library assets drawer', () => {
  const markup = assetDrawerMarkup([{ name: 'automation-first-flow' }, { name: 'my "quoted" proj' }]);

  it('lists every project in the picker', () => {
    expect(markup).toContain('<option value="automation-first-flow">automation-first-flow</option>');
  });

  it('escapes project names into the option markup', () => {
    expect(markup).toContain('my &quot;quoted&quot; proj');
    expect(markup).not.toContain('my "quoted" proj</option>');
  });

  it('carries the controls the upload flow needs', () => {
    for (const id of ['adrawer', 'aproj', 'aupload', 'anewfolder', 'arefresh', 'aclose', 'afile', 'asearch', 'achips', 'agrid', 'afoot']) {
      expect(markup, `#${id} present`).toContain(`id="${id}"`);
    }
    expect(markup).toContain('multiple');
  });

  it('accepts images and fonts only', () => {
    expect(markup).toMatch(/accept="[^"]*image\/png[^"]*"/);
    expect(markup).toMatch(/accept="[^"]*woff2[^"]*"/);
    expect(markup).not.toContain('.exe');
  });

  it('posts uploads and management to the shared project-files endpoints', () => {
    expect(ASSET_SCRIPT).toContain("'/__project_files/'");
    expect(ASSET_SCRIPT).toContain("'/__assets'");
    expect(ASSET_SCRIPT).toContain("'/__assets/manage'");
    // The library page is cookie-authenticated; every call must opt in.
    expect(ASSET_SCRIPT.match(/credentials:'include'/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('routes fonts to assets/fonts and everything else to assets/images', () => {
    expect(ASSET_SCRIPT).toContain("/\\.(ttf|otf|woff2?)$/i.test(f.name)?'fonts':'images'");
  });

  it('supports the ?assets=<project> deep link', () => {
    expect(ASSET_SCRIPT).toContain("get('assets')");
  });

  it('is an IIFE so it cannot leak names into the library page script', () => {
    expect(ASSET_SCRIPT.trim().startsWith('(function(){')).toBe(true);
    expect(ASSET_SCRIPT.trim().endsWith('})();')).toBe(true);
  });

  it('ships styles with touch-sized controls', () => {
    expect(ASSET_STYLE).toContain('.adrawer');
    expect(ASSET_STYLE).toMatch(/\.abtn\{[^}]*min-height:44px/);
  });
});
