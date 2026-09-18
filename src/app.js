import {
  STEPS,
  buildMemoryContext,
  describeStep,
  runPipeline,
  streamChatCompletion,
} from './pipeline.js';
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  detectProxy,
  getProvider,
  resolveConfig,
} from './providers.js';
import { renderMarkdown } from './markdown.js';
import { buildExportFilename, buildExportMarkdown } from './export.js';
import {
  addMemoryEntry,
  clearMemory,
  loadMemory,
  loadSettings,
  newId,
  removeMemoryEntry,
  saveSettings,
} from './store.js';

const EXAMPLES = [
  {
    label: '小红书增长方案',
    text: '为一款 AI 绘画工具制定完整的小红书增长方案，包括：1. 用户画像分析 2. 竞品调研 3. 爆款内容策划 4. 转化路径设计',
  },
  {
    label: '抖音短视频脚本',
    text: '为一款云南古树普洱茶设计 3 条抖音短视频脚本，每条包含黄金 3 秒钩子、分镜要点、口播文案和爆款标题。',
  },
  {
    label: '课程详情页文案',
    text: '为一门 Python 零基础入门网课写详情页文案，包含目标人群、课程卖点、价格锚点、常见疑虑解答和行动号召。',
  },
];

const DEFAULT_SETTINGS = {
  provider: DEFAULT_PROVIDER,
  baseUrl: '',
  model: '',
  apiKey: '',
  memoryLimit: 3,
};

const STATUS_TEXT = {
  pending: '等待',
  running: '生成中',
  done: '完成',
  error: '失败',
};

const el = (id) => document.getElementById(id);

const dom = {
  task: el('task-input'),
  examples: el('example-row'),
  run: el('btn-run'),
  stop: el('btn-stop'),
  clearTask: el('btn-clear-task'),
  runStatus: el('run-status'),
  stageList: el('stage-list'),
  pipelineStatus: el('pipeline-status'),
  finalOutput: el('final-output'),
  copyFinal: el('btn-copy-final'),
  scrollFinal: el('btn-scroll-final'),
  exportBtn: el('btn-export'),
  providerBadge: el('provider-badge'),
  memoryList: el('memory-list'),
  clearMemory: el('btn-clear-memory'),
  settingsBtn: el('btn-settings'),
  dialog: el('settings-dialog'),
  closeSettings: el('btn-close-settings'),
  saveSettings: el('btn-save-settings'),
  testConn: el('btn-test'),
  settingsStatus: el('settings-status'),
  providerHint: el('provider-hint'),
  keyWarning: el('key-warning'),
  fieldProvider: el('field-provider'),
  fieldBaseUrl: el('field-base-url'),
  fieldModel: el('field-model'),
  fieldApiKey: el('field-api-key'),
  fieldMemoryLimit: el('field-memory-limit'),
  toast: el('toast'),
};

let settings = loadSettings(DEFAULT_SETTINGS);
let memory = loadMemory();
let controller = null;
let lastResult = null;
let lastTask = '';
let stageViews = new Map();

init();

function init() {
  renderExamples();
  renderProviderOptions();
  fillSettingsForm();
  renderMemory();
  renderProviderBadge();
  renderStageSkeleton();
  bindEvents();
}

/* ------------------------------------------------------------------ 事件绑定 */

