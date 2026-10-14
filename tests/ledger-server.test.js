import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLedger } from '../server/ledger.js';
import { firebaseToken, JWKS_URL, publicJWKS } from '../test-fixtures/firebase-auth.js';

// Synthetic D1 statements implement the server's owner-scoped atomic CAS contract.
// This verifies handler behavior; it does not exercise Cloudflare's actual database.
function mockLedgerDB() {
  const rows = new Map();
  let statements = 0;
  return {
    rows: () => new Map(rows),
    statements: () => statements,
    prepare(sql) {
      statements++;
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.startsWith('SELECT revision,state_json,updated_at FROM ledgers')) {
                assert.match(sql, /WHERE owner=\?/);
                assert.equal(args.length, 1);
                return rows.get(args[0]) || null;
              }
              if (sql.startsWith('INSERT INTO ledgers')) {
                assert.match(sql, /ON CONFLICT\(owner\) DO NOTHING RETURNING revision/);
                const [owner, state_json, updated_at] = args;
                assert.equal(args.length, 3);
                if (rows.has(owner)) return null;
                rows.set(owner, { revision: 1, state_json, updated_at });
                return { revision: 1 };
              }
              assert.match(sql, /^UPDATE ledgers SET revision=revision\+1/);
              assert.match(sql, /WHERE owner=\? AND revision=\? RETURNING revision/);
              const [state_json, updated_at, owner, revision] = args;
              assert.equal(args.length, 4);
              const previous = rows.get(owner);
              if (!previous || previous.revision !== revision) return null;
              const next = { revision: previous.revision + 1, state_json, updated_at };
              rows.set(owner, next);
              return { revision: next.revision };
            },
          };
        },
      };
    },
  };
}

const state = (description = 'synthetic') => ({
  version: 2,
  openingCents: 0,
  demo: false,
  trips: [],
  entries: [
    {
      id: 'synthetic-entry',
      date: '2026-10-12',
      type: 'expense',
      amountCents: 6500,
      description,
      category: 'synthetic',
      tripId: '',
    },
  ],
});

