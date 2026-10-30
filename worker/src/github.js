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

// 去掉 frontmatter，只留正文（编辑回填用）
function stripFrontmatter(text) {
  return String(text).replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
}

// 由 卷/order/标题 推算文件路径（与 publish 保持一致）
function buildPath(volume, order, title) {
  const slug = slugify(title);
  return (volume ? 'content/' + volume : 'content') + '/' +
    String(order).padStart(2, '0') + '-' + slug + '.md';
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

  // 并行拉取每个文件内容（避免逐个串行 N+1 请求导致列表/发布很慢）
  const fetched = await Promise.all(files.map(function (f) {
    return gh(env, base + '/contents/' + encodeURI(f.path) + '?ref=' + env.GITHUB_BRANCH)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }));
  const items = [];
  fetched.forEach(function (d, i) {
    if (!d) return;
    const f = files[i];
    let text = '';
    try { text = base64ToUtf8(d.content || ''); } catch (e) { text = ''; }
    const meta = parseFrontmatter(text);
    items.push({
      file: f.path,
      title: meta.title || f.path,
      order: Number(meta.order) || 0,
      date: meta.date || '',
      volume: meta.volume || '',
      body: stripFrontmatter(text)
    });
  });
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

// 编辑已发布文章：原地更新；若 卷/order/标题 变化导致路径变，则先建新文件再删旧文件（避免中途丢稿）
export async function updateArticle(env, req, body) {
  const guard = await requireAdmin(env, req);
  if (guard.err) return guard.err;

  const b = body || {};
  const file = String(b.file || '').trim();
  const title = String(b.title || '').trim();
  const content = String(b.body || '');
  if (!file) return json(env, req, { error: '缺少 file 路径' }, 400);
  if (!title || !content.trim()) return json(env, req, { error: '标题和正文不能为空' }, 400);

  const volume = String(b.volume || '').trim();
  const date = String(b.date || new Date().toISOString().slice(0, 10));
  const base = '/repos/' + env.GITHUB_OWNER + '/' + env.GITHUB_REPO;

  // 读旧文件拿 sha，并从旧 frontmatter 兜底 order
  const exist = await gh(env, base + '/contents/' + encodeURI(file) + '?ref=' + env.GITHUB_BRANCH);
  if (!exist.ok) return json(env, req, { error: '文件不存在：' + file }, 404);
  const ed = await exist.json().catch(function () { return {}; });
  const oldSha = ed.sha;
  let oldText = '';
  try { oldText = base64ToUtf8(ed.content || ''); } catch (e) { oldText = ''; }
  const oldMeta = parseFrontmatter(oldText);

  let order = Number(b.order);
  if (isNaN(order)) order = Number(oldMeta.order) || 0;

  const md = '---\ntitle: ' + title + '\norder: ' + order + '\ndate: ' + date + '\nvolume: ' + volume + '\n---\n' +
    content.replace(/\s*$/, '') + '\n';
  const newPath = buildPath(volume, order, title);

  // 路径没变：原地 PUT（带 sha）
  if (newPath === file) {
    const put = await gh(env, base + '/contents/' + encodeURI(file), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '更新《' + title + '》',
        content: utf8ToBase64(md),
        sha: oldSha,
        branch: env.GITHUB_BRANCH
      })
    });
    const out = await put.json().catch(function () { return {}; });
    if (!put.ok) return json(env, req, { error: '更新失败', status: put.status, detail: out.message || out }, 502);
    return json(env, req, { ok: true, path: file, order: order, commitUrl: out.commit && out.commit.html_url });
  }

  // 路径变了：先建新（带旧内容兜底，若新路径已存在则带其 sha），成功后再删旧，避免中途丢稿
  let newSha;
  const newExist = await gh(env, base + '/contents/' + encodeURI(newPath) + '?ref=' + env.GITHUB_BRANCH);
  if (newExist.ok) { const nd = await newExist.json().catch(function () { return {}; }); newSha = nd.sha; }

  const put = await gh(env, base + '/contents/' + encodeURI(newPath), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({
      message: '移动《' + title + '》→ ' + newPath,
      content: utf8ToBase64(md),
      branch: env.GITHUB_BRANCH
    }, newSha ? { sha: newSha } : {}))
  });
  const putOut = await put.json().catch(function () { return {}; });
  if (!put.ok) return json(env, req, { error: '写入新文件失败', status: put.status, detail: putOut.message || putOut }, 502);

  const del = await gh(env, base + '/contents/' + encodeURI(file), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '删除旧文件《' + title + '》', sha: oldSha, branch: env.GITHUB_BRANCH })
  });
  const delOut = await del.json().catch(function () { return {}; });
  if (!del.ok) return json(env, req, { error: '删除旧文件失败（新文件已写入）', status: del.status, detail: delOut.message || delOut }, 502);

  return json(env, req, { ok: true, path: newPath, movedFrom: file, order: order, commitUrl: putOut.commit && putOut.commit.html_url });
}

// 删除已发布文章：删 GitHub 文件即触发 CI 自动重建下线
export async function deleteArticle(env, req, body) {
  const guard = await requireAdmin(env, req);
  if (guard.err) return guard.err;

  const file = String((body && body.file) || '').trim();
  if (!file) return json(env, req, { error: '缺少 file 路径' }, 400);

  const base = '/repos/' + env.GITHUB_OWNER + '/' + env.GITHUB_REPO;
  const exist = await gh(env, base + '/contents/' + encodeURI(file) + '?ref=' + env.GITHUB_BRANCH);
  if (!exist.ok) return json(env, req, { error: '文件不存在：' + file }, 404);
  const ed = await exist.json().catch(function () { return {}; });
  const sha = ed.sha;

  let title = file;
  try {
    const t = base64ToUtf8(ed.content || '');
    const m = parseFrontmatter(t);
    if (m.title) title = m.title;
  } catch (e) { /* 用文件名兜底 */ }

  const del = await gh(env, base + '/contents/' + encodeURI(file), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '删除《' + title + '》', sha: sha, branch: env.GITHUB_BRANCH })
  });
  const out = await del.json().catch(function () { return {}; });
  if (!del.ok) return json(env, req, { error: '删除失败', status: del.status, detail: out.message || out }, 502);
  return json(env, req, { ok: true, file: file });
}
