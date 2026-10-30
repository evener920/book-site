// 渲染 book.pdf 指定页为 PNG（验证打印分页用）
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright-core'));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  const pdfB64 = fs.readFileSync(path.join(root, 'dist', 'book.pdf')).toString('base64');
  await page.setContent('<div id=m></div>');
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js' });
  const pagesToCheck = process.argv.slice(2).map(Number);
  const list = pagesToCheck.length ? pagesToCheck : [2, 3];
  const res = await page.evaluate(async (args) => {
    const { b64, list } = args;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: atob(b64) }).promise;
    const out = [];
    for (const n of list) {
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 1.2 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push({ n, data: c.toDataURL('image/png') });
    }
    return out;
  }, { b64: pdfB64, list });
  for (const r of res) {
    const f = '/tmp/pdfchk_p' + r.n + '.png';
    fs.writeFileSync(f, Buffer.from(r.data.split(',')[1], 'base64'));
    console.log('-> ' + f);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
