/**
 * Cloudflare Worker：OpenAI 兼容接口的反向代理。
 *
 * 作用：把 API Key 留在服务端，浏览器端只拿一个访问口令，
 * 同时解决部分服务商不允许浏览器直连（CORS）的问题。
 *
 * 环境变量（在 Cloudflare 控制台 Settings → Variables 中配置，建议用 Secret）：
 *   API_KEY          必填，真实模型服务商的 Key
 *   UPSTREAM_BASE    可选，默认 https://api.openai.com/v1
 *   ACCESS_TOKEN     可选，设置后前端必须在 API Key 栏填入同样的值
 *   ALLOWED_ORIGIN   可选，默认 *，建议部署后改成你自己的 Pages 域名
 */

const DEFAULT_UPSTREAM = 'https://api.openai.com/v1';

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: { message: '只支持 POST 请求' } }, 405, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    // 允许直接发到根路径，也允许 /v1/chat/completions 这类完整路径。
    const suffix = path ? (path.startsWith('v1/') ? path.slice(3) : path) : 'chat/completions';

    if (!suffix.startsWith('chat/completions')) {
      return json({ error: { message: `不支持的路径：/${path}` } }, 404, cors);
    }

    if (env.ACCESS_TOKEN) {
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (token !== env.ACCESS_TOKEN) {
        return json({ error: { message: '访问口令不正确' } }, 401, cors);
      }
    }

    if (!env.API_KEY) {
      return json({ error: { message: '服务端未配置 API_KEY' } }, 500, cors);
    }

    const upstream = (env.UPSTREAM_BASE || DEFAULT_UPSTREAM).replace(/\/+$/, '');
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(`${upstream}/${suffix}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.API_KEY}`,
        },
        body: request.body,
      });
    } catch (error) {
      return json({ error: { message: `上游请求失败：${error.message}` } }, 502, cors);
    }

    const headers = new Headers(upstreamResponse.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');

    // 直接把上游的流式响应透传给浏览器。
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });
  },
};

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}
