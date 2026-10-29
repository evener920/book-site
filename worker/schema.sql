-- 账号（轻量：用户名 + PBKDF2 口令哈希）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 会话令牌（跨设备靠「同一账号登录」拿到同一批注）
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 批注锚点：quote + 前后上下文 + 页内偏移，保证翻页/重载后能重绘
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  article_title TEXT NOT NULL DEFAULT '',
  volume TEXT NOT NULL DEFAULT '',
  page_global INTEGER NOT NULL DEFAULT 0,
  quote TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  start_offset INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'highlight',
  color TEXT NOT NULL DEFAULT 'cinnabar',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ann_user_page ON annotations(user_id, page_global);
