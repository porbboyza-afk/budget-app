import test from 'node:test';
import assert from 'node:assert/strict';
import { validateState, parseMoney, tripTotals, totals } from '../model.js';
import {
  emptyState,
  previousMonth,
  selectLedgerRows,
  paginate,
  buildAIContext,
  validateAICandidates,
  canUndoSave,
  undoSave,
} from '../ledger-domain.js';
import { createLedgerRepository } from '../ledger-repository.js';
import { readFile } from 'node:fs/promises';
import { ASSETS } from '../scripts/assets.mjs';

const trip = {
  id: 'trip-1',
  name: 'ทริปจำลอง',
  startDate: '2026-10-01',
  endDate: '2026-10-03',
  budgetCents: 100000,
  archived: false,
};
const row = (id, date, amountCents = 10000) => ({
  id,
  date,
  amountCents,
  type: 'expense',
  description: 'รายการจำลอง',
  category: 'อาหาร',
  tripId: trip.id,
});
const state = () => ({
  ...emptyState(),
  trips: [{ ...trip }],
  entries: [row('a', '2026-09-28'), row('b', '2026-10-02', 20000)],
});
const memoryStorage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('money uses exact cents and rejects malformed input', () => {
  assert.equal(parseMoney('10.01'), 1001);
  for (const value of ['-1', '1e2', '0', '1.001', 'NaN']) assert.throws(() => parseMoney(value));
});
test('legacy schema migrates without mutation and defaults trip links', () => {
  const original = {
    version: 1,
    openingCents: 0,
    demo: false,
    entries: [{ ...row('a', '2026-10-01'), tripId: undefined }],
  };
  const next = validateState(original);
  assert.equal(original.version, 1);
  assert.equal(next.version, 2);
  assert.deepEqual(next.trips, []);
  assert.equal(next.entries[0].tripId, '');
});
test('invalid trip references and duplicate IDs are rejected', () => {
  const value = state();
  value.entries[0].tripId = 'missing';
  assert.throws(() => validateState(value));
  const duplicate = state();
  duplicate.trips.push({ ...trip });
  assert.throws(() => validateState(duplicate));
});
test('trip expenses span months and monthly totals count each row once', () => {
  const value = validateState(state());
  assert.equal(tripTotals(value, trip.id).expense, 30000);
  assert.equal(totals(value, '2026-10').expense, 20000);
  assert.equal(totals(value, '2026-10').balance, -30000);
});
test('trip income does not subtract from spending', () => {
  const value = state();
  value.entries.push({ ...row('c', '2026-10-02'), type: 'income' });
  assert.equal(tripTotals(value, trip.id).expense, 30000);
});
test('query filters before paging, searches trip name and preserves input', () => {
  const value = state();
  const before = JSON.stringify(value);
  assert.equal(selectLedgerRows(value, { month: '2026-10', search: 'ทริปจำลอง' }).length, 1);
  assert.equal(selectLedgerRows(value, { month: '2026-10', type: 'income' }).length, 0);
  assert.equal(JSON.stringify(value), before);
});
test('pagination clamps after deletions and empty results', () => {
  const items = Array.from({ length: 11 }, (_, id) => id);
  assert.deepEqual(paginate(items, 2).rows, [10]);
  assert.equal(paginate(items.slice(0, 10), 2).page, 1);
  assert.deepEqual(paginate([], 99).rows, []);
  assert.throws(() => paginate(items, 1, 0));
});
test('AI context includes prior month but omits IDs and trip identifiers', () => {
  assert.equal(previousMonth('2026-01'), '2025-12');
  const context = buildAIContext(state(), '2026-10');
  assert.equal(context.previous.entries.length, 1);
  assert.equal(context.totals.expense, 20000);
  assert.equal('id' in context.entries[0], false);
  assert.equal('tripId' in context.entries[0], false);
  assert.equal(buildAIContext(emptyState(), '1900-01').previous, null);
});
test('AI context enforces combined 500-row limit', () => {
  const value = state();
  value.entries = Array.from({ length: 501 }, (_, id) =>
    row(String(id), id % 2 ? '2026-09-01' : '2026-10-01'),
  );
  assert.throws(() => buildAIContext(value, '2026-10'));
});
test('AI proposals reject null and unsafe amount, trim valid fields', () => {
  assert.throws(() => validateAICandidates(null));
  assert.throws(() =>
    validateAICandidates({
      entries: [
        { type: 'expense', amount: '1e2', date: '2026-10-01', description: 'x', category: '' },
      ],
      warnings: [],
    }),
  );
  assert.equal(
    validateAICandidates({
      entries: [
        { type: 'expense', amount: '1.20', date: '2026-10-01', description: ' x ', category: ' ' },
      ],
      warnings: [],
    }).entries[0].description,
    'x',
  );
});
test('undo add/edit preserves unrelated rows and rejects changed records', () => {
  const value = state(),
    save = { rows: [{ after: value.entries[1], before: null }] };
  assert.equal(canUndoSave(value, save), true);
  assert.equal(undoSave(value, save).entries.length, 1);
  const changed = structuredClone(value);
  changed.entries[1].amountCents++;
  assert.equal(canUndoSave(changed, save), false);
  assert.throws(() => undoSave(changed, save));
  const before = { ...value.entries[1], amountCents: 500 };
  assert.equal(
    undoSave(value, { rows: [{ after: value.entries[1], before }] }).entries[1].amountCents,
    500,
  );
});
test('repository isolates owner keys and rejects stale writes', () => {
  const storage = memoryStorage(),
    repo = createLedgerRepository(storage),
    key = repo.keyFor('owner-a');
  assert.notEqual(key, repo.keyFor('owner-b'));
  const saved = repo.write(key, state(), null);
  assert.equal(repo.load(key).state.trips.length, 1);
  assert.throws(() => repo.write(key, emptyState(), null));
  assert.equal(repo.readRaw(key), saved.raw);
});
test('AI batch undo compares entry values independently of object property order', () => {
  const after = {
    id: 'ai-order',
    type: 'expense',
    date: '2026-10-01',
    amountCents: 1234,
    description: 'Synthetic AI entry',
    category: 'Food',
    tripId: '',
  };
  const checked = validateState({ ...emptyState(), entries: [after] });
  assert.notEqual(JSON.stringify(checked.entries[0]), JSON.stringify(after));
  const save = { rows: [{ after, before: null }] };
  assert.equal(canUndoSave(checked, save), true);
  assert.deepEqual(undoSave(checked, save).entries, []);
});
test('repository preserves legacy backup and uses recovery without rewriting raw', () => {
  const storage = memoryStorage(),
    repo = createLedgerRepository(storage),
    key = repo.keyFor('owner');
  const legacy = JSON.stringify({ version: 1, openingCents: 0, demo: false, entries: [] });
  storage.setItem(key, legacy);
  const loaded = repo.load(key);
  assert.equal(loaded.state.version, 2);
  assert.equal(storage.getItem(key), legacy);
  repo.write(key, state(), legacy);
  assert.equal(storage.getItem(key + ':before-version2'), legacy);
  storage.setItem(key, legacy);
  repo.saveRecovery(key, state());
  const recovered = repo.load(key);
  assert.equal(recovered.legacyConflict, true);
  assert.equal(recovered.state.trips.length, 1);
  assert.equal(recovered.raw, legacy);
});
test('repository adapter failure cannot change the supplied state', () => {
  const value = state(),
    repo = createLedgerRepository({
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
    });
  assert.throws(() => repo.write('key', value, null), /บันทึกไม่สำเร็จ/);
  assert.equal(value.entries.length, 2);
});

