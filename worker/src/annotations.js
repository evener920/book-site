import { json } from './util.js';
import { currentUser } from './auth.js';

function toAnn(r) {
  return {
    id: r.id,
    articleTitle: r.article_title,
    volume: r.volume,
    pageGlobal: r.page_global,
    quote: r.quote,
    prefix: r.prefix,
    suffix: r.suffix,
    startOffset: r.start_offset,
    type: r.type,
    color: r.color,
    note: r.note,
    createdAt: r.created_at
  };
}

export async function list(env, req) {
  const user = await currentUser(env, req);
  if (!user) return json(env, req, { error: '未登录' }, 401);
  const res = await env.DB.prepare('SELECT * FROM annotations WHERE user_id = ? ORDER BY page_global, id')
    .bind(user.id).all();
  return json(env, req, { annotations: (res.results || []).map(toAnn) });
}

export async function create(env, req, body) {
  const user = await currentUser(env, req);
  if (!user) return json(env, req, { error: '未登录' }, 401);
  const b = body || {};
  if (!b.quote) return json(env, req, { error: '缺少引用文本' }, 400);

  await env.DB.prepare(
    'INSERT INTO annotations (user_id, article_title, volume, page_global, quote, prefix, suffix, start_offset, type, color, note) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    user.id,
    String(b.articleTitle || ''),
    String(b.volume || ''),
    Number(b.pageGlobal || 0),
    String(b.quote),
    String(b.prefix || ''),
    String(b.suffix || ''),
    Number(b.startOffset || 0),
    (b.type === 'underline' || b.type === 'wave') ? b.type : 'highlight',
    String(b.color || 'cinnabar'),
    String(b.note || '')
  ).run();

  const row = await env.DB.prepare('SELECT * FROM annotations WHERE id = last_insert_rowid()').first();
  return json(env, req, { annotation: toAnn(row) });
}

export async function update(env, req, id, body) {
  const user = await currentUser(env, req);
  if (!user) return json(env, req, { error: '未登录' }, 401);
  const b = body || {};
  const sets = [];
  const vals = [];
  if (b.note != null) { sets.push('note = ?'); vals.push(String(b.note)); }
  if (b.color != null) { sets.push('color = ?'); vals.push(String(b.color)); }
  if (b.type != null) { sets.push('type = ?'); vals.push((b.type === 'underline' || b.type === 'wave') ? b.type : 'highlight'); }
  if (!sets.length) return json(env, req, { error: '没有可更新的字段' }, 400);

  sets.push("updated_at = datetime('now')");
  vals.push(id, user.id);
  // 注意：bind 必须保持 this 指向 prepared statement，不能用 apply(null, ...)
  const res = await env.DB.prepare('UPDATE annotations SET ' + sets.join(', ') + ' WHERE id = ? AND user_id = ?')
    .bind(...vals).run();
  return json(env, req, { changed: res.meta && res.meta.changes });
}

export async function remove(env, req, id) {
  const user = await currentUser(env, req);
  if (!user) return json(env, req, { error: '未登录' }, 401);
  const res = await env.DB.prepare('DELETE FROM annotations WHERE id = ? AND user_id = ?')
    .bind(id, user.id).run();
  return json(env, req, { changed: res.meta && res.meta.changes });
}
