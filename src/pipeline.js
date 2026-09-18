/**
 * 核心编排层：Multi-Agent 内容生产流水线。
 *
 * 与上游 CLI 脚本（Planner → Research → Content → Review → Content 优化 → Memory）
 * 保持一致的五段串行链路，但把副作用收敛到可注入的参数里，
 * 因此同一份代码既能在浏览器里跑，也能在 Node 里用 mock fetch 做单元测试。
 */

/** 各 Agent 的角色定义，system prompt 沿用上游脚本的设定并做少量补充。 */
export const AGENTS = {
  planner: {
    name: 'Planner',
    label: '规划 Agent',
    icon: '🧠',
    description: '长链推理拆解需求，输出结构化执行计划',
    systemPrompt: `你是高级运营规划专家。

你的职责：
1. 深度理解业务需求
2. 使用长链推理拆解复杂任务
3. 输出结构化执行计划

输出格式：
- 业务目标
- 核心痛点
- 子任务拆解
- 执行顺序

要求：结论先行，分点清晰，避免空话，所有判断都给出依据。`,
  },
  research: {
    name: 'Research',
    label: '调研 Agent',
    icon: '🔍',
    description: '行业趋势、竞品拆解、用户洞察与热点提取',
    systemPrompt: `你是市场调研专家。

职责：
- 行业趋势分析
- 竞品拆解
- 用户需求洞察
- 热点数据提取

要求：
1. 按「行业 / 竞品 / 用户 / 热点」四块输出。
2. 只使用你确信的信息；无法核实的数字必须标注为「需核实」，禁止编造引用来源。
3. 给出可执行的调研结论，而不是泛泛的行业描述。`,
  },
  content: {
    name: 'Content',
    label: '创作 Agent',
    icon: '✍️',
    description: '爆款选题、高转化文案与脚本策划',
    systemPrompt: `你是顶级营销内容专家。

职责：
- 爆款选题
- 高转化文案
- 脚本策划
- 用户增长策略

要求：内容具体可用，直接给出成稿，标注适用平台与目标人群。`,
  },
  review: {
    name: 'Review',
    label: '审核 Agent',
    icon: '🧐',
    description: '逻辑校验、合规检查与自我反思',
    systemPrompt: `你是质量审核专家。

请执行：
1. 逻辑校验
2. 品牌一致性审核
3. 合规性检查（广告法极限词、虚假宣传、平台规则）
4. 自我反思并提出优化建议

输出格式：
- 通过项
- 问题项（标注严重程度：高 / 中 / 低）
- 具体修改建议

要求：直接指出问题，不要客套话；如果没有问题也要说明判断依据。`,
  },
};

/** 流水线的执行步骤：id 用于事件回传，agent 指向 AGENTS 中的角色。 */
export const STEPS = [
  {
    id: 'planner',
    agent: 'planner',
    temperature: 0.7,
    buildInput: ({ task, memoryContext }) =>
      `历史经验：\n${memoryContext}\n\n当前任务：\n${task}`,
  },
  {
    id: 'research',
    agent: 'research',
    temperature: 0.7,
    buildInput: ({ plan }) => plan,
  },
  {
    id: 'content',
    agent: 'content',
    temperature: 0.7,
    buildInput: ({ plan, research }) =>
      `规划方案：\n${plan}\n\n市场研究：\n${research}`,
  },
  {
    id: 'review',
    agent: 'review',
    temperature: 0.7,
    buildInput: ({ draft }) => draft,
  },
  {
    id: 'final',
    agent: 'content',
    label: '内容优化',
    description: '根据审核意见完成终稿',
    temperature: 0.4,
    buildInput: ({ draft, review }) =>
      `请根据以下审核意见优化内容：\n\n原稿：\n${draft}\n\n审核建议：\n${review}`,
  },
];

export const MEMORY_EMPTY_HINT = '暂无历史记录';

/** 生成步骤在 UI 上需要的元信息（步骤可能复用同一个 Agent 角色）。 */
export function describeStep(step) {
  const agent = AGENTS[step.agent];
  return {
    id: step.id,
    agent: step.agent,
    name: agent.name,
    label: step.label || agent.label,
    icon: agent.icon,
    description: step.description || agent.description,
    temperature: step.temperature,
  };
}

/**
 * 从历史记录中拼装上下文，对应上游 MemoryAgent.get_context。
 * @param {Array<{task: string, result: string}>} history
 * @param {number} limit
 */
export function buildMemoryContext(history = [], limit = 3) {
  if (!Array.isArray(history) || history.length === 0) return MEMORY_EMPTY_HINT;
  return history
    .slice(-limit)
    .map((item) => `任务：${item.task}\n结果摘要：${String(item.result || '').slice(0, 300)}`)
    .join('\n\n');
}

