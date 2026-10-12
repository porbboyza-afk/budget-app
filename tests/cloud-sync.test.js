import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudSync } from '../cloud-sync.js';

const empty = () => ({ version: 2, openingCents: 0, demo: false, entries: [], trips: [] });
const filled = () => ({
  ...empty(),
  entries: [
    {
      id: 'synthetic',
      date: '2026-10-12',
      type: 'expense',
      amountCents: 1250,
      description: 'synthetic',
      category: '',
      tripId: '',
    },
  ],
});
function harness(
  t,
  { initial = empty(), raw = JSON.stringify(initial), fault = false, meta = null } = {},
) {
  const names = ['window', 'document', 'localStorage', 'fetch', 'confirm'];
  const prior = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const storage = new Map();
  if (meta !== null) storage.set('synthetic:sync', JSON.stringify(meta));
  const seen = [],
    backups = [],
    rawBackups = [],
    notices = [],
    writes = [];
  let state = initial,
    currentRaw = raw,
    damaged = fault;
  globalThis.window = new EventTarget();
  window.budgetAuth = { getToken: async () => 'synthetic-token' };
  globalThis.document = new EventTarget();
  document.visibilityState = 'hidden';
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.confirm = () => true;
  const sync = createCloudSync({
    key: 'synthetic',
    getRaw: () => currentRaw,
    getState: () => {
      if (damaged) throw new Error('Unreadable local');
      return state;
    },
    getLocalBackup: () => ({ state: damaged ? null : state, raw: currentRaw }),
    applyState: (next, options = {}) => {
      if (damaged && !options.recovery) throw new Error('Explicit recovery required');
      state = next;
      currentRaw = JSON.stringify(next);
      damaged = false;
      writes.push({ next, options });
    },
    status: (text, conflict) => seen.push({ text, conflict }),
    backup: (data, label) => backups.push({ data, label }),
    backupRaw: (data, label) => rawBackups.push({ data, label }),
    notify: (message) => notices.push(message),
  });
  t.after(() => {
    sync.dispose();
    names.forEach((name, i) => {
      if (prior[i]) Object.defineProperty(globalThis, name, prior[i]);
      else delete globalThis[name];
    });
  });
  return {
    sync,
    seen,
    backups,
    rawBackups,
    notices,
    writes,
    storage,
    getState: () => state,
    setLocal(next) {
      state = next;
      currentRaw = JSON.stringify(next);
    },
  };
}

test('explicit cloud recovery restores erased local data without backing up a fake empty ledger', async (t) => {
  const h = harness(t, { raw: null, fault: true });
  globalThis.fetch = async () => Response.json({ state: filled(), revision: 3 });
  h.sync.pause();
  await h.sync.useCloud();
  assert.deepEqual(h.getState(), filled());
  assert.equal(h.writes[0].options.recovery, true);
  assert.deepEqual(
    h.backups.map((item) => item.label),
    ['cloud-before-sync'],
  );
  assert.equal(h.rawBackups.length, 0);
  assert.equal(h.seen.at(-1).conflict, false);
});

test('explicit cloud recovery preserves damaged raw JSON and refuses local upload', async (t) => {
  const h = harness(t, { raw: '{broken-json', fault: true });
  globalThis.fetch = async () => Response.json({ state: filled(), revision: 3 });
  h.sync.pause();
  await h.sync.useLocal();
  assert.equal(h.writes.length, 0);
  await h.sync.useCloud();
  assert.equal(h.rawBackups[0].data, '{broken-json');
  assert.deepEqual(
    h.backups.map((item) => item.label),
    ['cloud-before-sync'],
  );
  assert.deepEqual(h.getState(), filled());
});

test('pause during pending automatic PUT remains paused and does not claim sync succeeded', async (t) => {
  const h = harness(t, { initial: filled(), meta: { revision: 1, raw: JSON.stringify(empty()) } });
  let release, reached;
  const putReached = new Promise((resolve) => {
    reached = resolve;
  });
  globalThis.fetch = async (_, { method }) =>
    method === 'GET'
      ? Response.json({ state: empty(), revision: 1 })
      : new Promise((resolve) => {
          release = () => resolve(Response.json({ revision: 2 }));
          reached();
        });
  const pending = h.sync.start();
  await putReached;
  h.sync.pause('synthetic pause');
  release();
  await pending;
  assert.deepEqual(h.seen.at(-1), { text: 'synthetic pause', conflict: true });
  assert.equal(JSON.parse(h.storage.get('synthetic:sync')).revision, 1);
});

