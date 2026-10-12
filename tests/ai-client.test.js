import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAI } from '../ai-client.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function harness(run) {
  const original = {
    window: globalThis.window,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const timers = new Map(),
    calls = [];
  let nextTimer = 0,
    owner = 'synthetic-owner';
  globalThis.setTimeout = (callback, delay) => {
    assert.equal(delay, 60000);
    timers.set(++nextTimer, callback);
    return nextTimer;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.window = {
    budgetAuth: {
      ready: Promise.resolve(),
      getUser: () => ({ uid: owner }),
      getToken: async () => 'synthetic-not-real-token',
    },
  };
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return Response.json({ answer: 'synthetic' });
  };
  const controls = {
    calls,
    timers,
    auth: globalThis.window.budgetAuth,
    changeOwner(value) {
      owner = value;
    },
    expire() {
      assert.equal(timers.size, 1);
      [...timers.values()][0]();
    },
    async settle() {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
  try {
    await run(controls);
  } finally {
    Object.assign(globalThis, original);
  }
}

test('AI client synthetic request boundaries', async (t) => {
  await t.test('timeout bounds hanging startup and prevents late token lookup', async () => {
    await harness(async ({ auth, expire, settle, calls, timers }) => {
      const ready = deferred();
      auth.ready = ready.promise;
      let tokenCalls = 0;
      auth.getToken = async () => {
        tokenCalls++;
        return 'synthetic';
      };
      const pending = requestAI({ action: 'ask' });
      const rejected = assert.rejects(pending, /ใช้เวลานานเกินไป/);
      expire();
      await rejected;
      ready.resolve();
      await settle();
      assert.equal(tokenCalls, 0);
      assert.equal(calls.length, 0);
      assert.equal(timers.size, 0);
    });
  });
  await t.test('timeout bounds token refresh and prevents late paid request', async () => {
    await harness(async ({ auth, expire, settle, calls }) => {
      const token = deferred();
      auth.getToken = () => token.promise;
      const pending = requestAI({ action: 'ask' });
      await settle();
      const rejected = assert.rejects(pending, /ใช้เวลานานเกินไป/);
      expire();
      await rejected;
      token.resolve('synthetic-not-real-token');
      await settle();
      assert.equal(calls.length, 0);
    });
  });
  await t.test('timeout bounds fetch and response body waits', async () => {
    for (const stage of ['fetch', 'body'])
      await harness(async ({ expire, settle }) => {
        const wait = deferred();
        globalThis.fetch = async () =>
          stage === 'fetch' ? wait.promise : { ok: true, json: () => wait.promise };
        const pending = requestAI({ action: 'ask' });
        await settle();
        const rejected = assert.rejects(pending, /ใช้เวลานานเกินไป/);
        expire();
        await rejected;
        wait.resolve(
          stage === 'fetch' ? Response.json({ answer: 'synthetic' }) : { answer: 'synthetic' },
        );
        await settle();
      });
  });
  await t.test('owner change while token pending blocks payload', async () => {
    await harness(async ({ auth, changeOwner, settle, calls }) => {
      const token = deferred();
      auth.getToken = () => token.promise;
      const pending = requestAI({ action: 'ask' });
      await settle();
      changeOwner('other-synthetic-owner');
      token.resolve('synthetic');
      await assert.rejects(pending, /บัญชีเปลี่ยน/);
      assert.equal(calls.length, 0);
    });
  });
  await t.test('missing token blocks network', async () => {
    await harness(async ({ auth, calls }) => {
      auth.getToken = async () => null;
      await assert.rejects(requestAI({}), /เข้าสู่ระบบ/);
      assert.equal(calls.length, 0);
    });
  });
  await t.test('success uses authenticated same-origin JSON and clears timer', async () => {
    await harness(async ({ calls, timers }) => {
      assert.deepEqual(await requestAI({ action: 'ask' }), { answer: 'synthetic' });
      assert.equal(calls[0][0], '/api/ai');
      assert.equal(calls[0][1].credentials, 'same-origin');
      assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-not-real-token');
      assert.equal(timers.size, 0);
    });
  });
  await t.test('network, non-JSON and quota failures are translated', async () => {
    for (const [response, expected] of [
      [
        () => {
          throw new TypeError('synthetic network');
        },
        /เชื่อมต่อ AI ไม่สำเร็จ/,
      ],
      [() => new Response('not JSON'), /คำตอบที่อ่านไม่ได้/],
      [() => Response.json({}, { status: 429 }), /ขีดจำกัด/],
      [() => Response.json({}, { status: 403 }), /รับสิทธิ์/],
    ])
      await harness(async () => {
        globalThis.fetch = async () => response();
        await assert.rejects(requestAI({}), expected);
      });
  });
});
