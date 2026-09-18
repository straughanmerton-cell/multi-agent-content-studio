# 多 Agent 内容生产工作台（网页版）

把 [wernerjjodoin83-beep/-Agent-](https://github.com/wernerjjodoin83-beep/-Agent-) 里那套单文件 CLI 脚本，改造成可以直接部署、打开浏览器就能用的网页应用。

原来的脚本是一段 Python 代码：`Planner → Research → Content → Review → Content 优化 → Memory` 五段串行调用 `gpt-4o`，用 `memory.json` 存历史，只能在本机命令行里跑。网页版保留了这条链路和全部 system prompt，把它搬到了浏览器里。

## 和上游脚本的差异

| 维度 | 上游 CLI 脚本 | 本网页版 |
| --- | --- | --- |
| 使用方式 | 命令行 `python xxx.py` | 打开网址即用，手机也能用 |
| 运行环境 | 需要 Python + pip 依赖 | 零依赖纯静态页，任意静态托管 |
| 模型 | 硬编码 `gpt-4o` | 默认 DeepSeek `deepseek-v4-flash`，可切换 OpenAI / Kimi / 智谱 / 百炼 / SiliconFlow / Ollama / 自定义 |
| 输出方式 | 跑完才一次性打印 | 每个 Agent 的思考过程实时流式显示 |
| 记忆 | 本地 `memory.json` | 浏览器 localStorage，可复用任务、查看和删除历史 |
| 结果交付 | 终端文本 | Markdown 渲染 + 一键复制 + 导出 `.md` 文件 |
| 密钥安全 | 环境变量（仅本机） | 个人用浏览器本地保存；公开部署可走 Cloudflare Worker 代理 |
| 额外能力 | 无 | 演示模式（不填 Key 也能体验全流程）、手动中断、连接测试 |

> 说明：上游 README 里提到的「每日 200 条内容 / 效率提升 15 倍 / 节省 8 万元」等属于项目方自述的运营数据，本项目未做核实，因此网页界面里没有采用这些数字。

## 本地运行

不需要安装任何依赖：

```bash
node scripts/dev-server.mjs
# 打开 http://localhost:5173
```

也可以直接用任意静态服务器托管这个目录，例如 `npx serve .`。

跑测试：

```bash
npm test
```

## 登录系统

站点带一层登录门：未登录只能看到登录页，登录后才渲染工作台。账号与密码哈希都写在
[`src/auth.js`](src/auth.js) 顶部（`ADMIN_USER`、`ADMIN_PASSWORD_HASH`），密码以
「盐 + SHA-256」形式存放，仓库里没有明文密码。登录状态存在浏览器 `localStorage`，
默认 7 天免登录，右上角「退出登录」可立即注销。

⚠️ 这类登录属于**前端访问门**：本站是纯静态托管，没有服务端，任何人查看页面源码都能
看到哈希值，也能绕过它直接调用模型接口。它能挡住随手访问和爬虫，但不适合承载真正的
机密。真正的密钥安全依赖两件事：仓库里不含任何 API Key（每个使用者在自己的浏览器里
填自己的 Key），以及方案 B 的服务端代理。需要服务端级鉴权时，用 Cloudflare Access
把 Pages 项目整站保护起来，或把校验逻辑放进 Worker（方案 B）。

跑端到端冒烟测试（需要本机装 Chrome / Edge，且先启动 `npm run dev`）：

```bash
npm run e2e
```

## 免费部署方案 A：GitHub Pages（最简单）

静态托管，零成本，适合个人使用：API Key 保存在访问者自己的浏览器里，不会上传到服务器。

1. 把本目录推到一个 GitHub 仓库（主分支 `main`）。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 推送后 GitHub Actions 会自动发布，地址是 `https://<用户名>.github.io/<仓库名>/`。

仓库里已经放好 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)，不需要额外配置。首次部署后在页面右上角「设置」里选服务商、填自己的 API Key 即可使用。

注意：这种方式下 Key 存在浏览器 `localStorage`，只适合自己用。如果要把链接公开分享，请用方案 B。

## 免费部署方案 B：Cloudflare Worker 代理 + Pages（推荐公开分享）

把 Key 放到服务端，访问者无需自备 API Key，也顺带解决了部分服务商不允许浏览器直连（CORS）的问题。Cloudflare 免费套餐每天 10 万次请求，个人和小团队都够用。

```bash
cd worker
npm install

# 1. 配置真实 Key（Secret，不会出现在代码或日志里）
npx wrangler secret put API_KEY           # 填入模型服务商的 Key
npx wrangler secret put ACCESS_TOKEN      # 自定义一个访问口令，例如 team-2026

# 2. 可选：在 Cloudflare 控制台把 UPSTREAM_BASE 改成你用的服务商地址

# 3. 部署
npx wrangler deploy
```

