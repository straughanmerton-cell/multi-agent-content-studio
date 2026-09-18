# 问题与风险

## 已知问题
- 应用内浏览器不触发 `download` 事件，导出按钮点击后本地下载目录没有生成文件；普通浏览器未验证。导出内容生成逻辑已单测覆盖。
- 静态站点的 Key 存在访问者浏览器 localStorage：换浏览器或换设备访问线上站点时，需要在「设置」里重新粘贴一次 Key（当前只在配置过的浏览器生效）。

## 已修复
- 401 提示误导：未填/未保存 API Key 时请求不带 Authorization，DeepSeek 返回纯文本 `Authentication Fails (governor)`，旧提示统一写成「请检查 API Key 是否有效」，会让人反复换 Key。现已按是否真的带了 Key 区分提示，未带 Key 时提示去「设置」填写并保存（commit 14839e8）。
- 设置面板改了 Key 却没点「保存」会被静默忽略，直接用旧配置发请求。现在点击「开始生成」会先采纳并持久化表单里的未保存改动。
- 「测试连接」用的是表单草稿值，成功后没有提示需要保存，用户容易以为已经生效（这正是 401 的实际触发路径）。现在测试成功后会附带「改动还没保存」提示。
- 设置面板的 Base URL / 模型名占位符写死成 OpenAI 的示例值（`https://api.openai.com/v1`、`gpt-4o-mini`），选择 DeepSeek 时会误导；现已改为跟随当前服务商显示预设值，并在留空时提示会使用默认值。

## 风险记录
- API Key 存在浏览器 localStorage：同一台电脑的其他使用者可读取。影响范围=公开分享的部署；处理方式=文档引导使用 Worker 代理，并设置 ACCESS_TOKEN 与 ALLOWED_ORIGIN。
- 一次生成会调用 5 次模型（含流式），Token 消耗约为单次对话的 5 倍；推理模型的思考内容同样计入输出 token。
- 上游 Research Agent 无真实数据源，调研结论可能过时；提示词已要求无法核实的数字标注「需核实」。
- Cloudflare Worker 若设为 `ALLOWED_ORIGIN=*` 且不设 ACCESS_TOKEN，等于公开转发额度，文档已提示收紧。
- 公开仓库不得写入任何真实 Key；`.gitignore` 与提交前 `rg` 扫描用于防止误提交。

## 失败尝试
- 用 `Start-Process` 后台启动本地预览服务器被执行策略拦截；改为长驻 `exec_command` 会话运行 `node scripts/dev-server.mjs`。
- 应用内浏览器不提供 `viewport` 能力，无法做移动端视口验证；移动端布局仅由 CSS 媒体查询（<980px 单列）保证，未做真机验证。
- `playwright.waitForLoadState("networkidle")` 在应用内浏览器中不支持，改用 `load`。
- 页面 reload 后旧的 AX 元素索引会失效（报 "belongs to a previous page"），需要重新获取无障碍树再点击。
- `tab.click({ selector })` 不支持选择器形式，必须用无障碍元素索引 `tab.click(index)`；`getAXState()` 返回的是可索引对象而非带 `name` 字段的数组。

## 待确认
- 用户是否需要公开分享该站点（决定是否部署 Worker 代理隐藏 Key）。
