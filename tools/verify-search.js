const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8137, r));
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('requestfailed', r => { if (!/favicon/.test(r.url())) errors.push('reqfail ' + r.url()); });

  await page.goto('http://localhost:8137/', { waitUntil: 'load' });
  // 等搜索索引构建（pages 加载完，#app.ready 或 window.__bookReady）
  await page.waitForFunction(() => window.__bookReady === true, { timeout: 20000 });
  const pages = await page.evaluate(() => window.__bookPages);
  console.log('pages loaded:', pages);

  // 1) 输入“无为”（必有命中）
  await page.fill('#search-input', '无为');
  await page.waitForSelector('#search-results:not(.hidden) .search-item', { timeout: 5000 });
  const hitCount = await page.evaluate(() => document.querySelectorAll('#search-results .search-item').length);
  const firstTitle = await page.evaluate(() => document.querySelector('#search-results .search-item .si-title').textContent);
  console.log('「无为」命中结果数(截断50):', hitCount, '| 首项:', firstTitle);

  // 2) 点击第一项 → 应跳页且正文出现 <mark>
  await page.click('#search-results .search-item');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const marks = document.querySelectorAll('.page mark');
    return { marks: marks.length, indicator: document.getElementById('page-indicator').textContent };
  });
  console.log('点击后：正文高亮 <mark> 数 =', after.marks, '| 页码指示 =', after.indicator);

  // 3) 搜索无关键词 → 未找到
  await page.fill('#search-input', 'zzzxx无此词');
  await page.waitForSelector('#search-results .search-empty', { timeout: 5000 });
  const emptyTxt = await page.evaluate(() => document.querySelector('.search-empty').textContent);
  console.log('无命中提示:', emptyTxt);

  // 4) 清空 → 下拉隐藏
  await page.fill('#search-input', '');
  await page.waitForTimeout(300);
  const hidden = await page.evaluate(() => document.getElementById('search-results').classList.contains('hidden'));
  console.log('清空后下拉隐藏:', hidden);

  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
