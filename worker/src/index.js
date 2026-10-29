import { json, preflight } from './util.js';
import * as auth from './auth.js';
import * as ann from './annotations.js';
import * as gh from './github.js';

async function readBody(req) {
  try { return await req.json(); } catch (e) { return {}; }
}

export default {
  async fetch(request, env) {
    const req = request;
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === 'OPTIONS') return preflight(env, req);

    try {
      if (p === '/api/health') {
        return json(env, req, {
          ok: true,
          service: 'book-site-api',
          db: !!env.DB,
          githubToken: !!env.GITHUB_TOKEN,
          githubRepo: (env.GITHUB_OWNER || '') + '/' + (env.GITHUB_REPO || '')
        });
      }

      if (p === '/api/auth/register' && req.method === 'POST') return auth.register(env, req, await readBody(req));
      if (p === '/api/auth/login' && req.method === 'POST') return auth.login(env, req, await readBody(req));
      if (p === '/api/auth/me') return auth.me(env, req);

      if (p === '/api/annotations' && req.method === 'GET') return ann.list(env, req);
      if (p === '/api/annotations' && req.method === 'POST') return ann.create(env, req, await readBody(req));

      const m = p.match(/^\/api\/annotations\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (req.method === 'PATCH') return ann.update(env, req, id, await readBody(req));
        if (req.method === 'DELETE') return ann.remove(env, req, id);
      }

      if (p === '/api/articles' && req.method === 'GET') return gh.listArticles(env, req);
      if (p === '/api/publish' && req.method === 'POST') return gh.publish(env, req, await readBody(req));
      if (p === '/api/articles' && req.method === 'PATCH') return gh.updateArticle(env, req, await readBody(req));
      if (p === '/api/articles' && req.method === 'DELETE') return gh.deleteArticle(env, req, await readBody(req));

      return json(env, req, { error: '接口不存在：' + p }, 404);
    } catch (e) {
      return json(env, req, { error: '服务异常：' + (e && e.message ? e.message : String(e)) }, 500);
    }
  }
};
