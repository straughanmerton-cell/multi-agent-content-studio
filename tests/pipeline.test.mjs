import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENTS,
  MEMORY_EMPTY_HINT,
  STEPS,
  buildMemoryContext,
  extractDeltaFromEvent,
  runPipeline,
  streamChatCompletion,
} from '../src/pipeline.js';
import { resolveConfig } from '../src/providers.js';

/** 构造一个符合 SSE 格式的假响应，可指定每个网络分片的大小。 */
function sseResponse(fullText, { sliceSize = 11, status = 200 } = {}) {
  const encoder = new TextEncoder();
  const frames = [...fullText].map(
    (char) => `data: ${JSON.stringify({ choices: [{ delta: { content: char } }] })}\n\n`,
  );
  frames.push('data: [DONE]\n\n');
  const payload = frames.join('');
  const bytes = encoder.encode(payload);

  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += sliceSize) {
        controller.enqueue(bytes.slice(i, i + sliceSize));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonErrorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CONFIG = {
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'test-key',
  model: 'test-model',
};

function collectingFetch(replies, calls = []) {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const reply = replies[calls.length - 1];
    if (reply instanceof Response) return reply;
    return sseResponse(reply ?? `第 ${calls.length} 步输出`);
  };
  return { fetchImpl, calls };
}

test('buildMemoryContext 无历史时返回占位文案', () => {
  assert.equal(buildMemoryContext([], 3), MEMORY_EMPTY_HINT);
  assert.equal(buildMemoryContext(undefined, 3), MEMORY_EMPTY_HINT);
});

test('buildMemoryContext 只取最近 N 条并截断结果摘要', () => {
  const history = Array.from({ length: 5 }, (_, index) => ({
    task: `任务${index}`,
    result: 'x'.repeat(500),
  }));
  const context = buildMemoryContext(history, 3);
  assert.ok(!context.includes('任务1'));
  assert.ok(context.includes('任务2'));
  assert.ok(context.includes('任务4'));
  const blocks = context.split('\n\n');
  assert.equal(blocks.length, 3);
  assert.ok(blocks[0].includes(`结果摘要：${'x'.repeat(300)}`));
  assert.ok(!blocks[0].includes('x'.repeat(301)));
});

test('streamChatCompletion 能跨网络分片重组 SSE 并拼接增量', async () => {
  const deltas = [];
  const text = await streamChatCompletion({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: async () => sseResponse('你好，这是一个流式回复。', { sliceSize: 7 }),
    onDelta: (delta) => deltas.push(delta),
  });

  assert.equal(text, '你好，这是一个流式回复。');
  assert.equal(deltas.join(''), text);
});

