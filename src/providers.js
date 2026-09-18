/**
 * OpenAI 兼容服务商预设。
 *
 * 上游脚本硬编码了 gpt-4o，网页版把服务商做成可配置项：
 * 只要对方提供 /chat/completions 接口即可接入。
 */

export const PROVIDERS = [
  {
    id: 'demo',
    label: '演示模式（无需 Key）',
    baseUrl: '',
    model: '',
    keyHint: '演示模式不联网，用内置示例内容跑通整条流水线',
    docs: '',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyHint: 'sk-...',
    docs: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 深度求索',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    keyHint: 'sk-...',
    docs: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    keyHint: 'sk-...',
    docs: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    keyHint: '形如 xxxx.yyyy',
    docs: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'dashscope',
    label: '阿里云百炼（通义千问）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    keyHint: 'sk-...',
    docs: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow 硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    keyHint: 'sk-...',
    docs: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'ollama',
    label: 'Ollama 本地模型',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    keyHint: '本地部署可留空',
    docs: 'https://ollama.com/download',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    keyHint: '按你的服务商填写',
    docs: '',
  },
];

/** 默认服务商：开箱即可用真实模型，未填 Key 时界面会给出提示。 */
export const DEFAULT_PROVIDER = 'deepseek';

export function getProvider(id) {
  return PROVIDERS.find((item) => item.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

/**
 * 把用户设置补全为一次请求需要的配置。
 * 演示模式不需要 baseUrl / apiKey / model。
 */
export function resolveConfig(settings = {}) {
  const preset = getProvider(settings.provider || DEFAULT_PROVIDER);
  const baseUrl = (settings.baseUrl || preset.baseUrl || '').trim();
  const model = (settings.model || preset.model || '').trim();
  const apiKey = (settings.apiKey || '').trim();

  if (settings.provider !== 'demo' && !baseUrl) {
    throw new Error('请填写 API 地址（Base URL）');
  }
  if (settings.provider !== 'demo' && !model) {
    throw new Error('请填写模型名称');
  }

  return { provider: settings.provider, baseUrl, model, apiKey };
}

/** 部署到 Cloudflare Worker 代理时，Base URL 指向 Worker 即可，Key 留在服务端。 */
export function detectProxy(baseUrl) {
  return /workers\.dev|pages\.dev|\/proxy\b/i.test(baseUrl || '');
}
