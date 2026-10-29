const fs = require('fs');
const path = require('path');

const root = __dirname;
const contentDir = path.join(root, 'content');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

function parseFrontmatter(raw) {
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split(/\r?\n/).forEach(function (line) {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      v = v.replace(/^["']|["']$/g, '');
      meta[k] = v;
    }
  });
  return { meta: meta, body: m[2] };
}

function stripFrontmatter(raw) {
  return raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 递归收集 md，支持 <卷名>/ 子目录
function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(full, rel, out);
    else if (entry.name.endsWith('.md')) out.push({ rel: rel, full: full });
  }
  return out;
}

function main() {
  const files = walk(contentDir, '', []);
  const articles = [];

  for (const f of files) {
    const raw = fs.readFileSync(f.full, 'utf8');
    const parsed = parseFrontmatter(raw);
    const segs = f.rel.split('/');
    const dirVolume = segs.length > 1 ? segs[0] : '';
    const title = parsed.meta.title || path.basename(f.rel, '.md');
    const vol = parsed.meta.volume || dirVolume || '';
    articles.push({
      file: f.rel,
      title: title,
      order: parseFloat(parsed.meta.order || '9999'), // 支持小数（如 2.5 插在第 2、3 章之间），无需重排其它章
      date: parsed.meta.date || '',
      volume: vol
    });
  }

  // 全局顺序由 order 决定（新增内容取更大的 order 即追加到书末）
  articles.sort(function (a, b) {
    return a.order - b.order || a.file.localeCompare(b.file);
  });

  // 卷序：按卷在全书首次出现的顺序
  const volumeSeq = [];
  articles.forEach(function (a) {
    if (a.volume && volumeSeq.indexOf(a.volume) === -1) volumeSeq.push(a.volume);
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    numbering: 'global', // 'global' 全站连续页码 | 'per-volume' 卷内页码
    volumes: volumeSeq,
    articles: articles
  };

  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 前端源码
  copyDir(srcDir, distDir);

  // 注入 Worker API 地址（前端不持有任何密钥，只持地址）
  //  优先环境变量 BOOK_API，其次 api.config.json，最后为空（批注功能禁用）
  let apiBase = process.env.BOOK_API || '';
  const apiCfg = path.join(root, 'api.config.json');
  if (!apiBase && fs.existsSync(apiCfg)) {
    try { apiBase = JSON.parse(fs.readFileSync(apiCfg, 'utf8')).api || ''; } catch (e) { apiBase = ''; }
  }
  const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  ['index.html', 'admin.html', 'manage.html'].forEach(function (name) {
    const f = path.join(distDir, name);
    if (!fs.existsSync(f)) return;
    const html = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, html.replace(/__BOOK_API__/g, apiBase).replace(/__V__/g, version));
  });
  console.log('✓ API 地址注入：' + (apiBase || '（未配置，批注与后台不可用）'));

  // 版本清单：供前端检测“线上已有新版本”，提示读者刷新（避免部署后读到的仍是缓存旧版）
  fs.writeFileSync(
    path.join(distDir, 'version.json'),
    JSON.stringify({ version: version, generatedAt: manifest.generatedAt })
  );

  // content：保持子目录结构，剥离 frontmatter 便于前端直接渲染
  // 先清空，避免文章重命名/调整卷目录后残留旧副本
  const distContent = path.join(distDir, 'content');
  if (fs.existsSync(distContent)) fs.rmSync(distContent, { recursive: true, force: true });
  fs.mkdirSync(distContent, { recursive: true });
  for (const f of files) {
    const raw = fs.readFileSync(f.full, 'utf8');
    const target = path.join(distContent, f.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stripFrontmatter(raw));
  }

  console.log('✓ 构建完成：' + articles.length + ' 篇 / ' + volumeSeq.length + ' 卷 → dist/manifest.json');
  volumeSeq.forEach(function (v) {
    console.log('  【' + v + '】');
    articles.filter(function (a) { return a.volume === v; }).forEach(function (a) {
      console.log('    ' + a.order + '  ' + a.title);
    });
  });
  if (volumeSeq.length === 0) {
    articles.forEach(function (a) { console.log('  ' + a.order + '  ' + a.title); });
  }
}

main();
