/**
 * 本地持久化：替代上游脚本的 memory.json。
 * localStorage 不可用时（隐私模式、Node 测试环境）自动降级为内存存储。
 */

const MEMORY_KEY = 'macroagent.memory.v1';
const SETTINGS_KEY = 'macroagent.settings.v1';
const MEMORY_LIMIT = 50;

function createDriver() {
  try {
    const probe = '__macroagent_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
    };
  }
}

const driver = createDriver();

function readJSON(key, fallback) {
  try {
    const raw = driver.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    driver.setItem(key, JSON.stringify(value));
  } catch {
    // 容量超限时忽略，不影响主流程。
  }
}

export function loadMemory() {
  const data = readJSON(MEMORY_KEY, []);
  return Array.isArray(data) ? data : [];
}

export function saveMemory(list) {
  writeJSON(MEMORY_KEY, list.slice(-MEMORY_LIMIT));
}

export function addMemoryEntry(entry, list = loadMemory()) {
  const next = [...list, entry].slice(-MEMORY_LIMIT);
  saveMemory(next);
  return next;
}

export function removeMemoryEntry(id, list = loadMemory()) {
  const next = list.filter((item) => item.id !== id);
  saveMemory(next);
  return next;
}

export function clearMemory() {
  driver.removeItem(MEMORY_KEY);
  return [];
}

export function loadSettings(fallback = {}) {
  return { ...fallback, ...readJSON(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  writeJSON(SETTINGS_KEY, settings);
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export { MEMORY_LIMIT };
