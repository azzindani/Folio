import { chromium } from 'playwright';
const PORT = Number(process.env.FOLIO_AUDIT_PORT ?? 5073);
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const failures = [];
p.on('requestfailed', r => failures.push({ url: r.url(), err: r.failure()?.errorText }));
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await p.waitForTimeout(2000);
const info = await p.evaluate(async () => {
  await document.fonts.ready;
  const fonts = [];
  for (const f of document.fonts) fonts.push({ family: f.family, weight: f.weight, status: f.status });
  return {
    fontCount: fonts.length,
    fontSample: fonts.slice(0, 10),
    googleFontLink: !!document.querySelector('link[href*="fonts.googleapis.com"]'),
  };
});
console.log('Failed requests:', failures.filter(f => f.url.includes('font')).slice(0, 5));
console.log(JSON.stringify(info, null, 2));
await b.close();
