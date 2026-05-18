import { test } from '@playwright/test';
import { loadYAMLIntoEditor, waitForFolioReady } from './_helpers';

test('verify BUG-008 text content', async ({ page }) => {
  await page.goto('/');
  await waitForFolioReady(page);
  const yaml = await page.evaluate(async () => {
    const r = await fetch('/templates/builtin/406-feature-launch-poster.template.yaml');
    return r.text();
  });
  await loadYAMLIntoEditor(page, yaml);
  await page.waitForTimeout(500);

  // Extract all text content from rendered SVG.
  const textNodes = await page.evaluate(() => {
    const out: { tag: string; content: string }[] = [];
    document.querySelectorAll('.canvas-area svg text, .canvas-area svg tspan').forEach(t => {
      out.push({ tag: t.tagName, content: t.textContent ?? '' });
    });
    return out;
  });
  // eslint-disable-next-line no-console
  console.log('\n--- TEXT NODES ---');
  // eslint-disable-next-line no-console
  textNodes.forEach((t, i) => console.log(`${i}: [${t.tag}] "${t.content}"`));
});
