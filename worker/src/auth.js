import { json, randToken, randSalt, pbkdf2Hash, safeEqual } from './util.js';

export async function currentUser(env, req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.indexOf('Bearer ') === 0 ? auth.slice(7).trim() : '';
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id AS id, u.username AS username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).bind(token).first();
  return row || null;
}

export function isAdmin(env, username) {
  const list = (env.ADMIN_USERNAMES || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return list.indexOf(username) !== -1;
}

export async function register(env, req, body) {
  const b = body || {};
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (username.length < 2) return json(env, req, { error: '用户名至少 2 个字符' }, 400);
  if (password.length < 6) return json(env, req, { error: '密码至少 6 位' }, 400);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) return json(env, req, { error: '用户名已存在' }, 409);

  const salt = randSalt();
  const hash = await pbkdf2Hash(password, salt);
  const res = await env.DB.prepare('INSERT INTO users (username, pass_hash, pass_salt) VALUES (?, ?, ?)')
    .bind(username, hash, salt).run();
  const userId = res.meta && res.meta.last_row_id;
  const token = randToken();
  await env.DB.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').bind(token, userId).run();
  return json(env, req, { token: token, username: username });
}

export async function login(env, req, body) {
  const b = body || {};
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  const row = await env.DB.prepare('SELECT id, username, pass_hash, pass_salt FROM users WHERE username = ?')
    .bind(username).first();
  if (!row) return json(env, req, { error: '账号或密码不对' }, 401);
  const hash = await pbkdf2Hash(password, row.pass_salt);
  if (!safeEqual(hash, row.pass_hash)) return json(env, req, { error: '账号或密码不对' }, 401);
  const token = randToken();
  await env.DB.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').bind(token, row.id).run();
  return json(env, req, { token: token, username: row.username });
}

export async function me(env, req) {
  const user = await currentUser(env, req);
  if (!user) return json(env, req, { error: '未登录' }, 401);
  return json(env, req, { username: user.username, isAdmin: isAdmin(env, user.username) });
}