/**
 * 解析 OpenAI 兼容接口的 SSE 流。
 * 同时兼容少数不返回 SSE、直接返回整段 JSON 的实现。
 */
export async function streamChatCompletion({
  baseUrl,
  apiKey,
  model,
  temperature,
  messages,
  fetchImpl = globalThis.fetch,
  signal,
  extraHeaders = {},
  onDelta = () => {},
  onReasoningDelta = () => {},
  maxTokens,
}) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      temperature,
      stream: true,
      messages,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(formatHttpError(response.status, detail, { hasKey: Boolean(apiKey) }));
  }

  const contentType = response.headers?.get?.('content-type') || '';
  if (!response.body || contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null);
    const message = payload?.choices?.[0]?.message;
    const text = message?.content ?? '';
    if (message?.reasoning_content) onReasoningDelta(message.reasoning_content);
    if (text) onDelta(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以空行分隔，最后一段可能不完整，留到下次循环再处理。
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      const { content, reasoning } = extractDeltaFromEvent(event);
      if (content) {
        full += content;
        onDelta(content);
      }
      if (reasoning) onReasoningDelta(reasoning);
    }
  }

  if (buffer.trim()) {
    const { content, reasoning } = extractDeltaFromEvent(buffer);
    if (content) {
      full += content;
      onDelta(content);
    }
    if (reasoning) onReasoningDelta(reasoning);
  }

  return full;
}

/**
 * 解析一条 SSE 事件。
 *
 * 推理模型（DeepSeek v4 系列等）会把思考内容放在 delta.reasoning_content，
 * 正式回答放在 delta.content；两者要分开处理，否则思考阶段界面会一直空白。
 */
export function extractDeltaFromEvent(event) {
  let content = '';
  let reasoning = '';
  for (const rawLine of event.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const choice = parsed?.choices?.[0];
      const delta =
        choice?.delta?.content ??
        choice?.message?.content ??
        choice?.text ??
        '';
      if (typeof delta === 'string') content += delta;

      const thinking = choice?.delta?.reasoning_content ?? choice?.message?.reasoning_content;
      if (typeof thinking === 'string') reasoning += thinking;
    } catch {
      // 忽略无法解析的心跳或注释行。
    }
  }
  return { content, reasoning };
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function formatHttpError(status, detail, { hasKey = true } = {}) {
  let message = `接口返回 ${status}`;
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      const inner = parsed?.error?.message || parsed?.message;
      if (inner) message += `：${inner}`;
      else message += `：${detail.slice(0, 300)}`;
    } catch {
      message += `：${detail.slice(0, 300)}`;
    }
  }
  if (status === 401 || status === 403) {
    // 没带 Key 时的 401 长得像「Key 无效」，实际原因是 Key 根本没填/没保存，
    // 这里把两种情况的提示分开，避免用户反复换 Key。
    message += hasKey
      ? '（请检查 API Key 是否有效）'
      : '（请求未携带 API Key：请点右上角「设置」填入 Key 并点「保存」）';
  }
  if (status === 404) message += '（请检查 API 地址与模型名是否正确）';
  return message;
}

/**
 * 执行整条流水线。
 *
 * @param {object} options
 * @param {string} options.task 用户需求
 * @param {object} options.config { provider, baseUrl, apiKey, model, extraHeaders }
 * @param {string} [options.memoryContext] 历史经验文本
 * @param {(event: object) => void} [options.onEvent] 事件回调
 * @param {Function} [options.fetchImpl] 注入的 fetch，便于测试
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{final: string, stages: Array}>}
 */
export async function runPipeline({
  task,
  config,
  memoryContext = MEMORY_EMPTY_HINT,
  onEvent = () => {},
  fetchImpl,
  signal,
}) {
  if (!task || !task.trim()) throw new Error('请先填写需求描述');

  const context = { task: task.trim(), memoryContext };
  const stages = [];
  let plan = '';
  let research = '';
  let draft = '';
  let review = '';

  for (const step of STEPS) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');

    const meta = describeStep(step);
    const input = step.buildInput({ ...context, plan, research, draft, review });
    const startedAt = Date.now();
    const record = { ...meta, input, output: '', reasoning: '' };
    stages.push(record);
    onEvent({ type: 'stage:start', step: meta });

    const messages = [
      { role: 'system', content: AGENTS[step.agent].systemPrompt },
      { role: 'user', content: input },
    ];

    const output = await runStep({
      messages,
      step,
      config,
      fetchImpl,
      signal,
      onDelta: (delta) => {
        record.output += delta;
        onEvent({ type: 'stage:delta', step: meta, delta, text: record.output });
      },
      onReasoningDelta: (delta) => {
        record.reasoning += delta;
        onEvent({ type: 'stage:reasoning', step: meta, delta, text: record.reasoning });
      },
    });

    record.output = output;
    record.elapsedMs = Date.now() - startedAt;

    if (step.id === 'planner') plan = output;
    if (step.id === 'research') research = output;
    if (step.id === 'content') draft = output;
    if (step.id === 'review') review = output;

    onEvent({ type: 'stage:done', step: meta, text: output, elapsedMs: record.elapsedMs });
  }

  const final = stages.length ? stages[stages.length - 1].output : '';
  onEvent({ type: 'pipeline:done', text: final, stages });
  return { final, stages };
}

