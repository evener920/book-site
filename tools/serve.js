const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2'
};

// 起一个临时静态服务（端口自动分配），供 Playwright 访问本地 dist
function serve(dir) {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(dir, p);
      fs.readFile(fp, function (err, data) {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', function () { resolve(srv); });
  });
}

// 兼容多种安装位置：环境变量 > 本地 node_modules > 全局 npm > 内置 playwright-cli
function getChromium() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE_PATH) candidates.push(process.env.PLAYWRIGHT_CORE_PATH);
  candidates.push('playwright-core');
  candidates.push('playwright');
  try {
    const root = require('child_process').execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (root) candidates.push(require('path').join(root, '@playwright/cli/node_modules/playwright-core'));
  } catch (e) { /* 忽略 */ }
  candidates.push('/Users/evener920/.workbuddy/binaries/node/versions/22.22.2-6/lib/node_modules/@playwright/cli/node_modules/playwright-core');

  for (let i = 0; i < candidates.length; i++) {
    try { return require(candidates[i]).chromium; } catch (e) { /* 继续尝试 */ }
  }
  throw new Error('未找到 playwright-core。请 npm i -D playwright-core && npx playwright install chromium，或设置 PLAYWRIGHT_CORE_PATH 指向它。');
}

module.exports = { serve: serve, getChromium: getChromium };