function bindEvents() {
  dom.run.addEventListener('click', () => startRun());
  dom.stop.addEventListener('click', () => controller?.abort());
  dom.clearTask.addEventListener('click', () => {
    dom.task.value = '';
    dom.task.focus();
  });

  dom.task.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      startRun();
    }
  });

  dom.copyFinal.addEventListener('click', async () => {
    if (!lastResult) return;
    const ok = await copyText(lastResult);
    toast(ok ? '已复制终稿' : '复制失败，请手动选择文本');
  });

  dom.scrollFinal.addEventListener('click', () => {
    dom.finalOutput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  dom.exportBtn.addEventListener('click', exportMarkdown);

  dom.clearMemory.addEventListener('click', () => {
    if (!memory.length) return;
    if (!confirm('确定清空全部历史记录？该操作不可恢复。')) return;
    memory = clearMemory();
    renderMemory();
    toast('历史记录已清空');
  });

  dom.settingsBtn.addEventListener('click', () => {
    fillSettingsForm();
    dom.settingsStatus.textContent = '';
    dom.settingsStatus.className = 'status-line';
    dom.dialog.showModal();
  });

  dom.closeSettings.addEventListener('click', () => dom.dialog.close());

  dom.fieldProvider.addEventListener('change', () => {
    const preset = getProvider(dom.fieldProvider.value);
    dom.fieldBaseUrl.value = preset.baseUrl || '';
    dom.fieldModel.value = preset.model || '';
    updateProviderHint();
  });

  dom.fieldBaseUrl.addEventListener('input', updateProviderHint);

  dom.saveSettings.addEventListener('click', () => {
    settings = collectSettingsForm();
    saveSettings(settings);
    renderProviderBadge();
    updateProviderHint();
    setStatus(dom.settingsStatus, '设置已保存到本机浏览器', 'ok');
  });

  dom.testConn.addEventListener('click', testConnection);
}

/* ------------------------------------------------------------------ 渲染 */

function renderExamples() {
  dom.examples.innerHTML = '';
  for (const item of EXAMPLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'example-chip';
    btn.textContent = item.label;
    btn.title = item.text;
    btn.addEventListener('click', () => {
      dom.task.value = item.text;
      dom.task.focus();
    });
    dom.examples.appendChild(btn);
  }
}

function renderProviderOptions() {
  dom.fieldProvider.innerHTML = '';
  for (const provider of PROVIDERS) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    dom.fieldProvider.appendChild(option);
  }
}

function renderProviderBadge() {
  const preset = getProvider(settings.provider);
  const isDemo = settings.provider === 'demo';
  dom.providerBadge.textContent = isDemo
    ? '演示模式（不联网）'
    : `${preset.label} · ${settings.model || preset.model || '未设置模型'}`;
  dom.providerBadge.classList.toggle('chip-muted', isDemo);
}

function renderStageSkeleton() {
  dom.stageList.innerHTML = '';
  stageViews = new Map();

  for (const step of STEPS) {
    const meta = describeStep(step);
    const li = document.createElement('li');
    li.className = 'stage collapsed';
    li.dataset.step = meta.id;

    const head = document.createElement('div');
    head.className = 'stage-head';
    head.innerHTML = `
      <span class="stage-icon">${meta.icon}</span>
      <span class="stage-name">${meta.name} · ${meta.label}</span>
      <span class="stage-desc">${meta.description}</span>
      <span class="stage-time"></span>
      <span class="stage-status">${STATUS_TEXT.pending}</span>
    `;

    const body = document.createElement('div');
    body.className = 'stage-body';

    // 推理模型（如 DeepSeek v4）会先输出思考内容，单独折叠展示，不干扰正式结果。
    const reasoning = document.createElement('details');
    reasoning.className = 'reasoning';
    reasoning.hidden = true;
    reasoning.open = true;
    const reasoningSummary = document.createElement('summary');
    reasoningSummary.textContent = '思考过程';
    const reasoningText = document.createElement('div');
    reasoningText.className = 'reasoning-text';
    reasoning.append(reasoningSummary, reasoningText);
    reasoningSummary.addEventListener('click', () => {
      view.reasoningTouched = true;
    });

    const markdown = document.createElement('div');
    markdown.className = 'markdown';
    markdown.innerHTML = `<p class="placeholder">${meta.description}</p>`;
    body.append(reasoning, markdown);

    head.addEventListener('click', () => li.classList.toggle('collapsed'));

    li.append(head, body);
    dom.stageList.appendChild(li);
    const view = {
      root: li,
      status: head.querySelector('.stage-status'),
      time: head.querySelector('.stage-time'),
      reasoning,
      reasoningText,
      reasoningPending: '',
      reasoningFrame: 0,
      reasoningTouched: false,
      markdown,
      pending: '',
      frame: 0,
    };
    stageViews.set(meta.id, view);
  }
}

function setStageState(stepId, state) {
  const view = stageViews.get(stepId);
  if (!view) return;
  view.root.classList.remove('running', 'done', 'error');
  if (state !== 'pending') view.root.classList.add(state);
  view.status.textContent = STATUS_TEXT[state];
}

