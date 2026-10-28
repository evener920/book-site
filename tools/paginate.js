// 构建时用真实浏览器测量切页，产出 dist/pages.json
// 用途：让页码在服务端算一次，避免不同访客字体/浏览器导致页码不一致
const fs = require('fs');
const path = require('path');
const { serve, getChromium } = require('./serve');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');

(async function () {
  const chromium = getChromium();
  const srv = await serve(distDir);
  const port = srv.address().port;

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });

  await page.goto('http://127.0.0.1:' + port + '/index.html?measure=1', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__bookReady === true', { timeout: 30000 });

  const result = await page.evaluate(function () { return window.__bookPagesHtml || []; });
  await browser.close();
  srv.close();

  if (!result.length) {
    console.error('✗ 未测得分页结果，请确认 dist 已构建且 content 有文章');
    process.exit(1);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'prebuilt-by-playwright',
    pages: result.map(function (p, i) {
      return {
        globalPage: i + 1,
        volume: p.volume || '',
        volumePage: p.volumePage || 0,
        firstTitle: p.firstTitle || '',
        html: p.html
      };
    })
  };

  fs.writeFileSync(path.join(distDir, 'pages.json'), JSON.stringify(out));
  console.log('✓ 精确分页完成：' + result.length + ' 页 → dist/pages.json');

  const vols = {};
  result.forEach(function (p) {
    const v = p.volume || '未分卷';
    vols[v] = (vols[v] || 0) + 1;
  });
  Object.keys(vols).forEach(function (v) { console.log('  【' + v + '】' + vols[v] + ' 页'); });
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
