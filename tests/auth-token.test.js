import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, handleAI } from '../server/ai.js';
import { handleLedger } from '../server/ledger.js';
import { firebaseToken, JWKS_URL, publicJWKS } from '../test-fixtures/firebase-auth.js';

const project = 'synthetic-security-project',
  owner = 'synthetic-security-owner';
const env = {
  FIREBASE_WEB_API_KEY: 'synthetic-not-real-key',
  FIREBASE_PROJECT_ID: project,
  BUDGET_ALLOWED_EMAILS: 'synthetic@example.invalid',
};
const origin = 'https://synthetic.invalid';
const request = (token, method = 'GET', endpoint = 'ledger') =>
  new Request(`${origin}/api/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify({ action: 'ask', text: 'synthetic' }) } : {}),
  });

test('Firebase JWT signature gate uses synthetic RSA and mock HTTP only', async (t) => {
  const originalFetch = globalThis.fetch;
  let keyCalls = 0,
    lookupCalls = 0,
    lookupStatus = 200,
    accountChanges = {};
  globalThis.fetch = async (url) => {
    if (String(url) === JWKS_URL) {
      keyCalls++;
      return Response.json(publicJWKS);
    }
    assert.match(String(url), /^https:\/\/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup\?/);
    lookupCalls++;
    if (lookupStatus !== 200) return Response.json({}, { status: lookupStatus });
    return Response.json({
      users: [
        {
          localId: owner,
          email: 'synthetic@example.invalid',
          emailVerified: true,
          ...accountChanges,
        },
      ],
    });
  };
  try {
    await t.test('invalid headers and claims cause no JWKS or account lookup', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cases = [
        'x'.repeat(150),
        firebaseToken(project, owner, {}, { alg: 'none' }),
        firebaseToken(project, owner, {}, { kid: '' }),
        firebaseToken(project, owner, {}, { kid: undefined }),
        firebaseToken(project, owner, { exp: now - 1 }),
        firebaseToken(project, owner, { iat: now + 60 }),
        firebaseToken(project, owner, { auth_time: now + 60 }),
        firebaseToken(project, owner, { aud: 'wrong-project' }),
        firebaseToken(project, owner, { iss: 'https://attacker.invalid' }),
        firebaseToken(project, owner, { sub: '' }),
        firebaseToken(project, owner, { sub: 'x'.repeat(129) }),
        firebaseToken(project, owner, { exp: undefined }),
        firebaseToken(project, owner, { auth_time: undefined }),
      ];
      for (const token of cases)
        await assert.rejects(authenticate(request(token), env), (error) => error.status === 401);
      assert.equal(keyCalls, 0);
      assert.equal(lookupCalls, 0);
    });
    await t.test(
      'Cloudflare cold-key concurrency fetches once and reports transient 503',
      async () => {
        const originalPair = globalThis.WebSocketPair,
          normalFetch = globalThis.fetch;
        let releaseHeaders, releaseBody;
        const headers = new Promise((resolve) => {
          releaseHeaders = resolve;
        });
        const body = new Promise((resolve) => {
          releaseBody = resolve;
        });
        const settle = async () => {
          for (let i = 0; i < 12; i++) await Promise.resolve();
        };
        globalThis.WebSocketPair = function SyntheticWebSocketPair() {};
        globalThis.fetch = async (url) => {
          assert.equal(String(url), JWKS_URL);
          keyCalls++;
          return headers;
        };
        try {
          const attempt = (index) =>
            authenticate(
              request(firebaseToken(project, owner, {}, { kid: 'cold-unknown-' + index })),
              env,
            ).then(
              () => 200,
              (error) => error.status,
            );
          const first = attempt(0);
          await settle();
          assert.deepEqual(
            await Promise.all(Array.from({ length: 8 }, (_, i) => attempt(i + 1))),
            Array(8).fill(503),
          );
          assert.equal(keyCalls, 1);
          releaseHeaders({ status: 200, json: () => body });
          await settle();
          assert.equal(await attempt(20), 503);
          assert.equal(keyCalls, 1);
          releaseBody(publicJWKS);
          assert.equal(await first, 401);
          assert.equal(lookupCalls, 0);
        } finally {
          globalThis.fetch = normalFetch;
          if (originalPair === undefined) delete globalThis.WebSocketPair;
          else globalThis.WebSocketPair = originalPair;
        }
      },
    );
    await t.test(
      'valid signature fetches fixed trusted JWKS and then checks current account',
      async () => {
        assert.equal(await authenticate(request(firebaseToken(project, owner)), env), owner);
        assert.equal(keyCalls, 1);
        assert.equal(lookupCalls, 1);
        assert.equal(await authenticate(request(firebaseToken(project, owner)), env), owner);
        assert.equal(keyCalls, 1);
        assert.equal(lookupCalls, 2);
      },
    );
    await t.test(
      'forged signature and unknown kids cause no account lookup or refresh storm',
      async () => {
        const before = lookupCalls;
        const parts = firebaseToken(project, owner).split('.');
        const signature = Buffer.from(parts[2], 'base64url');
        signature[0] ^= 1;
        parts[2] = signature.toString('base64url');
        await assert.rejects(
          authenticate(request(parts.join('.')), env),
          (error) => error.status === 401,
        );
        for (let i = 0; i < 12; i++)
          await assert.rejects(
            authenticate(request(firebaseToken(project, owner, {}, { kid: 'unknown-' + i })), env),
            (error) => error.status === 401,
          );
        assert.equal(lookupCalls, before);
        assert.equal(keyCalls, 1);
      },
    );
    await t.test('native bearer request keeps signature and current-account checks', async () => {
      const req = request(firebaseToken(project, owner));
      req.headers.delete('origin');
      assert.equal(await authenticate(req, env), owner);
      const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };
      assert.equal((await handleLedger(req, { ...env, BUDGET_AI_DB: db })).status, 200);
      const aiRequest = request(firebaseToken(project, owner), 'POST', 'ai');
      aiRequest.headers.delete('origin');
      // Authenticated, rejected by missing provider configuration before any quota/provider call.
      assert.equal((await handleAI(aiRequest, env)).status, 503);
    });
    await t.test('AI and ledger reject forgery before D1 and provider access', async () => {
      const before = lookupCalls;
      const token = firebaseToken(project, owner, {}, { alg: 'none' });
      const db = {
        prepare() {
          throw new Error('D1 must not be accessed');
        },
      };
      assert.equal(
        (
          await handleAI(request(token, 'POST', 'ai'), {
            ...env,
            DEEPSEEK_API_KEY: 'synthetic',
            BUDGET_AI_DB: db,
          })
        ).status,
        401,
      );
      assert.equal((await handleLedger(request(token), { ...env, BUDGET_AI_DB: db })).status, 401);
      assert.equal(lookupCalls, before);
    });
    await t.test(
      'valid signature cannot bypass live account rejection or owner allowlist',
      async () => {
        lookupStatus = 400;
        await assert.rejects(
          authenticate(request(firebaseToken(project, owner)), env),
          (error) => error.status === 401,
        );
        lookupStatus = 200;
        await assert.rejects(
          authenticate(request(firebaseToken(project, owner)), {
            ...env,
            BUDGET_ALLOWED_EMAILS: 'other@example.invalid',
          }),
          (error) => error.status === 403,
        );
      },
    );
    await t.test('verified JWT for an excluded or unverified email causes no lookup', async () => {
      const before = lookupCalls;
      for (const changes of [
        { email: 'excluded@example.invalid' },
        { email_verified: false },
        { email: undefined },
      ])
        await assert.rejects(
          authenticate(request(firebaseToken(project, owner, changes)), env),
          (error) => error.status === 403,
        );
      assert.equal(lookupCalls, before);
      assert.equal(
        await authenticate(
          request(firebaseToken(project, owner, { email: 'SYNTHETIC@EXAMPLE.INVALID' })),
          env,
        ),
        owner,
      );
    });
    await t.test(
      'current disabled, revoked and unverified account states fail closed',
      async () => {
        const now = Math.floor(Date.now() / 1000);
        for (const changes of [
          { disabled: true },
          { validSince: String(now - 10) },
          { validSince: 'malformed' },
        ]) {
          accountChanges = changes;
          await assert.rejects(
            authenticate(request(firebaseToken(project, owner)), env),
            (error) => error.status === 401,
          );
        }
        accountChanges = { emailVerified: false };
        await assert.rejects(
          authenticate(request(firebaseToken(project, owner)), env),
          (error) => error.status === 403,
        );
        accountChanges = { validSince: String(now - 120) };
        assert.equal(await authenticate(request(firebaseToken(project, owner)), env), owner);
        accountChanges = {};
      },
    );
    await t.test('failed key fetch has a bounded cooldown and fails closed', async () => {
      // Isolated module instance tests a cold resolver without touching production cache.
      const { verifyFirebaseToken } = await import('../server/auth-token.js?synthetic-key-failure');
      let attempts = 0;
      globalThis.fetch = async (url) => {
        assert.equal(String(url), JWKS_URL);
        attempts++;
        throw new TypeError('synthetic offline');
      };
      for (let i = 0; i < 8; i++)
        await assert.rejects(verifyFirebaseToken(firebaseToken(project, owner), project));
      assert.equal(attempts, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