function renderMemory() {
  dom.memoryList.innerHTML = '';
  if (!memory.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有历史记录，完成一次生成后会自动保存。';
    dom.memoryList.appendChild(empty);
    return;
  }

  for (const item of [...memory].reverse()) {
    const li = document.createElement('li');
    li.className = 'memory-item';

    const time = document.createElement('div');
    time.className = 'memory-time';
    time.textContent = `${formatTime(item.time)}${item.model ? ` · ${item.model}` : ''}`;

    const task = document.createElement('p');
    task.className = 'memory-task';
    task.textContent = truncate(item.task, 90);
    task.title = item.task;

    const actions = document.createElement('div');
    actions.className = 'memory-actions';

    const reuse = document.createElement('button');
    reuse.type = 'button';
    reuse.className = 'btn btn-text';
    reuse.textContent = '复用任务';
    reuse.addEventListener('click', () => {
      dom.task.value = item.task;
      dom.task.focus();
      dom.task.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'btn btn-text';
    view.textContent = '查看终稿';
    view.addEventListener('click', () => {
      lastResult = item.result;
      lastTask = item.task;
      dom.finalOutput.innerHTML = renderMarkdown(item.result);
      dom.copyFinal.disabled = false;
      dom.exportBtn.disabled = false;
      dom.scrollFinal.hidden = false;
      dom.finalOutput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-text';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      memory = removeMemoryEntry(item.id, memory);
      renderMemory();
    });

    actions.append(reuse, view, remove);
    li.append(time, task, actions);
    dom.memoryList.appendChild(li);
  }
}

/* ------------------------------------------------------------------ 运行 */

async function startRun() {
  if (controller) return;

  const task = dom.task.value.trim();
  if (!task) {
    setStatus(dom.runStatus, '请先填写需求描述', 'error');
    dom.task.focus();
    return;
  }

  // 设置面板里改了但没点「保存」时先把表单值采纳并持久化，
  // 否则会拿旧配置发请求（症状：Key 明明填了，请求却没带 Authorization）。
  syncUnsavedSettings();

  let config;
  try {
    config = resolveConfig(settings);
  } catch (error) {
    setStatus(dom.runStatus, `${error.message}，请点击右上角「设置」补充。`, 'error');
    return;
  }

  controller = new AbortController();
  lastResult = null;
  setRunning(true);
  renderStageSkeleton();
  dom.finalOutput.innerHTML = '<p class="placeholder">流水线执行中，终稿会在最后一步完成后显示…</p>';
  dom.copyFinal.disabled = true;
  dom.scrollFinal.hidden = true;

  const memoryContext = buildMemoryContext(memory, Number(settings.memoryLimit) || 0);
  const pipelineStart = Date.now();
  let finished = 0;

  try {
    const { final } = await runPipeline({
      task,
      config,
      memoryContext,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'stage:start') {
          setStageState(event.step.id, 'running');
          const view = stageViews.get(event.step.id);
          view?.root.classList.remove('collapsed');
          view?.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          dom.pipelineStatus.textContent = `进行中 ${finished + 1}/${STEPS.length} · ${event.step.label}`;
        } else if (event.type === 'stage:delta') {
          renderStageDelta(event.step.id, event.text);
        } else if (event.type === 'stage:reasoning') {
          renderStageReasoning(event.step.id, event.text);
        } else if (event.type === 'stage:done') {
          finished += 1;
          const view = stageViews.get(event.step.id);
          renderStageDelta(event.step.id, event.text, true);
          if (view) view.time.textContent = `${(event.elapsedMs / 1000).toFixed(1)}s`;
          setStageState(event.step.id, 'done');
          view?.root.classList.add('collapsed');
        }
      },
    });

    lastResult = final;
    lastTask = task;
    dom.finalOutput.innerHTML = renderMarkdown(final);
    dom.copyFinal.disabled = false;
    dom.scrollFinal.hidden = false;

    const totalSeconds = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    const preset = getProvider(settings.provider);
    dom.pipelineStatus.textContent = `已完成 · 5 个 Agent · 总耗时 ${totalSeconds}s`;
    setStatus(
      dom.runStatus,
      `生成完成，用时 ${totalSeconds}s，终稿已存入历史记忆。${settings.provider === 'demo' ? '（演示模式内容仅供界面预览）' : ''}`,
      'ok',
    );

    memory = addMemoryEntry(
      {
        id: newId(),
        time: new Date().toISOString(),
        task,
        result: final,
        provider: settings.provider,
        model: settings.provider === 'demo' ? 'demo' : settings.model || preset.model,
      },
      memory,
    );
    renderMemory();
    dom.exportBtn.disabled = false;
  } catch (error) {
    if (error?.name === 'AbortError') {
      setStatus(dom.runStatus, '已停止生成。', 'error');
      dom.pipelineStatus.textContent = '已停止';
      for (const [id, view] of stageViews) {
        if (view.root.classList.contains('running')) setStageState(id, 'pending');
      }
    } else {
      setStatus(dom.runStatus, `生成失败：${error.message}`, 'error');
      dom.pipelineStatus.textContent = '执行失败';
      for (const [id, view] of stageViews) {
        if (view.root.classList.contains('running')) {
          setStageState(id, 'error');
          view.markdown.innerHTML = renderMarkdown(`**该步骤失败：** ${error.message}`);
          view.root.classList.remove('collapsed');
        }
      }
    }
  } finally {
    controller = null;
    setRunning(false);
  }
}

