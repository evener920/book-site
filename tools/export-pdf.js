// 用 Chromium 原生打印管线导出出版级 PDF（A4、宣纸底、每页带页码）
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });

  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__bookReady === true', { timeout: 30000 });

  const info = await page.evaluate(function () {
    return {
      pages: window.__bookPages,
      prebuilt: window.__bookPrebuilt,
      numbering: window.__bookNumbering
    };
  });

  // 构建整本打印 DOM，切换到打印媒体后导出
  await page.evaluate(function () { return window.__buildPrintBook(); });
  await page.emulateMedia({ media: 'print' });

  const pdfPath = path.join(distDir, 'book.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
  });

  await browser.close();
  srv.close();

  const size = fs.statSync(pdfPath).size;
  console.log('✓ PDF 导出完成：' + info.pages + ' 页 → dist/book.pdf');
  console.log('  大小 ' + Math.round(size / 1024) + ' KB ｜ 预构建=' + info.prebuilt + ' ｜ 编号=' + info.numbering);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
