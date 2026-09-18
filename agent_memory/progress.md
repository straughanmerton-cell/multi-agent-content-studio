# 任务进度

## 当前目标
- 网页版已免费部署上线并接入 DeepSeek；新增登录门（管理员 `18300004073`），处于可交付状态。

## 已完成
- 上游脚本改造为纯前端网页版：五段流水线、流式展示、手动中断、演示模式。
- 模型接口层可配置：内置 OpenAI / DeepSeek / Kimi / 智谱 / 百炼 / SiliconFlow / Ollama / 自定义预设。
- `memory.json` 改为 localStorage 历史记忆，支持复用任务、查看终稿、删除、清空。
- Markdown 渲染 + 复制 + 导出 `.md`；浅色/深色自适应与移动端单列布局。
- 免费部署两套方案：GitHub Pages（静态）与 Cloudflare Worker 代理（隐藏 Key）+ Pages。
- 推理模型适配：思考内容经 `stage:reasoning` 单独渲染为可折叠「思考过程」，正文不被污染，导出文件用 `<details>` 保留。
- 默认服务商改为 DeepSeek `deepseek-v4-flash`。
- 推送 GitHub 公开仓库并开启 Pages，工作流 `Deploy to GitHub Pages` 成功，线上地址可访问且各静态资源返回 200。
- 线上站点已填入真实 DeepSeek Key 并通过「测试连接」，配置保存在该浏览器的 localStorage。
- 新增登录系统：`src/auth.js`（ADMIN_USER + 盐化 SHA-256 哈希 + 7 天会话）、`index.html` 登录遮罩与「退出登录」按钮、`store.js` 会话读写、`app.js` 改为「先登录后挂载」，`styles.css` 加登录卡片样式。
- 新增 `scripts/e2e-auth-check.mjs`（零依赖 CDP 冒烟测试）与 `npm run e2e`，用本机 headless Chrome 跑真实登录流程。

## 正在进行
- 无。

## 下一步
- 若公开分享，按 README 部署 Worker 代理并设置 ACCESS_TOKEN / ALLOWED_ORIGIN。
- 换浏览器/换设备访问时，需在「设置」里重新粘贴一次 Key（各浏览器 localStorage 独立）。
- 注意 `http://localhost:5188` 与 `https://straughanmerton-cell.github.io/...` 是两个不同源，localStorage 不互通，Key 需分别保存一次。

## 验证记录
- 登录系统端到端（`npm run e2e`，headless Chrome + CDP，本地 http://localhost:5188）：10/10 通过——未登录只显示登录页；错误账号、错误密码均被拒；正确凭据进入工作台且 5 个阶段 / 3 个示例 / 9 个服务商预设渲染正常；`macroagent.session.v1` 里无明文密码；刷新后会话保持；点「退出登录」回到登录页且本地会话被清除。
- 单测 `node --test`：22 项通过（新增 5 项认证测试：SHA-256 标准向量与 55/56/64 分块边界、多字节字符、凭据校验、会话有效期、会话持久化与清除）。纯 JS SHA-256 已与 Node `crypto` 对 12 组样本逐一对齐。
- 线上站点（https://straughanmerton-cell.github.io/...）：`GET /` 与 `src/*.js`、`assets/styles.css` 均 200；DeepSeek API 对 github.io 源站返回 `Access-Control-Allow-Origin`，页面内「测试连接」返回「连接成功，模型返回：」。
- 401 `Authentication Fails (governor)` 的准确含义已实测确认：请求**没有携带 Authorization 头**时才返回这句（空 Bearer 报「auth header format should be Bearer sk-...」，错误 Key 报「your api key: ****xxxx is invalid」）。用户 2026-09-18 的截图报错即属此类，Key 本身有效（`/models`、`/user/balance` 均 200，余额 16.83 元）。
- 真实 DeepSeek 调用（本机 http://localhost:5188，真实 Key）：五段流水线全部跑通，总耗时 161.4s，终稿渲染完成并写入历史记忆，思考过程在 4/5 阶段独立显示。
- 未验证：导出下载（应用内浏览器拦截 `download` 事件），下载以外的生成逻辑已由单测覆盖；移动端真机布局未验证。