async function fixture(run) {
  const originalFetch = globalThis.fetch;
  const origin = 'https://synthetic-ledger.invalid';
  const project = 'synthetic-ledger-project';
  const db = mockLedgerDB();
  const token = (owner, changes = {}) =>
    firebaseToken(project, owner, { email: owner + '@example.invalid', ...changes });
  let authStatus = 200,
    verified = true,
    lookupCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === JWKS_URL) return Response.json(publicJWKS);
    assert.match(String(url), /^https:\/\/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup\?/);
    lookupCalls++;
    if (authStatus !== 200) return Response.json({ error: 'synthetic' }, { status: authStatus });
    const { idToken } = JSON.parse(options.body);
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
    return Response.json({
      users: [
        {
          localId: claims.sub,
          emailVerified: verified,
          email: claims.sub + '@example.invalid',
        },
      ],
    });
  };
  const env = {
    FIREBASE_WEB_API_KEY: 'synthetic-not-real-key',
    FIREBASE_PROJECT_ID: project,
    BUDGET_ALLOWED_EMAILS: 'owner-a@example.invalid,owner-b@example.invalid',
    BUDGET_AI_DB: db,
  };
  const request = (method = 'GET', owner = 'owner-a', payload, headers = {}) =>
    new Request(origin + '/api/ledger', {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token(owner),
        ...headers,
      },
      ...(payload === undefined
        ? {}
        : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
    });
  try {
    await run({
      db,
      env,
      request,
      token,
      lookupCalls: () => lookupCalls,
      authStatus: (status) => {
        authStatus = status;
      },
      verified: (value) => {
        verified = value;
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Ledger server authorization, owner isolation and revision CAS', async (t) => {
  await t.test(
    'missing bearer, rejected identity and unapproved owners cannot access D1',
    async () => {
      await fixture(async ({ db, env, request, authStatus, verified }) => {
        assert.equal(
          (await handleLedger(request('GET', 'owner-a', undefined, { Authorization: '' }), env))
            .status,
          401,
        );
        authStatus(400);
        assert.equal((await handleLedger(request(), env)).status, 401);
        authStatus(200);
        assert.equal((await handleLedger(request('GET', 'excluded-owner'), env)).status, 403);
        verified(false);
        assert.equal((await handleLedger(request(), env)).status, 403);
        assert.equal(db.statements(), 0);
        assert.equal(db.rows().size, 0);
      });
    },
  );
  await t.test(
    'wrong project claims, missing auth configuration and foreign PUT origin fail closed',
    async () => {
      await fixture(async ({ db, env, request, token, lookupCalls }) => {
        assert.equal(
          (
            await handleLedger(
              request('GET', 'owner-a', undefined, {
                Authorization: 'Bearer ' + token('owner-a', { aud: 'other-project' }),
              }),
              env,
            )
          ).status,
          401,
        );
        assert.equal((await handleLedger(request(), { BUDGET_AI_DB: db })).status, 503);
        const before = lookupCalls();
        assert.equal(
          (
            await handleLedger(
              request(
                'PUT',
                'owner-a',
                { revision: 0, state: state() },
                {
                  Origin: 'https://foreign.invalid',
                },
              ),
              env,
            )
          ).status,
          403,
        );
        assert.equal(lookupCalls(), before);
        assert.equal(db.statements(), 0);
      });
    },
  );
  await t.test('GET and PUT retain independent owner ledgers even when IDs match', async () => {
    await fixture(async ({ db, env, request }) => {
      assert.deepEqual(await (await handleLedger(request(), env)).json(), {
        state: null,
        revision: 0,
      });
      assert.equal(
        (
          await handleLedger(
            request('PUT', 'owner-a', { revision: 0, state: state('owner A only') }),
            env,
          )
        ).status,
        200,
      );
      assert.deepEqual(await (await handleLedger(request('GET', 'owner-b'), env)).json(), {
        state: null,
        revision: 0,
      });
      assert.equal(
        (
          await handleLedger(
            request('PUT', 'owner-b', { revision: 0, state: state('owner B only') }),
            env,
          )
        ).status,
        200,
      );
      for (const [owner, description] of [
        ['owner-a', 'owner A only'],
        ['owner-b', 'owner B only'],
      ]) {
        const response = await handleLedger(request('GET', owner), env);
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.revision, 1);
        assert.deepEqual(result.state, state(description));
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      assert.equal(db.rows().size, 2);
    });
  });
  await t.test('stale insert and update return 409 without overwriting current data', async () => {
    await fixture(async ({ db, env, request }) => {
      const put = (revision, description) =>
        handleLedger(request('PUT', 'owner-a', { revision, state: state(description) }), env);
      assert.equal((await put(0, 'first')).status, 200);
      const first = db.rows();
      assert.equal((await put(0, 'stale create')).status, 409);
      assert.deepEqual(db.rows(), first);
      const update = await put(1, 'second');
      assert.equal(update.status, 200);
      assert.equal((await update.json()).revision, 2);
      const second = db.rows();
      assert.equal((await put(1, 'stale update')).status, 409);
      assert.deepEqual(db.rows(), second);
      assert.equal((await put(99, 'unknown revision')).status, 409);
      assert.deepEqual(db.rows(), second);
    });
  });
  await t.test('concurrent matching revisions admit one writer', async () => {
    await fixture(async ({ db, env, request }) => {
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          handleLedger(
            request('PUT', 'owner-a', { revision: 0, state: state('create-' + index) }),
            env,
          ),
        ),
      );
      assert.equal(responses.filter((response) => response.status === 200).length, 1);
      assert.equal(responses.filter((response) => response.status === 409).length, 5);
      const updates = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          handleLedger(
            request('PUT', 'owner-a', { revision: 1, state: state('update-' + index) }),
            env,
          ),
        ),
      );
      assert.equal(updates.filter((response) => response.status === 200).length, 1);
      assert.equal(updates.filter((response) => response.status === 409).length, 5);
      assert.equal(db.rows().get('owner-a').revision, 2);
    });
  });
  await t.test('version 1 PUT is refused with 426 while legacy GET migrates safely', async () => {
    await fixture(async ({ db, env, request }) => {
      const legacy = { ...state(), version: 1 };
      delete legacy.trips;
      delete legacy.entries[0].tripId;
      const before = db.rows();
      assert.equal(
        (await handleLedger(request('PUT', 'owner-a', { revision: 0, state: legacy }), env)).status,
        426,
      );
      assert.deepEqual(db.rows(), before);
      await db
        .prepare(
          'INSERT INTO ledgers (owner,revision,state_json,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING RETURNING revision',
        )
        .bind('owner-a', JSON.stringify(legacy), '2026-10-12T00:00:00.000Z')
        .first();
      const stored = db.rows();
      const result = await (await handleLedger(request(), env)).json();
      assert.deepEqual(result.state, state());
      assert.equal(result.revision, 1);
      assert.deepEqual(db.rows(), stored);
    });
  });
  await t.test(
    'invalid money, date, IDs, trip links, demo data and revisions cannot write',
    async () => {
      await fixture(async ({ db, env, request }) => {
        const invalid = [];
        for (const field of ['amountCents', 'date', 'tripId']) {
          const next = state();
          next.entries[0][field] = { amountCents: 1.5, date: '2026-02-30', tripId: 'missing-trip' }[
            field
          ];
          invalid.push(next);
        }
        invalid.push({ ...state(), demo: true });
        const duplicate = state();
        duplicate.entries.push({ ...duplicate.entries[0] });
        invalid.push(duplicate);
        const tooMany = state();
        tooMany.entries = Array.from({ length: 10001 }, (_, i) => ({
          ...state().entries[0],
          id: 'entry-' + i,
        }));
        invalid.push(tooMany);
        for (const next of invalid)
          assert.equal(
            (await handleLedger(request('PUT', 'owner-a', { revision: 0, state: next }), env))
              .status,
            400,
          );
        for (const revision of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER])
          assert.equal(
            (await handleLedger(request('PUT', 'owner-a', { revision, state: state() }), env))
              .status,
            400,
          );
        assert.equal(db.rows().size, 0);
        assert.equal(db.statements(), 0);
      });
    },
  );
  await t.test('missing database and database exceptions fail closed', async () => {
    await fixture(async ({ db, env, request }) => {
      for (const method of ['GET', 'PUT']) {
        const payload = method === 'PUT' ? { revision: 0, state: state() } : undefined;
        assert.equal(
          (await handleLedger(request(method, 'owner-a', payload), { ...env, BUDGET_AI_DB: null }))
            .status,
          503,
        );
        assert.equal(
          (
            await handleLedger(request(method, 'owner-a', payload), {
              ...env,
              BUDGET_AI_DB: {
                prepare() {
                  throw new Error('synthetic unavailable');
                },
              },
            })
          ).status,
          503,
        );
      }
      assert.equal(db.rows().size, 0);
    });
  });
  await t.test(
    'oversized body, malformed JSON, content type and method are refused before D1 writes',
    async () => {
      await fixture(async ({ db, env, request }) => {
        const oversized = JSON.stringify({
          revision: 0,
          state: state(),
          padding: 'x'.repeat(2 * 1024 * 1024),
        });
        assert.equal((await handleLedger(request('PUT', 'owner-a', oversized), env)).status, 413);
        assert.equal((await handleLedger(request('PUT', 'owner-a', '{broken'), env)).status, 400);
        for (const payload of [null, [], 1, true, 'synthetic']) {
          assert.equal(
            (await handleLedger(request('PUT', 'owner-a', JSON.stringify(payload)), env)).status,
            400,
          );
        }
        assert.equal(
          (
            await handleLedger(
              request('PUT', 'owner-a', '{}', { 'Content-Type': 'text/plain' }),
              env,
            )
          ).status,
          415,
        );
        assert.equal((await handleLedger(request('POST', 'owner-a', {}), env)).status, 405);
        assert.equal(db.rows().size, 0);
        assert.equal(db.statements(), 0);
      });
    },
  );
});
