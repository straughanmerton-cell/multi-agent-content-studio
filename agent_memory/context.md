# 项目上下文

## 项目目标
- 把上游开源项目 `wernerjjodoin83-beep/-Agent-`（只有 README，内含单文件 Python CLI 脚本）改造成网页版，并可免费部署。
- 目标用户：做短视频脚本、商品文案、营销素材的内容运营人员；不要求会命令行。
- 核心交付物：零依赖静态站点（规划 / 调研 / 创作 / 审核 / 优化五段流水线）+ 免费的部署配置。

## 关键约束
- 上游脚本的链路与 system prompt 必须保留：Planner → Research → Content → Review → Content 优化（temperature 0.4）→ Memory。
- 前端零依赖、零构建，任意静态托管可跑（GitHub Pages / Cloudflare Pages / 本地静态服务器）。
- 模型调用走 OpenAI 兼容 `/chat/completions`，服务商可切换，不硬编码 `gpt-4o`。
- 浏览器直连时 API Key 只存本地 localStorage；公开分享需用 Worker 代理隐藏密钥。
- 上游 README 中的运营数据（每日 200 条等）未经核实，不得当作事实写入界面或文档结论。

## 重要路径
- `index.html`：单页应用入口。
- `src/pipeline.js`：Agent 定义 + 五段流水线编排 + SSE 流式解析（可注入 fetch，便于测试）。
- `src/app.js`：界面交互、流式渲染、导入导出。
- `src/providers.js`：服务商预设与配置校验；`src/store.js`：localStorage 持久化。
- `src/export.js`：导出 Markdown（纯函数，已单测）。
- `tests/*.test.mjs`：流水线与导出单测；`scripts/dev-server.mjs`：本地预览服务器。
- `worker/`：Cloudflare Worker 代理；`.github/workflows/deploy-pages.yml`：Pages 自动部署。

## 当前约定
- 默认使用中文记录。
- 只保留当前有效信息，过期内容归档到 `agent_memory/archive/`。
- 上游代码仅作参考，克隆在 `upstream-agent/`（已加入 .gitignore，不参与部署）。