test('valid restore preserves malformed JSON and invalid legacy/current schemas', () => {
  for (const damaged of [
    '{broken',
    'null',
    JSON.stringify({ ...state(), entries: [{ ...row('broken', '2026-10-01'), amountCents: -1 }] }),
    JSON.stringify({ version: 1, openingCents: 0, entries: null }),
  ]) {
    const storage = memoryStorage(),
      repo = createLedgerRepository(storage),
      key = repo.keyFor('owner');
    storage.setItem(key, damaged);
    assert.throws(() => repo.load(key));
    const saved = repo.write(key, state(), damaged);
    assert.equal(saved.state.trips.length, 1);
    assert.equal(storage.getItem(key + ':before-repair'), damaged);
  }
});

test('all browser module dependencies are public-build allowlisted and precached', async () => {
  const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  for (const name of ASSETS.filter((name) => name.endsWith('.js'))) {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+)['"]/g)) {
      assert.ok(ASSETS.includes(match[1]), name + ' dependency missing from build: ' + match[1]);
      assert.ok(worker.includes("'/" + match[1] + "'"), match[1] + ' missing from offline shell');
    }
  }
  for (const forbidden of [
    '.env.local',
    'AGENTS.md',
    'ARCHITECTURE.md',
    'tests/ledger.test.js',
    'server/ai.js',
    'server/auth-token.js',
    'test-fixtures/firebase-auth.js',
    'package-lock.json',
  ])
    assert.equal(ASSETS.includes(forbidden), false);
});