test('streamChatCompletion 兼容非流式的 JSON 响应', async () => {
  const text = await streamChatCompletion({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k',
    model: 'm',
    messages: [],
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '一次性返回' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  assert.equal(text, '一次性返回');
});

test('extractDeltaFromEvent 区分正文与推理模型的思考内容', () => {
  const reasoning = extractDeltaFromEvent(
    'data: {"choices":[{"delta":{"content":null,"reasoning_content":"先想一下"}}]}',
  );
  assert.deepEqual(reasoning, { content: '', reasoning: '先想一下' });

  const answer = extractDeltaFromEvent('data: {"choices":[{"delta":{"content":"正文"}}]}');
  assert.deepEqual(answer, { content: '正文', reasoning: '' });

  assert.deepEqual(extractDeltaFromEvent('data: [DONE]'), { content: '', reasoning: '' });
  assert.deepEqual(extractDeltaFromEvent(': keep-alive'), { content: '', reasoning: '' });
});

test('推理模型：思考内容经 stage:reasoning 单独回传，不混入正文', async () => {
  const encoder = new TextEncoder();
  const frames = [
    { delta: { content: null, reasoning_content: '我需要先拆解需求。' } },
    { delta: { content: null, reasoning_content: '然后给出结论。' } },
    { delta: { content: '【计划】' } },
    { delta: { content: '先定人群。' } },
  ]
    .map((payload) => `data: ${JSON.stringify({ choices: [payload] })}\n\n`)
    .concat('data: [DONE]\n\n')
    .join('');

  const fetchImpl = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(frames));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

  const events = [];
  const { stages } = await runPipeline({
    task: '测试推理输出',
    config: CONFIG,
    fetchImpl: async (url, init) => {
      const step = events.filter((e) => e === 'stage:start').length;
      if (step > 1) return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      return fetchImpl(url, init);
    },
    onEvent: (event) => events.push(event.type === 'stage:reasoning' ? 'stage:reasoning' : event.type),
  });

  assert.ok(events.includes('stage:reasoning'));
  assert.equal(stages[0].reasoning, '我需要先拆解需求。然后给出结论。');
  assert.equal(stages[0].output, '【计划】先定人群。');
  assert.ok(!stages[0].output.includes('拆解需求'));
});

test('streamChatCompletion 把 HTTP 错误转成可读提示', async () => {
  await assert.rejects(
    () =>
      streamChatCompletion({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'bad',
        model: 'm',
        messages: [],
        fetchImpl: async () => jsonErrorResponse(401, 'Incorrect API key provided'),
      }),
    /接口返回 401：Incorrect API key provided（请检查 API Key 是否有效）/,
  );
});

test('未携带 API Key 时的 401 提示指向「设置」而不是让用户换 Key', async () => {
  let sentAuthHeader = 'not-called';
  await assert.rejects(
    () =>
      streamChatCompletion({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        model: 'deepseek-v4-flash',
        messages: [],
        fetchImpl: async (_url, init) => {
          sentAuthHeader = init.headers.Authorization;
          return new Response('Authentication Fails (governor)', {
            status: 401,
            headers: { 'Content-Type': 'text/plain' },
          });
        },
      }),
    /请求未携带 API Key：请点右上角「设置」填入 Key 并点「保存」/,
  );
  assert.equal(sentAuthHeader, undefined);
});

test('runPipeline 按 5 个步骤串行执行并正确传递上下文', async () => {
  const replies = ['【计划】A', '【调研】B', '【初稿】C', '【审核】D', '【终稿】E'];
  const { fetchImpl, calls } = collectingFetch(replies);
  const events = [];

  const { final, stages } = await runPipeline({
    task: '为普洱茶写 3 条抖音脚本',
    config: CONFIG,
    memoryContext: '任务：上一个任务\n结果摘要：摘要内容',
    fetchImpl,
    onEvent: (event) => events.push(event.type),
  });

  assert.equal(calls.length, STEPS.length);
  assert.equal(final, '【终稿】E');
  assert.equal(stages.length, 5);
  assert.deepEqual(
    stages.map((stage) => stage.id),
    ['planner', 'research', 'content', 'review', 'final'],
  );
  assert.equal(stages[3].output, '【审核】D');
  assert.ok(stages[4].elapsedMs >= 0);

  // 请求地址、鉴权头与模型参数
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].body.model, 'test-model');

  // system prompt 与 Agent 角色一一对应
  assert.equal(calls[0].body.messages[0].content, AGENTS.planner.systemPrompt);
  assert.equal(calls[1].body.messages[0].content, AGENTS.research.systemPrompt);
  assert.equal(calls[3].body.messages[0].content, AGENTS.review.systemPrompt);
  assert.equal(calls[4].body.messages[0].content, AGENTS.content.systemPrompt);

  // 上下文注入：历史经验 → 规划
  assert.ok(calls[0].body.messages[1].content.includes('摘要内容'));
  assert.ok(calls[0].body.messages[1].content.includes('为普洱茶写 3 条抖音脚本'));
  // 计划 → 调研
  assert.equal(calls[1].body.messages[1].content, '【计划】A');
  // 计划 + 调研 → 创作
  assert.ok(calls[2].body.messages[1].content.includes('【计划】A'));
  assert.ok(calls[2].body.messages[1].content.includes('【调研】B'));
  // 初稿 → 审核
  assert.equal(calls[3].body.messages[1].content, '【初稿】C');
  // 初稿 + 审核意见 → 终稿，且温度下调到 0.4
  assert.ok(calls[4].body.messages[1].content.includes('【初稿】C'));
  assert.ok(calls[4].body.messages[1].content.includes('【审核】D'));
  assert.equal(calls[4].body.temperature, 0.4);
  assert.equal(calls[0].body.stream, true);

  // 事件顺序：每步 start → delta（可多次）→ done，最后 pipeline:done
  assert.equal(events[0], 'stage:start');
  assert.ok(events.includes('stage:delta'));
  assert.equal(events.at(-1), 'pipeline:done');
  assert.deepEqual(
    events.filter((type) => type !== 'stage:delta'),
    [
      'stage:start', 'stage:done',
      'stage:start', 'stage:done',
      'stage:start', 'stage:done',
      'stage:start', 'stage:done',
      'stage:start', 'stage:done',
      'pipeline:done',
    ],
  );
  assert.equal(events.filter((type) => type === 'stage:start').length, 5);
  assert.equal(events.filter((type) => type === 'stage:done').length, 5);
});

test('runPipeline 中断时不继续调用后续步骤', async () => {
  const { fetchImpl, calls } = collectingFetch(['plan', 'research']);
  const abort = new AbortController();

  await assert.rejects(
    () =>
      runPipeline({
        task: '任务',
        config: CONFIG,
        fetchImpl: async (url, init) => {
          const result = await fetchImpl(url, init);
          abort.abort();
          return result;
        },
        signal: abort.signal,
      }),
    (error) => error.name === 'AbortError',
  );

  assert.equal(calls.length, 1);
});

test('runPipeline 空任务直接报错', async () => {
  await assert.rejects(() => runPipeline({ task: '   ', config: CONFIG }), /请先填写需求描述/);
});

test('演示模式无需网络即可跑完整条流水线', async () => {
  const { final, stages } = await runPipeline({
    task: '为一款 AI 绘画工具制定小红书增长方案',
    config: { provider: 'demo' },
    fetchImpl: async () => {
      throw new Error('演示模式不应该发起网络请求');
    },
  });

  assert.equal(stages.length, 5);
  assert.ok(stages[0].output.includes('业务目标'));
  assert.ok(stages[1].output.includes('行业趋势'));
  assert.ok(stages[3].output.includes('问题项'));
  assert.ok(final.includes('终稿'));
});

test('resolveConfig 校验必填项并读取服务商预设', () => {
  assert.throws(() => resolveConfig({ provider: 'custom', baseUrl: '', model: '' }), /API 地址/);
  assert.throws(
    () => resolveConfig({ provider: 'custom', baseUrl: 'https://x/v1', model: '' }),
    /模型名称/,
  );
  const deepseek = resolveConfig({ provider: 'deepseek', apiKey: 'k' });
  assert.equal(deepseek.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(deepseek.model, 'deepseek-v4-flash');
  assert.equal(resolveConfig({ provider: 'demo' }).provider, 'demo');
});