部署完成后会得到形如 `https://multi-agent-content-proxy.<你的子域>.workers.dev` 的地址。在前端「设置」里：

- API 地址填这个 Worker 地址；
- API Key 填 `ACCESS_TOKEN` 的值（用作访问口令）；
- 模型名填上游服务商支持的模型，例如 `deepseek-v4-flash`。

前端会直连 `POST <Worker 地址>/chat/completions`，Worker 换成服务端 Key 后转发，并把流式响应原样透传回浏览器。

可选变量：

| 变量 | 说明 |
| --- | --- |
| `API_KEY` | 必填，真实模型服务商的 Key |
| `ACCESS_TOKEN` | 可选，设置后前端必须填同样的口令，防止别人白用你的额度 |
| `UPSTREAM_BASE` | 可选，默认 `https://api.openai.com/v1` |
| `ALLOWED_ORIGIN` | 可选，默认 `*`；建议改成你的 Pages 域名，避免被其他站点盗用 |

## 服务商配置参考

内置预设（设置面板里选服务商会自动填好地址和默认模型）：

| 服务商 | Base URL | 默认模型 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-v4-flash` |
| 月之暗面 Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| Ollama（本地） | `http://localhost:11434/v1` | `qwen2.5:7b` |

只要对方提供 OpenAI 兼容的 `/chat/completions` 接口，选「自定义」填地址和模型即可接入。

## 流水线说明

| 步骤 | Agent | 输入 | 温度 |
| --- | --- | --- | --- |
| 1 | 🧠 Planner 规划 | 历史经验 + 当前任务 | 0.7 |
| 2 | 🔍 Research 调研 | Planner 计划 | 0.7 |
| 3 | ✍️ Content 创作 | 计划 + 调研 | 0.7 |
| 4 | 🧐 Review 审核 | 初稿 | 0.7 |
| 5 | ✍️ Content 优化 | 初稿 + 审核意见 | 0.4 |

通过审核后再降温度出终稿，是上游脚本里就有的设计（原代码在最后一步用了 `temperature=0.4`），网页版保持一致。终稿完成后自动写入历史记忆，下一次运行会作为「历史经验」带回第一步。

### 推理模型（deepseek-v4-flash 等）

默认服务商已预设为 DeepSeek + `deepseek-v4-flash`。这类推理模型在流式响应里会把思考过程放在 `delta.reasoning_content`，正式回答放在 `delta.content`。页面会把两者分开处理：

- 思考过程进入每个阶段可折叠的「思考过程」区块，正文开始输出后自动收起；
- 正文只渲染 `delta.content`，不会被思考内容污染；
- 导出 Markdown 时思考过程以 `<details>` 形式附在对应阶段下。

换成不支持 `reasoning_content` 的普通模型（如 `gpt-4o-mini`）时会自动跳过该区块，不影响流程。

## 目录结构

```
index.html                  单页应用入口
assets/styles.css           样式（浅色/深色自适应）
src/pipeline.js             Agent 定义 + 五段流水线编排（可在 Node 中测试）
src/providers.js            服务商预设与配置校验
src/store.js                localStorage 持久化（历史记忆 + 设置）
src/markdown.js             轻量 Markdown 渲染（先转义再渲染）
src/app.js                  界面交互、流式渲染、导出
tests/pipeline.test.mjs     流水线单元测试
scripts/dev-server.mjs      零依赖本地预览服务器
worker/                     Cloudflare Worker 代理
.github/workflows/          GitHub Pages 自动部署
agent_memory/               项目上下文、进度与风险记录
```

## 安全与隐私

- 浏览器直连模式下，API Key 只存在访问者自己的 `localStorage`，但任何能操作该浏览器的人都能读到，请不要在公共电脑上保存。
- 公开分享的站点请使用 Worker 代理，并设置 `ACCESS_TOKEN` 与 `ALLOWED_ORIGIN`。
- 生成的文案由模型产出，发布前请自行核实事实、数据与广告法合规性；审核 Agent 的提示词里已加入极限词与虚假宣传检查，但它不能替代人工审核。

## 已知边界

- 上游的 Research Agent 只依赖模型自身知识，没有接入真实的热点或数据接口，因此调研结论可能过时；提示词里已要求无法核实的数字标注「需核实」。
- 不支持超过浏览器单次请求限制的超长上下文；五段链路本身会带来 5 次模型调用，请注意额度消耗。
