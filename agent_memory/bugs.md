# 问题与风险

## 已知问题
- 应用内浏览器不触发 `download` 事件，导出按钮点击后本地下载目录没有生成文件；普通浏览器未验证。导出内容生成逻辑已单测覆盖。

## 风险记录
- API Key 存在浏览器 localStorage：同一台电脑的其他使用者可读取。影响范围=公开分享的部署；处理方式=文档引导使用 Worker 代理，并设置 ACCESS_TOKEN 与 ALLOWED_ORIGIN。
- 一次生成会调用 5 次模型（含流式），Token 消耗约为单次对话的 5 倍；演示模式不消耗额度，已作为默认值。
- 上游 Research Agent 无真实数据源，调研结论可能过时；提示词已要求无法核实的数字标注「需核实」。
- Cloudflare Worker 若设为 `ALLOWED_ORIGIN=*` 且不设 ACCESS_TOKEN，等于公开转发额度，文档已提示收紧。

## 失败尝试
- 用 `Start-Process` 后台启动本地预览服务器被执行策略拦截；改为长驻 `exec_command` 会话运行 `node scripts/dev-server.mjs`。
- 应用内浏览器不提供 `viewport` 能力，无法做移动端视口验证；移动端布局仅由 CSS 媒体查询（<980px 单列）保证，未做真机验证。
- `playwright.waitForLoadState("networkidle")` 在应用内浏览器中不支持，改用 `load`。
- 页面 reload 后旧的 AX 元素索引会失效（报 "belongs to a previous page"），需要重新获取无障碍树再点击。

## 待确认
- 用户希望使用的模型服务商与是否公开分享站点（决定用 Pages 还是 Worker 代理方案）。
- 是否需要把站点部署到用户自己的 GitHub 账号（当前只完成本地仓库与工作流，未推送远端）。
