import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAI } from '../server/ai.js';
import { firebaseToken, JWKS_URL, publicJWKS } from '../test-fixtures/firebase-auth.js';

// Implements D1's documented serialized, transactional batch behavior in memory.
function mockQuotaDB(initial = [], failAt = -1) {
  let rows = new Map(initial),
    chain = Promise.resolve();
  return {
    rows: () => new Map(rows),
    prepare(sql) {
      assert.match(sql, /CASE WHEN used < \? THEN used\+1 ELSE 0 END/);
      return {
        bind(bucket, max) {
          return { bucket, max };
        },
      };
    },
    batch(statements) {
      const operation = chain.then(() => {
        const next = new Map(rows),
          results = [];
        statements.forEach(({ bucket, max }, index) => {
          if (index === failAt) throw new Error('Synthetic database unavailable');
          const old = next.get(bucket);
          const used = old === undefined ? 1 : old < max ? old + 1 : 0;
          if (used <= 0)
            throw new Error('D1_ERROR: CHECK constraint failed: used > 0: SQLITE_CONSTRAINT');
          next.set(bucket, used);
          results.push({ success: true, results: [{ used }] });
        });
        rows = next;
        return results;
      });
      chain = operation.catch(() => {});
      return operation;
    },
  };
}

async function fixture(run) {
  const originalFetch = globalThis.fetch,
    OriginalDate = globalThis.Date;
  const now = OriginalDate.UTC(2026, 9, 12, 10);
  globalThis.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };
  const origin = 'https://synthetic.invalid',
    owner = 'synthetic-owner',
    project = 'synthetic-project';
  const token = firebaseToken(project, owner);
  const buckets = {
    day: 'day:2026-10-12:' + owner,
    minute: 'minute:' + Math.floor(now / 60000) + ':' + owner,
    global: 'global:2026-10-12',
  };
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === JWKS_URL) return Response.json(publicJWKS);
    if (String(url).startsWith('https://identitytoolkit.googleapis.com/'))
      return Response.json({
        users: [{ localId: owner, emailVerified: true, email: 'synthetic@example.invalid' }],
      });
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
    providerCalls++;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '{"answer":"synthetic"}' } }],
    });
  };
  const env = (db) => ({
    FIREBASE_WEB_API_KEY: 'synthetic-not-real-key',
    FIREBASE_PROJECT_ID: project,
    BUDGET_ALLOWED_EMAILS: 'synthetic@example.invalid',
    DEEPSEEK_API_KEY: 'synthetic-not-real-key',
    BUDGET_AI_DB: db,
  });
  const request = (changes = {}) =>
    new Request(origin + '/api/ai', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        ...changes,
      },
      body: JSON.stringify({
        action: 'ask',
        text: 'synthetic',
        context: { month: '2026-10', entries: [] },
      }),
    });
  try {
    await run({ env, request, buckets, calls: () => providerCalls });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = OriginalDate;
  }
}

test('AI server synthetic atomic quota boundaries', async (t) => {
  await t.test('minute rejection leaves daily and global counts unchanged', async () => {
    await fixture(async ({ env, request, buckets, calls }) => {
      const db = mockQuotaDB();
      for (let i = 0; i < 5; i++) assert.equal((await handleAI(request(), env(db))).status, 200);
      const before = db.rows();
      for (let i = 0; i < 10; i++) assert.equal((await handleAI(request(), env(db))).status, 429);
      assert.deepEqual(db.rows(), before);
      assert.equal(db.rows().get(buckets.day), 5);
      assert.equal(db.rows().get(buckets.global), 5);
      assert.equal(calls(), 5);
    });
  });
  await t.test('each exhausted bucket rolls back the entire reservation', async () => {
    for (const [kind, limit] of [
      ['day', 60],
      ['minute', 5],
      ['global', 100],
    ]) {
      await fixture(async ({ env, request, buckets, calls }) => {
        const db = mockQuotaDB([[buckets[kind], limit]]),
          before = db.rows();
        assert.equal((await handleAI(request(), env(db))).status, 429);
        assert.deepEqual(db.rows(), before);
        assert.equal(calls(), 0);
      });
    }
  });
  await t.test('concurrent requests share the last available slot', async () => {
    await fixture(async ({ env, request, buckets, calls }) => {
      const db = mockQuotaDB([
        [buckets.day, 4],
        [buckets.minute, 4],
        [buckets.global, 4],
      ]);
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => handleAI(request(), env(db))),
      );
      assert.equal(responses.filter((r) => r.status === 200).length, 1);
      assert.equal(responses.filter((r) => r.status === 429).length, 7);
      assert.deepEqual([...db.rows().values()], [5, 5, 5]);
      assert.equal(calls(), 1);
    });
  });
  await t.test('other database errors fail closed without becoming quota errors', async () => {
    await fixture(async ({ env, request, calls }) => {
      const db = mockQuotaDB([], 1);
      assert.equal((await handleAI(request(), env(db))).status, 502);
      assert.equal(db.rows().size, 0);
      assert.equal(calls(), 0);
    });
  });
  await t.test(
    'missing quota/auth configuration and foreign origin prevent paid requests',
    async () => {
      await fixture(async ({ env, request, calls }) => {
        assert.equal((await handleAI(request(), env(null))).status, 503);
        assert.equal((await handleAI(request(), {})).status, 503);
        assert.equal(
          (await handleAI(request({ Origin: 'https://other.invalid' }), env(mockQuotaDB()))).status,
          403,
        );
        assert.equal(
          (await handleAI(request({ Authorization: '' }), env(mockQuotaDB()))).status,
          401,
        );
        assert.equal(calls(), 0);
      });
    },
  );
  await t.test('owner allowlist and Firebase project claims are enforced', async () => {
    await fixture(async ({ env, request, calls }) => {
      const db = mockQuotaDB();
      const excluded = env(db);
      excluded.BUDGET_ALLOWED_EMAILS = 'other@example.invalid';
      assert.equal((await handleAI(request(), excluded)).status, 403);
      const otherProject = env(db);
      otherProject.FIREBASE_PROJECT_ID = 'other-synthetic-project';
      assert.equal((await handleAI(request(), otherProject)).status, 401);
      assert.equal(db.rows().size, 0);
      assert.equal(calls(), 0);
    });
  });
});
