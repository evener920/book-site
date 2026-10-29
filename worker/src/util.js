export function corsHeaders(env, req) {
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const h = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
  };
  if (origin && (allowed.indexOf('*') !== -1 || allowed.indexOf(origin) !== -1)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
}

export function json(env, req, data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders(env, req))
  });
}

export function preflight(env, req) {
  return new Response(null, { status: 204, headers: corsHeaders(env, req) });
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(function (x) {
    return x.toString(16).padStart(2, '0');
  }).join('');
}

export function randBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function randToken() { return toHex(randBytes(32)); }
export function randSalt() { return toHex(randBytes(16)); }

export async function pbkdf2Hash(password, saltHex, iterations) {
  const it = iterations || 100000;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(function (h) { return parseInt(h, 16); }));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: it }, key, 256);
  return toHex(bits);
}

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// UTF-8 安全的 base64（GitHub Contents API 要求）
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToUtf8(str) {
  const bin = atob(String(str).replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
