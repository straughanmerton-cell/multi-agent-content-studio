import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExportFilename, buildExportMarkdown } from '../src/export.js';

const FIXED_DATE = new Date(2026, 8, 18, 9, 5, 3);

test('buildExportMarkdown 输出头部信息、各步骤与最终输出', () => {
  const markdown = buildExportMarkdown({
    task: '为普洱茶写脚本',
    providerLabel: 'DeepSeek 深度求索',
    model: 'deepseek-chat',
    generatedAt: FIXED_DATE,
    stages: [
      { name: '🧠 Planner · 规划 Agent', text: '【计划】先定人群' },
      { name: '✍️ Content · 内容优化', text: '  【终稿】内容  ' },
    ],
    final: '最终稿件正文',
  });

  assert.ok(markdown.startsWith('# 多 Agent 内容生产结果'));
  assert.ok(markdown.includes('- 需求：为普洱茶写脚本'));
  assert.ok(markdown.includes('- 服务商：DeepSeek 深度求索'));
  assert.ok(markdown.includes('- 模型：deepseek-chat'));
  assert.ok(markdown.includes('- 生成时间：2026-09-18 09:05:03'));
  assert.ok(markdown.includes('## 🧠 Planner · 规划 Agent\n\n【计划】先定人群'));
  assert.ok(markdown.includes('## ✍️ Content · 内容优化\n\n【终稿】内容\n'));
  assert.ok(markdown.endsWith('## 最终输出\n\n最终稿件正文\n'));
});

test('buildExportMarkdown 在缺少字段时也不产生 undefined', () => {
  const markdown = buildExportMarkdown();
  assert.ok(!markdown.includes('undefined'));
  assert.ok(markdown.includes('## 最终输出'));
});

test('buildExportFilename 生成文件名且不含非法字符', () => {
  const filename = buildExportFilename(FIXED_DATE);
  assert.equal(filename, '多agent内容方案-20260918-090503.md');
  assert.ok(!/[:\\/*?"<>|]/.test(filename));
});

test('buildExportMarkdown 把思考过程放进折叠块，且不干扰正文', () => {
  const markdown = buildExportMarkdown({
    task: '任务',
    generatedAt: FIXED_DATE,
    stages: [{ name: '🧠 Planner', text: '【计划】正文', reasoning: '先想一下' }],
    final: '终稿',
  });
  assert.ok(markdown.includes('<details><summary>思考过程</summary>\n\n先想一下\n\n</details>'));
  assert.ok(markdown.indexOf('【计划】正文') < markdown.indexOf('<details>'));

  const withoutReasoning = buildExportMarkdown({
    stages: [{ name: '🧠 Planner', text: '只有正文' }],
  });
  assert.ok(!withoutReasoning.includes('<details>'));
});