function renderStageDelta(stepId, text, immediate = false) {
  const view = stageViews.get(stepId);
  if (!view) return;

  // 正文开始输出后收起思考过程，需要回看时可以手动展开。
  if (view.reasoning && !view.reasoning.hidden && !view.reasoningTouched) {
    view.reasoning.open = false;
  }

  view.pending = text;
  view.markdown.classList.add('streaming');

  const draw = () => {
    view.frame = 0;
    view.markdown.innerHTML = renderMarkdown(view.pending);
    view.markdown.classList.add('streaming');
  };

  if (immediate) {
    if (view.frame) cancelAnimationFrame(view.frame);
    draw();
    view.markdown.classList.remove('streaming');
    return;
  }
  if (!view.frame) view.frame = requestAnimationFrame(draw);
}

function renderStageReasoning(stepId, text) {
  const view = stageViews.get(stepId);
  if (!view) return;
  view.reasoning.hidden = false;
  view.reasoningPending = text;

  const draw = () => {
    view.reasoningFrame = 0;
    view.reasoningText.textContent = view.reasoningPending;
    view.reasoningText.scrollTop = view.reasoningText.scrollHeight;
  };
  if (!view.reasoningFrame) view.reasoningFrame = requestAnimationFrame(draw);
}

function setRunning(running) {
  dom.run.disabled = running;
  dom.stop.hidden = !running;
  dom.run.textContent = running ? '生成中…' : '开始生成';
  if (running) {
    dom.pipelineStatus.textContent = '准备中…';
    const missingKey = settings.provider !== 'demo' && !settings.apiKey;
    setStatus(
      dom.runStatus,
      missingKey
        ? '未填写 API Key，将直接调用接口（本地模型或代理可忽略此提示）。'
        : '正在调用模型，请等待当前步骤完成…',
    );
  }
}

/* ------------------------------------------------------------------ 设置 */

function fillSettingsForm() {
  dom.fieldProvider.value = settings.provider || DEFAULT_PROVIDER;
  dom.fieldBaseUrl.value = settings.baseUrl || '';
  dom.fieldModel.value = settings.model || '';
  dom.fieldApiKey.value = settings.apiKey || '';
  dom.fieldMemoryLimit.value = String(settings.memoryLimit ?? 3);
  updateProviderHint();
}

function collectSettingsForm() {
  return {
    provider: dom.fieldProvider.value,
    baseUrl: dom.fieldBaseUrl.value.trim(),
    model: dom.fieldModel.value.trim(),
    apiKey: dom.fieldApiKey.value.trim(),
    memoryLimit: clamp(Number(dom.fieldMemoryLimit.value) || 0, 0, 10),
  };
}

/** 把设置面板里未保存的改动采纳下来，返回是否发生了变更。 */
function syncUnsavedSettings() {
  const form = collectSettingsForm();
  if (!hasUnsavedChanges(form)) return false;

  settings = { ...settings, ...form };
  saveSettings(settings);
  renderProviderBadge();
  updateProviderHint();
  return true;
}

