/**
 * 零依赖端到端冒烟测试：用本机 Chrome（headless）验证登录门的真实行为。
 *
 * 覆盖：未登录只能看到登录页 → 密码错误被拒 → 正确凭据进入工作台 →
 * 刷新后会话保持 → 退出登录后重新回到登录页。
 *
 * 用法：node scripts/e2e-auth-check.mjs [url]
 * 默认测 http://localhost:5188/，需先运行 node scripts/dev-server.mjs。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.argv[2] ?? 'http://localhost:5188/';
const PORT = 9333;

const CHROME_CANDIDATES = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function findBrowser() {
  const found = CHROME_CANDIDATES.find((path) => path && existsSync(path));
  if (!found) throw new Error('未找到 Chrome / Edge，无法执行端到端检查');
  return found;
}

async function fetchJson(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // 浏览器还没起来，继续等。
    }
    await sleep(250);
  }
  throw new Error(`等待 ${url} 超时`);
}

function createClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    listeners.forEach((listener) => listener(message));
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('CDP 连接失败')));
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const once = (method) =>
    new Promise((resolve) => {
      const listener = (message) => {
        if (message.method === method) {
          listeners.delete(listener);
          resolve(message.params);
        }
      };
      listeners.add(listener);
    });

  return { ready, send, once, close: () => socket.close() };
}

async function main() {
  const browserPath = findBrowser();
  const userDataDir = mkdtempSync(join(tmpdir(), 'macroagent-e2e-'));
  const browser = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let client;
  try {
    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('没有可用的页面目标');

    client = createClient(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    const evaluate = async (expression) => {
      const result = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(`页面内脚本报错：${result.exceptionDetails.text}`);
      }
      return result.result.value;
    };

    const goto = async (url) => {
      const loaded = client.once('Page.loadEventFired');
      await client.send('Page.navigate', { url });
      await loaded;
      await sleep(400);
    };

    await goto(URL_UNDER_TEST);

    const snapshot = `(() => ({
      bodyClass: document.body.className,
      gateVisible: !document.getElementById('auth-gate').hidden,
      topbarDisplay: getComputedStyle(document.querySelector('.topbar')).display,
      layoutDisplay: getComputedStyle(document.querySelector('.layout')).display,
      status: document.getElementById('auth-status').textContent.trim(),
    }))()`;

    const locked = await evaluate(snapshot);
    check(
      '未登录时只显示登录页',
      locked.gateVisible && locked.topbarDisplay === 'none' && locked.layoutDisplay === 'none',
      `body=${locked.bodyClass}`,
    );

    const submit = (user, pass) => `(async () => {
      document.getElementById('auth-user').value = ${JSON.stringify(user)};
      document.getElementById('auth-pass').value = ${JSON.stringify(pass)};
      document.getElementById('auth-form').requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 120));
      return ${snapshot};
    })()`;

    const wrongUser = await evaluate(submit('18300004070', '123456'));
    check('账号错误被拒绝', wrongUser.gateVisible && wrongUser.status.includes('不正确'), wrongUser.status);

    const wrongPass = await evaluate(submit('18300004073', '654321'));
    check('密码错误被拒绝', wrongPass.gateVisible && wrongPass.status.includes('不正确'), wrongPass.status);

    const ok = await evaluate(submit('18300004073', '123456'));
    check(
      '正确凭据进入工作台',
      !ok.gateVisible && ok.topbarDisplay !== 'none' && ok.layoutDisplay !== 'none',
      `body=${ok.bodyClass}`,
    );

    const mounted = await evaluate(`(() => ({
      stages: document.querySelectorAll('#stage-list li').length,
      examples: document.querySelectorAll('#example-row button').length,
      providers: document.querySelectorAll('#field-provider option').length,
      session: localStorage.getItem('macroagent.session.v1'),
      hasLogout: !!document.getElementById('btn-logout'),
    }))()`);
    check(
      '工作台组件已渲染',
      mounted.stages === 5 && mounted.examples === 3 && mounted.providers >= 5,
      `阶段 ${mounted.stages} / 示例 ${mounted.examples} / 服务商 ${mounted.providers}`,
    );
    check('会话已写入本地存储且不含明文密码', Boolean(mounted.session) && !mounted.session.includes('123456'), mounted.session ?? '无');
    check('顶栏有退出登录入口', mounted.hasLogout);

    await goto(URL_UNDER_TEST);
    const afterReload = await evaluate(snapshot);
    check('刷新后会话保持', !afterReload.gateVisible && afterReload.topbarDisplay !== 'none');

    await evaluate(`document.getElementById('btn-logout').click()`);
    await sleep(800);
    const afterLogout = await evaluate(snapshot);
    check('退出登录后回到登录页', afterLogout.gateVisible && afterLogout.topbarDisplay === 'none');

    const cleared = await evaluate(`localStorage.getItem('macroagent.session.v1')`);
    check('退出后本地会话被清除', cleared === null);
  } finally {
    client?.close();
    browser.kill();
    await sleep(300);
    rmSync(userDataDir, { recursive: true, force: true });
  }

  const failed = results.filter((item) => !item.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`端到端检查失败：${error.message}`);
  process.exitCode = 1;
});
