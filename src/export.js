/** 导出 Markdown：与 DOM 解耦，便于单测覆盖。 */

export function buildExportMarkdown({
  task = '',
  providerLabel = '',
  model = '',
  stages = [],
  final = '',
  generatedAt = new Date(),
} = {}) {
  const lines = [
    '# 多 Agent 内容生产结果',
    '',
    `- 需求：${task}`,
    `- 服务商：${providerLabel}`,
    `- 模型：${model}`,
    `- 生成时间：${formatDateTime(generatedAt)}`,
    '',
  ];

  for (const stage of stages) {
    lines.push(`## ${stage.name}`, '', String(stage.text || '').trim(), '');
    const reasoning = String(stage.reasoning || '').trim();
    if (reasoning) {
      // 思考过程放在折叠块里，避免干扰正文阅读。
      lines.push('<details><summary>思考过程</summary>', '', reasoning, '', '</details>', '');
    }
  }

  lines.push('## 最终输出', '', String(final || '').trim(), '');
  return lines.join('\n');
}

/** 文件名安全：去掉冒号、斜杠等在不同系统上非法的字符。 */
export function buildExportFilename(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
  return `多agent内容方案-${stamp}.md`;
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}
