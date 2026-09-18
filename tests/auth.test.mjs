import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_USER,
  SESSION_TTL_MS,
  createSession,
  hashPassword,
  isSessionValid,
  sha256Hex,
  verifyCredentials,
} from '../src/auth.js';
import { clearSession, loadSession, saveSession } from '../src/store.js';

test('sha256Hex 与标准测试向量一致', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('sha256Hex 处理分块边界与多字节字符', () => {
  // 55/56/64 是补齐分块的边界，历史上容易算错。
  assert.equal(
    sha256Hex('a'.repeat(55)),
    '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
  );
  assert.equal(
    sha256Hex('a'.repeat(56)),
    'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
  );
  assert.equal(
    sha256Hex('a'.repeat(64)),
    'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
  );
  assert.equal(
    sha256Hex('中文密码测试🔐'),
    '2c88345ac1686b25cd7179eeb9849f4a3366bc959d97c9e01f6ef333733ca043',
  );
});

test('hashPassword 不落明文，且能校验管理员凭据', () => {
  const hash = hashPassword('123456');
  assert.notEqual(hash, '123456');
  assert.equal(hash.length, 64);
  assert.equal(hash, '4239354fa5a0f66a7a364b291d7f02ae2f3bd9d12a00d4da9621d6722e9c0746');

  assert.equal(verifyCredentials(ADMIN_USER, '123456'), true);
  assert.equal(verifyCredentials(` ${ADMIN_USER} `, '123456'), true);
  assert.equal(verifyCredentials(ADMIN_USER, '1234567'), false);
  assert.equal(verifyCredentials(ADMIN_USER, ''), false);
  assert.equal(verifyCredentials('13800000000', '123456'), false);
  assert.equal(verifyCredentials(null, '123456'), false);
  assert.equal(verifyCredentials(ADMIN_USER, undefined), false);
});

test('会话有效期判定', () => {
  const now = 1_700_000_000_000;
  const session = createSession(ADMIN_USER, now);
  assert.equal(session.exp, now + SESSION_TTL_MS);
  assert.equal(isSessionValid(session, now), true);
  assert.equal(isSessionValid(session, now + SESSION_TTL_MS - 1), true);

  // 过期、结构损坏、账号不符都视为未登录。
  assert.equal(isSessionValid(session, now + SESSION_TTL_MS), false);
  assert.equal(isSessionValid(null, now), false);
  assert.equal(isSessionValid({}, now), false);
  assert.equal(isSessionValid({ user: ADMIN_USER, exp: 'later' }, now), false);
  assert.equal(isSessionValid({ user: 'someone-else', exp: now + 1000 }, now), false);
});

test('会话可写入本地存储并清除', () => {
  clearSession();
  assert.equal(loadSession(), null);

  const session = createSession();
  saveSession(session);
  assert.deepEqual(loadSession(), session);

  clearSession();
  assert.equal(loadSession(), null);
});
