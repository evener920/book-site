#!/bin/bash
# 部署到 Cloudflare Pages
#
# 策略：在本地完成「构建 → 精确分页 → 导出 PDF」，再直接上传 dist 产物。
# 不在 Pages 构建环境跑 Playwright —— Cloudflare 构建环境没有浏览器，
# 而精确分页必须靠真实浏览器测量，所以产物在本地生成后上传。
#
# 用法：
#   ./deploy.sh                     # 默认项目名 web-book
#   ./deploy.sh my-book             # 指定项目名
#   ./deploy.sh my-book preview     # 部署到预览分支
#
# 首次执行会创建 Pages 项目并输出 *.pages.dev 地址。
# 自定义域名（如 book.201573.xyz）请在部署后另行绑定：
#   wrangler pages domain add <项目名> --domain book.201573.xyz
# 绑定自定义域涉及 DNS，不在此脚本自动执行。

set -e
PROJECT="${1:-web-book}"
BRANCH="${2:-production}"

cd "$(dirname "$0")"

echo "== 1/4 构建（Markdown → manifest + 静态资源）=="
node build.js

echo "== 2/4 精确分页（Playwright 测量 → pages.json）=="
node tools/paginate.js

echo "== 3/4 导出 PDF（→ dist/book.pdf）=="
node tools/export-pdf.js

echo "== 4/4 上传到 Cloudflare Pages：$PROJECT（分支 $BRANCH）=="
wrangler pages deploy dist --project-name="$PROJECT" --branch="$BRANCH"

echo "✓ 部署完成"