async function runStep({ messages, step, config, fetchImpl, signal, onDelta, onReasoningDelta }) {
  if (config?.provider === 'demo') {
    return runDemoStep({ step, messages, onDelta, signal });
  }
  return streamChatCompletion({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    temperature: step.temperature,
    messages,
    fetchImpl,
    signal,
    extraHeaders: config.extraHeaders || {},
    onDelta,
    onReasoningDelta,
  });
}

/**
 * 演示模式：不联网，返回结构化的示例内容。
 * 用于本地预览、部署后的「无 Key 体验」以及自动化测试。
 */
async function runDemoStep({ step, messages, onDelta, signal }) {
  const input = messages[messages.length - 1]?.content || '';
  const text = demoText(step.id, input);
  const chunks = text.match(/[\s\S]{1,18}/g) || [];
  let full = '';
  for (const chunk of chunks) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    full += chunk;
    onDelta(chunk);
    await delay(12);
  }
  return full;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function demoText(stepId, input) {
  const task = (input.split('当前任务：')[1] || input).trim().split('\n')[0].slice(0, 40);
  switch (stepId) {
    case 'planner':
      return `【业务目标】\n围绕「${task}」构建可复用的内容生产链路，明确人群、卖点与转化路径。\n\n【核心痛点】\n1. 选题依赖个人经验，产出不稳定；\n2. 文案与平台调性不匹配；\n3. 缺少复盘数据，迭代方向靠猜。\n\n【子任务拆解】\n1. 人群与场景界定；\n2. 竞品内容结构拆解；\n3. 选题库 + 文案模板产出；\n4. 发布节奏与转化路径设计；\n5. 数据复盘指标定义。\n\n【执行顺序】\n人群 → 竞品 → 选题 → 文案 → 发布 → 复盘。\n\n（演示模式输出，不消耗 API 额度）`;
    case 'research':
      return `【行业趋势】\n同类内容正从「产品介绍」转向「场景化解决方案」，短视频前 3 秒决定完播率。\n\n【竞品拆解】\n- 头部账号：高频更新 + 固定钩子结构；\n- 腰部账号：靠单点强卖点切入；\n- 尾部账号：以低价促销为主，转化率偏低。\n\n【用户洞察】\n用户更关心「用了之后能省什么」，而不是参数罗列。\n\n【热点提取】\n可用素材：真实使用前后对比、成本对比、常见误区纠正。\n\n注：以上为演示数据，实际投放前需核实来源。`;
    case 'content':
      return `【选题 1】3 个被忽略的成本，正在悄悄吃掉你的利润\n钩子：前 3 秒用一张对比图给出反差结论。\n\n【选题 2】同样的预算，为什么别人效果更好？\n结构：痛点 → 归因 → 方法 → 举例 → 行动。\n\n【文案示例】\n「不是你不努力，是方法一直在漏钱。这 3 个细节改完，成本立刻降下来。」\n\n【转化路径】\n短视频引流 → 评论区关键词 → 私域承接 → 体验式转化。`;
    case 'review':
      return `【通过项】\n结构完整，钩子明确，符合平台内容规范。\n\n【问题项】\n- 高：出现「立刻降下来」等效果承诺，存在合规风险；\n- 中：缺少数据支撑，说服力不足；\n- 低：部分表述偏书面，可口语化。\n\n【修改建议】\n1. 将绝对化承诺改为「有机会」「通常」；\n2. 补充可验证的数据来源或标注为经验值；\n3. 钩子句改为更口语的提问式表达。`;
    default:
      return `【终稿】\n\n标题：不是你不努力，是方法一直在漏钱\n\n正文：\n很多人算成本只算看得见的那部分。\n真正拉开差距的，是这 3 个被忽略的细节：\n\n1. 素材复用率低——同一份内容没有做多平台改写；\n2. 选题靠灵感——没有沉淀可复用的选题库；\n3. 复盘靠感觉——没有固定指标，改不出方向。\n\n把这三件事固定成流程，成本通常会有明显下降。\n\n行动指引：先挑一个环节，用一周时间跑一遍完整链路，再对比数据。\n\n（演示模式输出）`;
  }
}
