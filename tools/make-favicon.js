// 生成站点 favicon：宣纸底 + 朱砂印章「道」
// 输出到 src/（build.js 会整目录拷进 dist）：
//   favicon.svg / favicon-32.png / favicon-192.png / favicon-512.png / apple-touch-icon.png
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const srcDir = path.join(__dirname, '..', 'src');

// 设计（以 512 为基准）：宣纸圆角底、朱砂内框（印章感）、居中「道」字
function html(size) {
  const s = size;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;}
    #seal{
      width:${s}px;height:${s}px;box-sizing:border-box;
      background:#f7f2e5;
      border-radius:${Math.round(s * 0.2)}px;
      display:flex;align-items:center;justify-content:center;
      position:relative;
    }
    #seal::after{
      content:'';position:absolute;
      inset:${Math.round(s * 0.085)}px;
      border:${Math.max(1, Math.round(s * 0.032))}px solid #a3412d;
      border-radius:${Math.round(s * 0.09)}px;
    }
    #c{
      font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;
      font-weight:700;
      color:#a3412d;
      font-size:${Math.round(s * 0.56)}px;
      line-height:1;
      transform:translateY(${Math.round(s * 0.015)}px);
    }
  </style></head><body><div id="seal"><span id="c">道</span></div></body></html>`;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const jobs = [
    { size: 512, file: 'favicon-512.png' },
    { size: 192, file: 'favicon-192.png' },
    { size: 180, file: 'apple-touch-icon.png' },
    { size: 32, file: 'favicon-32.png' }
  ];
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    await page.setContent(html(j.size), { waitUntil: 'load' });
    await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} });
    const el = await page.$('#seal');
    await el.screenshot({ path: path.join(srcDir, j.file), omitBackground: true });
    await page.close();
    console.log('-> src/' + j.file + ' (' + j.size + 'px)');
  }
  await browser.close();

  // 同款矢量版（现代浏览器优先用它，任何缩放都清晰）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="道德经·网页书">
  <rect width="512" height="512" rx="102" fill="#f7f2e5"/>
  <rect x="44" y="44" width="424" height="424" rx="46" fill="none" stroke="#a3412d" stroke-width="16"/>
  <text x="256" y="256" text-anchor="middle" dominant-baseline="central"
        font-family="Songti SC,STSong,Noto Serif SC,SimSun,serif" font-weight="700"
        font-size="287" fill="#a3412d">道</text>
</svg>
`;
  fs.writeFileSync(path.join(srcDir, 'favicon.svg'), svg);
  console.log('-> src/favicon.svg');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
