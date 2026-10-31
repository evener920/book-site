// 生成站点 favicon：宣纸底 + 朱砂水波三叠（上善若水）
// 纯矢量图形，无字体依赖。输出到 src/（build.js 会整目录拷进 dist）：
//   favicon.svg / favicon-32.png / favicon-192.png / favicon-512.png / apple-touch-icon.png
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const srcDir = path.join(__dirname, '..', 'src');

// 上善若水：三条朱砂水波（512 基准）
const WAVES = `
  <path d="M94 166 Q171 115 256 166 T418 166" fill="none" stroke="#a3412d" stroke-width="47" stroke-linecap="round"/>
  <path d="M94 269 Q171 218 256 269 T418 269" fill="none" stroke="#a3412d" stroke-width="47" stroke-linecap="round"/>
  <path d="M94 371 Q171 320 256 371 T418 371" fill="none" stroke="#a3412d" stroke-width="47" stroke-linecap="round"/>
`;

function svgSource() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="道德经·网页书">
  <rect width="512" height="512" rx="110" fill="#f7f2e5"/>
  ${WAVES}
</svg>
`;
}

(async () => {
  const svgFile = path.join(srcDir, 'favicon.svg');
  fs.writeFileSync(svgFile, svgSource());
  console.log('-> src/favicon.svg');

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const jobs = [
    { size: 512, file: 'favicon-512.png' },
    { size: 192, file: 'favicon-192.png' },
    { size: 180, file: 'apple-touch-icon.png' },
    { size: 32, file: 'favicon-32.png' }
  ];
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    // data URL 加载 SVG，等比铺满视口
    const b64 = Buffer.from(svgSource()).toString('base64');
    await page.goto('data:image/svg+xml;base64,' + b64, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(srcDir, j.file), omitBackground: true });
    await page.close();
    console.log('-> src/' + j.file + ' (' + j.size + 'px)');
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