function hasUnsavedChanges(form) {
  return (
    form.provider !== settings.provider ||
    form.baseUrl !== settings.baseUrl ||
    form.model !== settings.model ||
    form.apiKey !== settings.apiKey ||
    Number(form.memoryLimit) !== Number(settings.memoryLimit)
  );
}

function updateProviderHint() {
  const providerId = dom.fieldProvider.value;
  const preset = getProvider(providerId);
  const isDemo = providerId === 'demo';

  // 演示模式不联网，接口相关字段直接禁用，避免误解成已填写。
  for (const node of [dom.fieldBaseUrl, dom.fieldModel, dom.fieldApiKey]) {
    node.disabled = isDemo;
  }

  const baseUrl = dom.fieldBaseUrl.value.trim() || preset.baseUrl;

  // 占位符跟着当前服务商走，避免选了 DeepSeek 却看到 OpenAI 的示例地址，
  // 让人误以为这两项必须手填。
  dom.fieldBaseUrl.placeholder = preset.baseUrl || 'https://api.example.com/v1';
  dom.fieldModel.placeholder = preset.model || '模型名称';

  const parts = [];
  if (preset.keyHint) parts.push(`Key 格式：${preset.keyHint}`);
  if (preset.docs) parts.push(`申请地址：${preset.docs}`);
  if (!isDemo && preset.baseUrl && (!dom.fieldBaseUrl.value.trim() || !dom.fieldModel.value.trim())) {
    parts.push('留空的地址或模型会使用服务商默认值');
  }
  if (!isDemo && detectProxy(baseUrl)) {
    parts.push('检测到代理地址，Key 由服务端持有，浏览器端可留空。');
  }
  dom.providerHint.textContent = parts.join('　|　');
  dom.keyWarning.hidden = isDemo || detectProxy(baseUrl) || !dom.fieldApiKey.value;
}

async function testConnection() {
  const draft = collectSettingsForm();
  let config;
  try {
    config = resolveConfig(draft);
  } catch (error) {
    setStatus(dom.settingsStatus, error.message, 'error');
    return;
  }

  setStatus(dom.settingsStatus, '正在测试…');
  dom.testConn.disabled = true;
  try {
    if (config.provider === 'demo') {
      setStatus(dom.settingsStatus, '演示模式不需要联网，可直接保存使用。', 'ok');
      return;
    }
    const reply = await streamChatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      maxTokens: 32,
      messages: [
        { role: 'system', content: '你是一个连通性测试助手。' },
        { role: 'user', content: '只回复两个字：正常' },
      ],
    });
    const unsavedTip = hasUnsavedChanges(draft) ? '（改动还没保存，点「保存」后生成时才生效）' : '';
    setStatus(
      dom.settingsStatus,
      `连接成功，模型返回：${truncate(reply.trim(), 40)}${unsavedTip}`,
      'ok',
    );
  } catch (error) {
    setStatus(dom.settingsStatus, `连接失败：${error.message}`, 'error');
  } finally {
    dom.testConn.disabled = false;
  }
}

/* ------------------------------------------------------------------ 导出与工具 */

function exportMarkdown() {
  if (!lastResult) return;
  downloadFile(buildExportFilename(), exportPayload());
  toast('已下载 Markdown 文件');
}

/** 从当前 DOM 收集各步骤输出，交给纯函数生成 Markdown。 */
function exportPayload() {
  const stages = [...dom.stageList.children].map((view) => ({
    name: view.querySelector('.stage-name')?.textContent || '未命名步骤',
    text: view.querySelector('.stage-body .markdown')?.innerText || '',
    reasoning: view.querySelector('.reasoning-text')?.textContent || '',
  }));
  return buildExportMarkdown({
    task: lastTask || dom.task.value.trim(),
    providerLabel: getProvider(settings.provider).label,
    model: settings.provider === 'demo' ? '演示模式' : settings.model || '',
    stages,
    final: lastResult,
  });
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function setStatus(node, text, kind = '') {
  node.textContent = text;
  node.className = `status-line${kind ? ` ${kind}` : ''}`;
}

let toastTimer = 0;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2200);
}

function truncate(text, max) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
