# 部署与日常使用

## 线上地址

| 部件 | 地址 | 说明 |
|---|---|---|
| 书（Pages） | https://pages.201573.xyz | 自定义域（生效后为主地址） |
| 书（默认域） | https://book-site-aev.pages.dev | 备用访问地址 |
| 后台（Pages） | https://pages.201573.xyz/admin.html | 写文章、发布到 GitHub |
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

## 自动化状态：已接通 ✅

`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`BOOK_API` 三个 secret 均已配置。
push 或后台发文即触发 Actions：构建 → 精确分页 → 导出 PDF → 部署 Pages，约 1 分钟。

手动触发：`gh workflow run "构建并部署网页书" && gh run watch`

## 自定义域 pages.201573.xyz

已在 Pages 项目绑定，但**还差一条 DNS 记录**才能生效（当前状态 pending）。
在 Cloudflare Dashboard → 域 `201573.xyz` → DNS → Records 添加：

| 字段 | 值 |
|---|---|
| Type | `CNAME` |
| Name | `pages` |
| Target | `book-site-aev.pages.dev` |
| Proxy | 开启（橙云） |

保存后等 1–5 分钟，证书自动签发，状态转 active 即可访问。

> 说明：当前 API token 没有 Zone DNS 写权限（`10000 Authentication error`），所以这条记录无法由脚本代劳。
> 若要我以后能自动改 DNS，重建 token 时加上 `Zone → DNS → Edit` 权限即可。

Worker 的 `ALLOWED_ORIGINS` 已包含 `https://pages.201573.xyz`；`*.pages.dev` / `*.workers.dev` 也自动放行。

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
