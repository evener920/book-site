import { json, utf8ToBase64, base64ToUtf8 } from './util.js';
import { currentUser, isAdmin } from './auth.js';

async function gh(env, path, opts) {
  const o = opts || {};
  return fetch('https://api.github.com' + path, Object.assign({}, o, {
    headers: Object.assign({
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'book-site-worker',
      'X-GitHub-Api-Version': '2022-11-28'
    }, o.headers || {})
  }));
}

async function requireAdmin(env, req) {
  const user = await currentUser(env, req);
  if (!user) return { err: json(env, req, { error: '未登录' }, 401) };
  if (!isAdmin(env, user.username)) return { err: json(env, req, { error: '非管理员，不能发布文章' }, 403) };
  return { user: user };
}

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const meta = {};
  if (m) {
    m[1].split(/\r?\n/).forEach(function (line) {
      const i = line.indexOf(':');
      if (i > 0) {
        meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      }
    });
  }
  return meta;
}

async function readArticles(env, limit) {
  const base = '/repos/' + env.GITHUB_OWNER + '/' + env.GITHUB_REPO;
  const treeRes = await gh(env, base + '/git/trees/' + env.GITHUB_BRANCH + '?recursive=1');
  if (!treeRes.ok) {
    const t = await treeRes.json().catch(function () { return {}; });
    throw new Error('读取仓库失败(' + treeRes.status + '): ' + (t.message || ''));
  }
  const tree = await treeRes.json();
  const files = (tree.tree || [])
    .filter(function (t) { return t.type === 'blob' && t.path.indexOf('content/') === 0 && /\.md$/.test(t.path); })
    .slice(0, limit || 200);

  const items = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const r = await gh(env, base + '/contents/' + encodeURI(f.path) + '?ref=' + env.GITHUB_BRANCH);
    if (!r.ok) continue;
    const d = await r.json();
    let text = '';
    try { text = base64ToUtf8(d.content || ''); } catch (e) { text = ''; }
    const meta = parseFrontmatter(text);
    items.push({
      file: f.path,
      title: meta.title || f.path,
      order: Number(meta.order) || 0,
      date: meta.date || '',
      volume: meta.volume || ''
    });
  }
  return items;
}

function slugify(title) {
  let s = String(title).trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^一-龥a-z0-9\-]/g, '');
  if (!s) s = 'post-' + Date.now();
  return s.slice(0, 40);
}

export async function listArticles(env, req) {
  const guard = await requireAdmin(env, req);
  if (guard.err) return guard.err;
  try {
    const items = await readArticles(env, 200);
    let maxOrder = -1;
    items.forEach(function (i) { const o = Number(i.order); if (!isNaN(o) && o > maxOrder) maxOrder = o; });
    return json(env, req, { articles: items, suggestedOrder: maxOrder + 1 });
  } catch (e) {
    return json(env, req, { error: String(e && e.message || e) }, 502);
  }
}

export async function publish(env, req, body) {
  const guard = await requireAdmin(env, req);
  if (guard.err) return guard.err;

  const b = body || {};
  const title = String(b.title || '').trim();
  const volume = String(b.volume || '').trim();
  const content = String(b.body || '');
  if (!title || !content) return json(env, req, { error: '标题和正文不能为空' }, 400);

  const date = String(b.date || new Date().toISOString().slice(0, 10));
  const base = '/repos/' + env.GITHUB_OWNER + '/' + env.GITHUB_REPO;

  let order = Number(b.order);
  if (isNaN(order)) {
    try {
      const items = await readArticles(env, 200);
      let maxOrder = -1;
      items.forEach(function (i) { const o = Number(i.order); if (!isNaN(o) && o > maxOrder) maxOrder = o; });
      order = maxOrder + 1;
    } catch (e) {
      return json(env, req, { error: '无法确定顺序，请手动填写 order：' + (e && e.message || e) }, 502);
    }
  }

  const path = (volume ? 'content/' + volume : 'content') + '/' + String(order).padStart(2, '0') + '-' + slugify(title) + '.md';
  const md = '---\ntitle: ' + title + '\norder: ' + order + '\ndate: ' + date + '\nvolume: ' + volume + '\n---\n' +
    content.replace(/\s*$/, '') + '\n';

  // 同名文件已存在则带 sha 更新，否则新建
  let sha;
  const exist = await gh(env, base + '/contents/' + encodeURI(path) + '?ref=' + env.GITHUB_BRANCH);
  if (exist.ok) {
    const d = await exist.json().catch(function () { return {}; });
    sha = d.sha;
  }

  const payload = {
    message: '发布《' + title + '》',
    content: utf8ToBase64(md),
    branch: env.GITHUB_BRANCH
  };
  if (sha) payload.sha = sha;

  const put = await gh(env, base + '/contents/' + encodeURI(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const out = await put.json().catch(function () { return {}; });
  if (!put.ok) {
    return json(env, req, { error: '提交 GitHub 失败', status: put.status, detail: out.message || out }, 502);
  }
  return json(env, req, {
    ok: true,
    path: path,
    order: order,
    commitUrl: out.commit && out.commit.html_url
  });
}
