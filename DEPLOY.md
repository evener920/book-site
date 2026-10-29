# 部署与日常使用

## 线上地址

| 部件 | 地址 | 说明 |
|---|---|---|
| 书（Pages） | https://book-site-aev.pages.dev | 翻页阅读器，公开访问 |
| 后台（Pages） | https://book-site-aev.pages.dev/admin.html | 写文章、发布到 GitHub |
| API（Worker） | https://book-site-api.evener920.workers.dev | 账号、批注、GitHub 发布 |
| 数据库 | D1 `book-annotations` | 账号与批注 |
| 源码仓库 | https://github.com/evener920/book-site | 内容即 Markdown |

管理员账号：`evener920`，密码 `book-admin-2026`（在后台页可自行注册其他账号，但只有白名单里的用户名能发文）。

## 日常加内容（三种方式）

1. **网页后台（推荐）**：打开 `/admin.html` → 登录 → 填标题/卷/正文 → 发布
   → 写入 GitHub → Actions 自动重建 → 新内容接在书末、页码顺延
2. **本地写 md**：放 `content/卷N/xx.md`（frontmatter 带 order/title/date）→ `npm run all` → `./deploy.sh`
3. **命令行发布**：`curl -X POST .../api/publish`（同后台底层）

本地预览：`npm run serve` → http://localhost:8123/

## 两条更新路径的区别

| 路径 | 分页 | PDF |
|---|---|---|
| 后台/push → Actions 自动重建 | 精确（Actions 里有真实浏览器测量） | 自动生成 |
| 本地 `npm run all` + `./deploy.sh` | 精确 | 自动生成 |

Cloudflare Pages 自身的构建环境没有浏览器，所以精确分页放在 GitHub Actions 里做。
万一 Actions 没跑，前端会自动回退到运行时分页（内容正确、页码仍连续，只是不同浏览器可能有微小差异）。

## 还需要你做一件事（否则自动化不会触发）

Actions 需要 Cloudflare API 凭据。目前 `CLOUDFLARE_API_TOKEN` 未配置，workflow 会**自动跳过**（不会报错，但也不会部署）。

1. 打开 https://dash.cloudflare.com/profile/api-tokens → Create Token
2. 用模板 **Edit Cloudflare Workers**（或自定义：Account → Cloudflare Pages:Edit + Workers Scripts:Edit）
3. 复制 token，在仓库目录执行：

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID <<< '82129ffe005dfd5010505adf73de06cb'
gh secret set BOOK_API <<< 'https://book-site-api.evener920.workers.dev'
```

4. 验证：`gh workflow run "构建并部署网页书"` 然后 `gh run watch`

配好后，后台发文章 → 大约一分钟后站点自动更新。

## 绑定自定义域名（如 book.201573.xyz）

涉及 DNS，不自动执行。拿到 Pages 项目后手动加：

```bash
wrangler pages domain add book-site --domain book.201573.xyz
```

然后把 `book.201573.xyz` 加入 Worker 的 `ALLOWED_ORIGINS`（`worker/wrangler.toml`），
并重新 `cd worker && wrangler deploy`。（`*.pages.dev` / `*.workers.dev` 已自动放行。）

## 前端批注

- 登录任意账号即可高亮/划线/写备注，**换设备登录同一账号自动同步**
- 换设备同步依赖 Worker + D1，账号密码存 D1（PBKDF2 哈希，无明文）
- 「导出批注」按钮可导出 Markdown，可直接回喂 UpNote / 卡片盒

## 常用命令

```bash
npm run all      # 构建 + 精确分页 + 导出 PDF
npm run serve    # 本地预览 :8123
./deploy.sh      # 手动部署到 Pages（默认项目 book-site）
```
