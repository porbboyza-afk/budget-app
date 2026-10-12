// Platform-independent ledger operations. No DOM, storage, network, or auth.
import { localDate, validDate, parseMoney, totals } from './model.js';

export const emptyState = () => ({
  version: 2,
  openingCents: 0,
  demo: false,
  entries: [],
  trips: [],
});
export function previousMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return localDate(new Date(year, number - 2, 1)).slice(0, 7);
}
export function selectMonth(state, month) {
  return state.entries.filter((row) => row.date.startsWith(month + '-'));
}
export function selectLedgerRows(state, { month, type = 'all', tripId = '', search = '' }) {
  const names = new Map(state.trips.map((trip) => [trip.id, trip.name]));
  const query = search.trim().toLocaleLowerCase();
  return [...selectMonth(state, month)]
    .reverse()
    .filter(
      (row) =>
        (type === 'all' || row.type === type) &&
        (!tripId || row.tripId === tripId) &&
        `${row.description} ${row.category} ${names.get(row.tripId) || ''}`
          .toLocaleLowerCase()
          .includes(query),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function paginate(rows, page, size = 10) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('ขนาดหน้าไม่ถูกต้อง');
  const count = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.max(1, Math.min(Number.isSafeInteger(page) ? page : 1, count));
  const offset = (current - 1) * size;
  return { page: current, count, offset, rows: rows.slice(offset, offset + size) };
}
export function buildAIContext(state, month) {
  const fields = ({ date, type, amountCents, description, category }) => ({
    date,
    type,
    amountCents,
    description,
    category,
  });
  const entries = selectMonth(state, month).map(fields),
    priorMonth = previousMonth(month),
    previousEntries = selectMonth(state, priorMonth).map(fields);
  if (entries.length + previousEntries.length > 500)
    throw new Error(
      'สองเดือนนี้รวมเกิน 500 รายการ จึงยังส่งให้ AI วิเคราะห์ไม่ได้ ดูสรุปหมวดในแอปได้โดยไม่ใช้ AI',
    );
  const sums = totals(state, month);
  return {
    month,
    entries,
    previous: validDate(priorMonth + '-01')
      ? { month: priorMonth, entries: previousEntries }
      : null,
    totals: { income: sums.income, expense: sums.expense, net: sums.income - sums.expense },
  };
}
export function validateAICandidates(response) {
  if (
    !Array.isArray(response?.entries) ||
    response.entries.length > 50 ||
    !Array.isArray(response.warnings) ||
    response.warnings.length > 30
  )
    throw new Error('รูปแบบรายการจาก AI ไม่ถูกต้อง กรุณาลองใหม่');
  const entries = response.entries.map((row) => {
    if (
      !row ||
      !['income', 'expense'].includes(row.type) ||
      typeof row.amount !== 'string' ||
      !validDate(row.date) ||
      typeof row.description !== 'string' ||
      !row.description.trim() ||
      row.description.length > 160 ||
      typeof row.category !== 'string' ||
      row.category.length > 60
    )
      throw new Error('AI อ่านบางช่องไม่ครบหรือไม่ถูกต้อง กรุณาเพิ่มรายละเอียดแล้วลองใหม่');
    parseMoney(row.amount);
    return { ...row, description: row.description.trim(), category: row.category.trim() };
  });
  if (response.warnings.some((text) => typeof text !== 'string' || text.length > 1000))
    throw new Error('คำเตือนจาก AI อ่านไม่ได้');
  return { entries, warnings: response.warnings };
}
export function canUndoSave(state, save) {
  return Boolean(
    save &&
      save.rows.every(
        ({ after }) =>
          JSON.stringify(state.entries.find((row) => row.id === after.id)) ===
          JSON.stringify(after),
      ),
  );
}
export function undoSave(state, save) {
  if (!canUndoSave(state, save)) throw new Error('รายการเปลี่ยนแล้ว กรุณาตรวจรายการก่อนแก้ไข');
  const changes = new Map(save.rows.map((change) => [change.after.id, change]));
  return {
    ...state,
    entries: state.entries.flatMap((row) => {
      const change = changes.get(row.id);
      return change ? (change.before ? [change.before] : []) : [row];
    }),
  };
}
