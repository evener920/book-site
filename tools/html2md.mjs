// 把「深度阅读」系列 HTML 稿转成书的 Markdown（供 content/ 使用）
// 用法：node tools/html2md.mjs <输入.html> [输出.md]
// 依赖 playwright-core（项目已装），用真实浏览器解析 DOM，避免手写正则漏标签
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const src = process.argv[2];
const out = process.argv[3] || '';
if (!src) { console.error('用法: node tools/html2md.mjs <输入.html> [输出.md]'); process.exit(1); }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('file://' + path.resolve(src), { waitUntil: 'load', timeout: 30000 });

const md = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);

  // 行内格式：strong/b → **  ；em/i → * ；span.hl → ** ；span.tag → 「」
  function inline(node) {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { s += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      const cls = typeof n.className === 'string' ? n.className : '';
      const inner = inline(n);
      if (tag === 'br') s += '\n';
      else if (tag === 'strong' || tag === 'b') s += inner.trim() ? '**' + inner.trim() + '**' : '';
      else if (tag === 'em' || tag === 'i') s += inner.trim() ? '*' + inner.trim() + '*' : '';
      else if (/\bhl\b/.test(cls)) s += inner.trim() ? '**' + inner.trim() + '**' : '';
      else if (/\btag\b/.test(cls)) s += inner.trim() ? '「' + inner.trim() + '」' : '';
      else s += inner;
    }
    return s;
  }

  const clean = (t) => t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  function table(el) {
    const rows = [...el.querySelectorAll('tr')];
    if (!rows.length) return '';
    const grid = rows.map(r => [...r.children].map(c => clean(inline(c).replace(/\n/g, ' '))));
    const cols = Math.max(...grid.map(r => r.length));
    const pad = (r) => { while (r.length < cols) r.push(''); return r; };
    const lines = [];
    lines.push('| ' + pad(grid[0]).join(' | ') + ' |');
    lines.push('|' + new Array(cols).fill(' --- ').join('|') + '|');
    for (let i = 1; i < grid.length; i++) lines.push('| ' + pad(grid[i]).join(' | ') + ' |');
    return lines.join('\n');
  }

  const blocks = [];
  const root = q('.wrap') || document.body;

  function walk(el) {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase();
      const cls = typeof n.className === 'string' ? n.className : '';

      if (tag === 'header') continue;                 // 标题由书自己生成
      if (/^(style|script)$/.test(tag)) continue;

      if (tag === 'h1') continue;
      if (tag === 'h2') { blocks.push('## ' + clean(inline(n))); continue; }
      if (tag === 'h3') { blocks.push('### ' + clean(inline(n))); continue; }

      if (tag === 'table') { blocks.push(table(n)); continue; }

      // 原文大字块 → 引用块，一行一个 >
      if (/\borig\b/.test(cls)) {
        const t = clean(inline(n)).split('\n').map(l => l.trim()).filter(Boolean);
        blocks.push(t.map(l => '> ' + l).join('\n>\n'));
        continue;
      }

      // 卡片：.t 是卡片标题，其余是正文
      if (/\bcard\b/.test(cls)) {
        const t = n.querySelector('.t');
        const title = t ? clean(inline(t)) : '';
        // 注意：子节点之间不能插入空格，否则中文会被切成「天地的 逻辑与时间」这种断字
        const rest = [...n.childNodes]
          .filter(c => !(c.nodeType === 1 && c.classList && c.classList.contains('t')))
          .map(c => c.nodeType === 3 ? c.nodeValue : inline(c))
          .join('')
          .replace(/\s+/g, ' ')
          .replace(/([\u4e00-\u9fa5，。；：、「」（）《》])\s+(?=[\u4e00-\u9fa5，。；：、「」（）《》])/g, '$1')
          .trim();
        blocks.push('**' + (title || '备注') + '**　' + rest);
        continue;
      }

      // 提示框 → 引用
      if (/\bnote\b/.test(cls)) {
        blocks.push('> ' + clean(inline(n)));
        continue;
      }

      if (tag === 'p') {
        const t = clean(inline(n));
        if (t) blocks.push(/\bsmall\b/.test(cls) ? '> ' + t : t);
        continue;
      }

      if (tag === 'ul' || tag === 'ol') {
        const items = [...n.querySelectorAll(':scope > li')].map((li, i) =>
          (tag === 'ol' ? (i + 1) + '. ' : '- ') + clean(inline(li)));
        if (items.length) blocks.push(items.join('\n'));
        continue;
      }

      if (tag === 'div' || tag === 'section' || tag === 'article') {
        // 容器：有子块就递归，纯文本就当段落
        const hasBlock = [...n.children].some(c =>
          /^(section|div|p|h[1-6]|table|ul|ol|header)$/i.test(c.tagName));
        if (hasBlock) { walk(n); continue; }
        const t = clean(inline(n));
        if (t) blocks.push(t);
        continue;
      }

      const t = clean(inline(n));
      if (t) blocks.push(t);
    }
  }

  walk(root);
  return blocks.filter(Boolean).join('\n\n');
});

await browser.close();

const text = md.replace(/\n{3,}/g, '\n\n').trim();
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text + '\n');
  console.log('✓ 写出 ' + out + '（' + text.replace(/\s/g, '').length + ' 字，' + text.split('\n\n').length + ' 个块）');
} else {
  process.stdout.write(text + '\n');
}