test('new pause during explicit local PUT cannot be cleared by its delayed response', async (t) => {
  const h = harness(t, { initial: filled() });
  let release, reached;
  const putReached = new Promise((resolve) => {
    reached = resolve;
  });
  globalThis.fetch = async (_, { method }) =>
    method === 'GET'
      ? Response.json({ state: empty(), revision: 1 })
      : new Promise((resolve) => {
          release = () => resolve(Response.json({ revision: 2 }));
          reached();
        });
  h.sync.pause();
  const pending = h.sync.useLocal();
  await putReached;
  h.sync.pause('synthetic second pause');
  release();
  await pending;
  assert.equal(h.seen.at(-1).conflict, true);
  assert.equal(h.storage.has('synthetic:sync'), false);
});

test('malformed sync metadata is ignored and does not authorize silent overwrite', async (t) => {
  const h = harness(t, { initial: filled(), meta: { revision: 1, raw: 123 } });
  const methods = [];
  globalThis.fetch = async (_, { method }) => {
    methods.push(method);
    return Response.json({ state: empty(), revision: 1 });
  };
  await h.sync.start();
  assert.deepEqual(methods, ['GET']);
  assert.equal(h.seen.at(-1).conflict, true);
  assert.equal(h.writes.length, 0);
});

test('identical local and cloud content acknowledges another tab revision without a false conflict', async (t) => {
  const h = harness(t, { initial: filled(), meta: { revision: 1, raw: JSON.stringify(empty()) } });
  const methods = [];
  globalThis.fetch = async (_, { method }) => {
    methods.push(method);
    return Response.json({ state: filled(), revision: 2 });
  };
  await h.sync.start();
  assert.deepEqual(methods, ['GET']);
  assert.equal(h.seen.at(-1).conflict, false);
  assert.equal(JSON.parse(h.storage.get('synthetic:sync')).revision, 2);
  assert.equal(h.writes.length, 0);
});

test('disposed account ignores a delayed GET without applying another owner data', async (t) => {
  const h = harness(t, { raw: null });
  let release, reached;
  const getReached = new Promise((resolve) => {
    reached = resolve;
  });
  globalThis.fetch = async () =>
    new Promise((resolve) => {
      release = () => resolve(Response.json({ state: filled(), revision: 2 }));
      reached();
    });
  const pending = h.sync.start();
  await getReached;
  h.sync.dispose();
  release();
  await pending;
  assert.equal(h.writes.length, 0);
  assert.equal(h.storage.has('synthetic:sync'), false);
});

test('a backward cloud revision preserves newer local data pending explicit choice', async (t) => {
  const h = harness(t, { initial: filled(), meta: { revision: 3, raw: JSON.stringify(filled()) } });
  globalThis.fetch = async () => Response.json({ state: empty(), revision: 1 });
  await h.sync.start();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.getState(), filled());
  assert.equal(h.seen.at(-1).conflict, true);
});

function requestClock(t) {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  const deadlines = new Map();
  let id = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 20000) return originalSet(callback, delay, ...args);
    const handle = 'synthetic-deadline-' + ++id;
    deadlines.set(handle, callback);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    if (typeof handle === 'string' && handle.startsWith('synthetic-deadline-'))
      deadlines.delete(handle);
    else originalClear(handle);
  };
  t.after(() => {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  });
  return {
    expire() {
      const callbacks = [...deadlines.values()];
      deadlines.clear();
      for (const callback of callbacks) callback();
    },
  };
}

test('token timeout releases busy state and late token cannot start a request', async (t) => {
  const h = harness(t, { raw: null }),
    clock = requestClock(t);
  let releaseToken;
  const methods = [];
  window.budgetAuth.getToken = () =>
    new Promise((resolve) => {
      releaseToken = resolve;
    });
  globalThis.fetch = async (_, { method }) => {
    methods.push(method);
    return Response.json({ state: empty(), revision: 1 });
  };
  const pending = h.sync.start();
  clock.expire();
  await pending;
  assert.match(h.notices.at(-1), /ใช้เวลานานเกินไป/);
  releaseToken('late-token');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(methods, []);
  window.budgetAuth.getToken = async () => 'fresh-token';
  await h.sync.retry();
  assert.deepEqual(methods, ['GET']);
});

