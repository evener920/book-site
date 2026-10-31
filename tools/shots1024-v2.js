const { chromium } = require('playwright-core');
const OUT = '/Users/evener920/WorkBuddy/2026-10-28-23-33-28/book-site/shots1024';
const BASE = 'http://localhost:8773/';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // 1) 首页 + 顶部搜索框
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const p = document.getElementById('page');
    return p && p.innerText.length > 50;
  }, { timeout: 20000 });
  await wait(900);
  await page.screenshot({ path: `${OUT}/01-首页与搜索框.png` });

  // 2) 目录（81 章 / 分卷）—— 临时拉高视口，让限高的侧边栏自然展开全部 81 章
  await page.setViewportSize({ width: 1280, height: 3800 });
  await wait(400);
  await page.evaluate(() => {
    const toc = document.getElementById('toc');
    toc.classList.add('open');
    toc.classList.remove('collapsed');
    const mask = document.getElementById('toc-mask');
    if (mask) mask.classList.add('hidden');
  });
  await page.waitForFunction(() => document.querySelectorAll('#toc-list li').length >= 81, { timeout: 6000 });
  await wait(600);
  await page.locator('#toc').screenshot({ path: `${OUT}/02-目录81章.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await wait(300);
  await page.evaluate(() => {
    const toc = document.getElementById('toc');
    toc.classList.remove('open');
    toc.classList.add('collapsed');
  });
  await wait(300);

  // 3) 正文深度阅读（翻到第 3 页，展示异文校勘 / 逐句疏解）
  for (let i = 0; i < 2; i++) { await page.evaluate(() => document.getElementById('btn-next').click()); await wait(500); }
  await wait(700);
  await page.screenshot({ path: `${OUT}/03-正文深度阅读.png` });

  // 4) 全文搜索（输入“无为”，展示结果下拉）
  await page.type('#search-input', '无为', { delay: 60 });
  await page.waitForSelector('#search-results:not(.hidden)', { timeout: 6000 });
  await wait(700);
  await page.screenshot({ path: `${OUT}/04-全文搜索.png` });

  // 5) 批注划线（选中正文文字，触发浮动工具条）
  await page.fill('#search-input', '');
  await wait(300);
  await page.evaluate(() => {
    const p = document.querySelector('#page p');
    if (!p || !p.firstChild) return;
    const len = p.firstChild.length || 20;
    const range = document.createRange();
    range.setStart(p.firstChild, 0);
    range.setEnd(p.firstChild, Math.min(24, len));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForSelector('#ann-toolbar:not(.hidden)', { timeout: 6000 }).catch(() => {});
  await wait(600);
  await page.screenshot({ path: `${OUT}/05-批注划线.png` });

  await page.close();

  // 6) 手机端（iPhone 视口）
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
  await m.goto(BASE, { waitUntil: 'networkidle' });
  await m.waitForFunction(() => {
    const p = document.getElementById('page');
    return p && p.innerText.length > 50;
  }, { timeout: 20000 });
  await wait(900);
  await m.screenshot({ path: `${OUT}/06-手机端.png` });
  await m.close();

  await browser.close();
  console.log('screenshots done');
})().catch(e => { console.error(e.message); process.exit(1); });
