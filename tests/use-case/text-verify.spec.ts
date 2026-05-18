import { test } from '@playwright/test';
import { loadYAMLIntoEditor, waitForFolioReady } from './_helpers';

const SUSPECTS = [
  { bug: 'BUG-003', file: '25-magazine-cover.template.yaml',                  expect: 'ATELIER' },
  { bug: 'BUG-008', file: '406-feature-launch-poster.template.yaml',          expect: 'system sync' },
  { bug: 'BUG-009', file: '407-campaign-results-poster.template.yaml',        expect: 'BLENDED CAC' },
  { bug: 'BUG-012', file: '273-spotify-wrapped-card.template.yaml',           expect: 'LISTENED' },
];

test('text-content verification for suspect bugs', async ({ page }) => {
  await page.goto('/');
  await waitForFolioReady(page);

  for (const s of SUSPECTS) {
    const yaml = await page.evaluate(async (f: string) => {
      const r = await fetch(`/templates/builtin/${f}`);
      return r.ok ? await r.text() : null;
    }, s.file);
    if (!yaml) { console.log(`${s.bug}: ${s.file} → FETCH FAIL`); continue; }
    await loadYAMLIntoEditor(page, yaml);
    await page.waitForTimeout(400);
    const allText = await page.evaluate(() => {
      const t: string[] = [];
      document.querySelectorAll('.canvas-area svg text').forEach(n => t.push(n.textContent ?? ''));
      return t.join(' | ');
    });
    const hasExpected = allText.includes(s.expect);
    // eslint-disable-next-line no-console
    console.log(`${s.bug} | "${s.expect}" present: ${hasExpected}`);
    if (!hasExpected) {
      // eslint-disable-next-line no-console
      console.log('  ALL TEXT:', allText.slice(0, 800));
    }
  }
});