test('body timeout is bounded even when a response never finishes parsing', async (t) => {
  const h = harness(t, { raw: null }),
    clock = requestClock(t);
  let reached;
  const bodyReached = new Promise((resolve) => {
    reached = resolve;
  });
  globalThis.fetch = async () => ({
    ok: true,
    json() {
      reached();
      return new Promise(() => {});
    },
  });
  const pending = h.sync.start();
  await bodyReached;
  clock.expire();
  await pending;
  assert.match(h.notices.at(-1), /ใช้เวลานานเกินไป/);
  assert.equal(h.writes.length, 0);
});

test('pause while acquiring an automatic PUT token prevents the late PUT', async (t) => {
  const h = harness(t, { initial: filled(), meta: { revision: 1, raw: JSON.stringify(empty()) } });
  let releaseToken,
    reached,
    tokens = 0;
  const methods = [];
  const tokenReached = new Promise((resolve) => {
    reached = resolve;
  });
  window.budgetAuth.getToken = async () => {
    if (++tokens === 1) return 'get-token';
    return new Promise((resolve) => {
      releaseToken = resolve;
      reached();
    });
  };
  globalThis.fetch = async (_, { method }) => {
    methods.push(method);
    return Response.json({ state: empty(), revision: 1 });
  };
  const pending = h.sync.start();
  await tokenReached;
  h.sync.pause('synthetic pause');
  releaseToken('late-put-token');
  await pending;
  assert.deepEqual(methods, ['GET']);
  assert.equal(h.seen.at(-1).conflict, true);
});

test('new pause while acquiring an explicit PUT token prevents the late PUT', async (t) => {
  const h = harness(t, { initial: filled() });
  let releaseToken,
    reached,
    tokens = 0;
  const methods = [];
  const tokenReached = new Promise((resolve) => {
    reached = resolve;
  });
  window.budgetAuth.getToken = async () => {
    if (++tokens === 1) return 'get-token';
    return new Promise((resolve) => {
      releaseToken = resolve;
      reached();
    });
  };
  globalThis.fetch = async (_, { method }) => {
    methods.push(method);
    return Response.json({ state: empty(), revision: 1 });
  };
  h.sync.pause();
  const pending = h.sync.useLocal();
  await tokenReached;
  h.sync.pause('synthetic second pause');
  releaseToken('late-put-token');
  await pending;
  assert.deepEqual(methods, ['GET']);
  assert.equal(h.seen.at(-1).conflict, true);
});

test('reload with erased ledger and retained sync metadata cannot upload an empty ledger', async (t) => {
  const h = harness(t, {
    initial: empty(),
    raw: null,
    meta: { revision: 1, raw: JSON.stringify(filled()) },
  });
  const methods = [];
  globalThis.fetch = async (_, { method }) => {
    methods.push(method);
    return Response.json({ state: filled(), revision: 1 });
  };
  await h.sync.start();
  assert.equal(methods.includes('PUT'), false);
  assert.equal(h.seen.at(-1).conflict, true);
  assert.equal(h.writes.length, 0);
  await h.sync.useCloud();
  assert.deepEqual(h.getState(), filled());
  assert.deepEqual(methods, ['GET']);
  assert.equal(h.seen.at(-1).conflict, false);
  assert.deepEqual(
    h.backups.map((item) => item.label),
    ['cloud-before-sync'],
  );
});

test('missing known ledger is paused in the constructor before a first local save', async (t) => {
  const h = harness(t, { raw: null, meta: { revision: 1, raw: JSON.stringify(filled()) } });
  const methods = [];
  globalThis.fetch = async (_, { method }) => {
    methods.push(method);
    return Response.json({ state: empty(), revision: 1 });
  };
  h.setLocal(filled());
  await h.sync.start();
  assert.deepEqual(methods, []);
  assert.equal(h.seen.at(-1).conflict, true);
});
