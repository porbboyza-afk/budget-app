import {
  localDate,
  validDate,
  parseMoney,
  validateState,
  totals,
  expenseCategories,
} from './model.js';
import {
  emptyState,
  previousMonth,
  selectLedgerRows,
  paginate,
  canUndoSave,
  undoSave,
} from './ledger-domain.js';
import { createLedgerRepository } from './ledger-repository.js';
import { escapeHTML as escape, money, thaiDate, monthName } from './ui-format.js';
import { createAIUI } from './ai-ui.js';
import './auth.js';
import { createCloudSync } from './cloud-sync.js';
import { showView, activeView } from './views.js';
import { createTripsUI } from './trips.js';
await window.budgetAuth.ready;
let owner = window.budgetAuth.getUser()?.uid || 'anonymous';
const repository = createLedgerRepository({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
let storageKey = repository.keyFor(owner),
  cloudSync = null;
const $ = (id) => document.getElementById(id);
let state,
  storageFault = false,
  editingId = null,
  editingOriginal = null,
  entryType = 'expense',
  deleted = null,
  toastTimer,
  lastStoredRaw = null;
const PAGE_SIZE = 10;
let currentPage = 1;
let shownSyncConflict = false;
let tripsUI = null,
  lastSave = null,
  legacyConflict = false;
function loadState() {
  lastStoredRaw = repository.readRaw(storageKey);
  const loaded = repository.load(storageKey, lastStoredRaw);
  state = loaded.state;
  legacyConflict = loaded.legacyConflict;
}
try {
  loadState();
} catch {
  state = emptyState();
  storageFault = true;
}
$('month').value = localDate().slice(0, 7);
function notify(text, undo = false) {
  clearTimeout(toastTimer);
  $('toast-text').textContent = text;
  $('undo').hidden = !deleted;
  $('toast').hidden = false;
  if (!deleted && !undo) toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
}
function commit(next) {
  if (storageFault) throw new Error('อ่านข้อมูลเดิมไม่สำเร็จ โปรดกู้คืนจากไฟล์สำรองก่อนบันทึก');
  if (legacyConflict)
    throw new Error(
      'พบแท็บรุ่นเก่า กรุณากู้คืนไฟล์สำรองหรือเลือกชุดข้อมูลในหน้า “ข้อมูล” ก่อนบันทึก',
    );
  const { state: checked, raw } = repository.write(storageKey, next, lastStoredRaw);
  lastStoredRaw = raw;
  state = checked;
  render();
  cloudSync?.changed();
}
function setType(type) {
  entryType = type;
  for (const t of ['income', 'expense']) {
    $('type-' + t).classList.toggle('selected', t === type);
    $('type-' + t).setAttribute('aria-pressed', String(t === type));
  }
  $('submit-entry').innerHTML =
    (editingId ? 'บันทึกการแก้ไข' : type === 'income' ? 'บันทึกรายรับ' : 'บันทึกรายจ่าย') +
    ' <span>↗</span>';
}
function resetForm() {
  editingId = null;
  editingOriginal = null;
  $('entry-form').reset();
  $('form-heading').textContent = 'เพิ่มรายการ';
  $('cancel-edit').hidden = true;
  $('form-error').textContent = '';
  $('date').value = localDate();
  $('entry-trip').value = tripsUI?.defaultTrip() || '';
  tripsUI?.hint();
  setType('expense');
}
function hasEntryDraft() {
  return Boolean(
    $('amount').value.trim() ||
      $('description').value.trim() ||
      $('category').value.trim() ||
      ($('date').value && $('date').value !== localDate()),
  );
}
function editEntry(id) {
  const row = state.entries.find((r) => r.id === id);
  if (!row) return;
  if (editingId === id) {
    showView('entry-panel');
    $('amount').focus({ preventScroll: true });
    return;
  }
  if (
    editingId !== id &&
    (editingId || hasEntryDraft()) &&
    !confirm('มีรายการที่ยังไม่ได้บันทึก ทิ้งข้อความที่กรอกไว้แล้วเปิดแก้ไขรายการนี้?')
  )
    return;
  editingId = row.id;
  editingOriginal = JSON.stringify(row);
  setType(row.type);
  $('form-heading').textContent = 'แก้ไขรายการ';
  $('amount').value = (row.amountCents / 100).toFixed(2);
  $('description').value = row.description;
  $('date').value = row.date;
  $('category').value = row.category;
  if (
    row.tripId &&
    !Array.from($('entry-trip').options).some((option) => option.value === row.tripId)
  )
    $('entry-trip').add(
      new Option(state.trips.find((t) => t.id === row.tripId)?.name || 'ทริป', row.tripId),
    );
  $('entry-trip').value = row.tripId;
  tripsUI?.hint();
  $('cancel-edit').hidden = false;
  $('form-error').textContent = '';
  showView('entry-panel');
  $('amount').focus({ preventScroll: true });
}
function renderLastSave() {
  $('last-saved').hidden = !lastSave;
  if (!lastSave) return;
  const valid = canUndoSave(state, lastSave);
  $('last-saved-text').textContent = lastSave.label + (valid ? '' : ' · รายการเปลี่ยนแล้ว');
  $('last-saved-undo').disabled = !valid;
  $('last-saved-edit').hidden = lastSave.rows.length !== 1;
  $('last-saved-edit').disabled = !valid;
}
function rememberSave(rows, label) {
  lastSave = { rows, label };
  renderLastSave();
}
function render() {
  const month = $('month').value,
    all = state.entries.filter((r) => r.date.startsWith(month + '-'));
  const sums = totals(state, month);
  for (const key of ['balance', 'income', 'expense'])
    $(key).innerHTML = '<span class="currency">฿</span>' + money(sums[key]);
  $('balance-caption').textContent = 'ยอดตั้งต้น + รายรับ − รายจ่าย ถึงสิ้น ' + monthName(month);
  $('income-count').textContent = all.filter((r) => r.type === 'income').length + ' รายการเงินเข้า';
  $('expense-count').textContent =
    all.filter((r) => r.type === 'expense').length + ' รายการเงินออก';
  $('period-label').textContent = monthName(month);
  $('demo-banner').hidden = !state.demo && !storageFault;
  if (!storageFault) {
    $('demo-banner').querySelector('strong').textContent = 'ลองดูภาพด้วยข้อมูลตัวอย่าง';
    $('demo-banner').querySelector('span').textContent = 'รายการเหล่านี้เป็นตัวอย่างสำหรับดราฟแรก';
  }
  if (storageFault) {
    $('demo-banner').querySelector('strong').textContent =
      'อ่านข้อมูลเดิมไม่ได้ — ยังไม่แสดงยอดจริง';
    $('demo-banner').querySelector('span').textContent = 'สำรองข้อมูลดิบไว้ก่อน หรือกู้คืนจากไฟล์';
    $('start-empty').hidden = true;
    for (const key of ['balance', 'income', 'expense']) $(key).textContent = '—';
  }
  $('save-status').textContent = storageFault
    ? '● อ่านข้อมูลเดิมไม่สำเร็จ'
    : '● ' + (state.demo ? 'ข้อมูลตัวอย่าง · ' : '') + 'บันทึกในเครื่องแล้ว';
  tripsUI?.render();
  renderLastSave();
  const categories = expenseCategories(all);
  $('category-overview').replaceChildren();
  if (storageFault) {
    $('expense-insight').textContent = 'กู้คืนข้อมูลก่อนดูสรุป';
    $('expense-compare-open').disabled = true;
  } else {
    tripsUI?.categories($('category-overview'), categories, sums.expense);
    $('expense-compare-open').disabled = false;
    const prior = state.entries.filter((row) => row.date.startsWith(previousMonth(month) + '-'));
    const priorExpense = prior
        .filter((row) => row.type === 'expense')
        .reduce((sum, row) => sum + row.amountCents, 0),
      difference = sums.expense - priorExpense;
    $('expense-insight').textContent = !prior.length
      ? 'ยังไม่มีรายการเดือนก่อนให้เทียบ'
      : difference === 0
        ? 'รายจ่ายที่จดเท่ากับเดือนก่อน'
        : `รายจ่ายที่จด${difference > 0 ? 'เพิ่ม' : 'ลด'}จากเดือนก่อน ฿${money(Math.abs(difference))}`;
  }
  const rows = selectLedgerRows(state, {
    month,
    search: $('search').value,
    type: $('filter-type').value,
    tripId: $('trip-filter').value,
  });
  const result = paginate(rows, currentPage, PAGE_SIZE);
  currentPage = result.page;
  const pageCount = result.count,
    offset = result.offset,
    pageRows = result.rows;
  $('pagination').hidden = !rows.length;
  $('page-range').textContent = rows.length
    ? `แสดง ${offset + 1}–${offset + pageRows.length} จาก ${rows.length} รายการ`
    : '';
  $('page-status').textContent = `หน้า ${currentPage} จาก ${pageCount}`;
  $('page-prev').disabled = currentPage === 1;
  $('page-next').disabled = currentPage === pageCount;
  $('entry-count').textContent = rows.length + ' รายการ';
  $('entries').innerHTML = rows.length
    ? pageRows
        .map(
          (r) =>
            `<article class="entry-row"><div class="entry-description"><span class="entry-symbol ${r.type === 'income' ? 'income' : 'expense'}">${r.type === 'income' ? '↙' : '↗'}</span><div><div class="entry-name">${escape(r.description)}</div><div class="entry-meta">${thaiDate(r.date)}${r.category ? ' · ' + escape(r.category) : ''}</div></div></div><div class="entry-amount ${r.type === 'income' ? 'income-text' : 'expense-text'}">${r.type === 'income' ? '+' : '−'}${money(r.amountCents)}</div><div class="entry-actions"><button data-action="edit" data-id="${escape(r.id)}" aria-label="แก้ไข ${escape(r.description)}">แก้ไข</button><button class="delete" data-action="delete" data-id="${escape(r.id)}" aria-label="ลบ ${escape(r.description)}">ลบ</button></div></article>`,
        )
        .join('')
    : `<div class="empty-state">${all.length ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีรายการในเดือนนี้'}<br><small>${all.length ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : 'เริ่มจดด้วยปุ่มรายรับหรือรายจ่ายได้เลย'}</small></div>`;
}
$('type-income').onclick = () => {
  setType('income');
  $('amount').focus({ preventScroll: true });
};
$('type-expense').onclick = () => {
  setType('expense');
  $('amount').focus({ preventScroll: true });
};
$('entry-form').onsubmit = (event) => {
  event.preventDefault();
  $('form-error').textContent = '';
  try {
    const amountCents = parseMoney($('amount').value),
      description =
        $('description').value.trim() || (entryType === 'income' ? 'รายรับ' : 'รายจ่าย'),
      date = $('date').value;
    if (!validDate(date)) throw new Error('เลือกวันที่ให้ถูกต้อง');
    const row = {
      id: editingId || crypto.randomUUID(),
      date,
      type: entryType,
      amountCents,
      description,
      category: $('category').value.trim(),
      tripId: $('entry-trip').value,
    };
    if (
      editingId &&
      JSON.stringify(state.entries.find((r) => r.id === editingId)) !== editingOriginal
    )
      throw new Error('รายการนี้เปลี่ยนจากแท็บอื่น โปรดยกเลิกแล้วเปิดแก้ไขใหม่');
    const entries = editingId
      ? state.entries.map((r) => (r.id === editingId ? row : r))
      : [...state.entries, row];
    const wasEditing = Boolean(editingId),
      before = editingId ? state.entries.find((r) => r.id === editingId) : null;
    commit({ ...state, entries });
    rememberSave(
      [{ after: row, before }],
      (wasEditing ? 'แก้ไข' : 'บันทึก') + ' ' + description + ' ฿' + money(amountCents),
    );
    currentPage = 1;
    $('month').value = date.slice(0, 7);
    $('search').value = '';
    $('filter-type').value = 'all';
    $('trip-filter').value = '';
    render();
    resetForm();
    notify(
      (wasEditing ? 'แก้ไข' : 'บันทึก') + ' ' + description + ' ' + money(amountCents) + ' บาทแล้ว',
    );
    $('amount').focus({ preventScroll: true });
  } catch (error) {
    $('form-error').textContent = error.message;
  }
};
$('cancel-edit').onclick = resetForm;
$('entries').onclick = (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = state.entries.find((r) => r.id === button.dataset.id);
  if (!row) return;
  if (button.dataset.action === 'edit') {
    editEntry(row.id);
  } else {
    try {
      commit({ ...state, entries: state.entries.filter((r) => r.id !== row.id) });
      deleted = row;
      if (editingId === row.id) resetForm();
      notify('ลบ “' + row.description + '” แล้ว', true);
    } catch (error) {
      notify(error.message);
    }
  }
};
$('undo').onclick = () => {
  if (!deleted) return;
  try {
    commit({ ...state, entries: [...state.entries, deleted] });
    deleted = null;
    notify('คืนรายการและบันทึกแล้ว');
  } catch (error) {
    notify(error.message, true);
  }
};
$('dismiss-toast').onclick = () => {
  $('toast').hidden = true;
};
$('last-saved-edit').onclick = () => {
  if (lastSave?.rows.length === 1) editEntry(lastSave.rows[0].after.id);
};
$('last-saved-undo').onclick = () => {
  try {
    const changes = new Map((lastSave?.rows || []).map((change) => [change.after.id, change]));
    commit(undoSave(state, lastSave));
    lastSave = null;
    renderLastSave();
    if (editingId && changes.has(editingId)) resetForm();
    notify('ย้อนกลับการบันทึกล่าสุดแล้ว');
  } catch (error) {
    notify(error.message);
  }
};
$('category-chips').onclick = (event) => {
  const button = event.target.closest('[data-category]');
  if (button) $('category').value = button.dataset.category;
};
function changeMonth(offset) {
  const [year, month] = $('month').value.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  if (date.getFullYear() < 1900 || date.getFullYear() > 2200) return;
  currentPage = 1;
  $('month').value = localDate(date).slice(0, 7);
  render();
}
$('prev-month').onclick = () => changeMonth(-1);
$('next-month').onclick = () => changeMonth(1);
$('month').min = '1900-01';
$('month').max = '2200-12';
$('month').onchange = () => {
  currentPage = 1;
  if (!/^\d{4}-\d{2}$/.test($('month').value) || !validDate($('month').value + '-01')) {
    $('month').value = localDate().slice(0, 7);
  }
  render();
};
function resetPage() {
  currentPage = 1;
  render();
}
$('search').oninput = resetPage;
$('filter-type').onchange = resetPage;
$('trip-filter').onchange = resetPage;
$('clear-filter').onclick = () => {
  $('search').value = '';
  $('filter-type').value = 'all';
  $('trip-filter').value = '';
  resetPage();
};
function turnPage(delta) {
  currentPage += delta;
  render();
  $('transactions').scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start',
  });
}
$('page-prev').onclick = () => turnPage(-1);
$('page-next').onclick = () => turnPage(1);
$('start-empty').onclick = () => {
  if (
    !confirm(
      'เริ่มจดใหม่โดยนำข้อมูลตัวอย่างทั้งหมดออก? หากเพิ่มรายการไว้ในชุดตัวอย่างแล้ว ให้สำรองข้อมูลก่อน',
    )
  )
    return;
  try {
    commit(emptyState());
    deleted = null;
    lastSave = null;
    tripsUI?.reset();
    resetForm();
    render();
    notify('พร้อมจดข้อมูลของคุณแล้ว');
  } catch (error) {
    notify(error.message);
  }
};
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('backup').onclick = () => {
  if (storageFault) {
    if (lastStoredRaw !== null)
      download(
        lastStoredRaw,
        'budget-unreadable-original-' + localDate() + '.json',
        'application/json',
      );
    else notify('ไม่สามารถอ่านข้อมูลเดิมเพื่อสำรองได้');
  } else
    download(
      JSON.stringify(state, null, 2),
      'budget-backup-' + localDate() + '.json',
      'application/json',
    );
};
function csvCell(value) {
  let s = String(value);
  if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
$('export-csv').onclick = () => {
  if (storageFault) {
    notify('อ่านข้อมูลเดิมไม่ได้ โปรดสำรองข้อมูลดิบหรือกู้คืนก่อน');
    return;
  }
  const rows = state.entries
    .filter((r) => r.date.startsWith($('month').value + '-'))
    .sort((a, b) => a.date.localeCompare(b.date));
  const text =
    '\ufeff' +
    [
      ['วันที่', 'ประเภท', 'รายละเอียด', 'หมวด', 'จำนวนเงิน (บาท)', 'ทริป'],
      ...rows.map((r) => [
        r.date,
        r.type === 'income' ? 'รายรับ' : 'รายจ่าย',
        r.description,
        r.category,
        (r.amountCents / 100).toFixed(2),
        state.trips.find((t) => t.id === r.tripId)?.name || '',
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
  download(text, 'budget-' + $('month').value + '.csv', 'text/csv;charset=utf-8');
  notify('ส่งออก CSV ของเดือนที่เลือกแล้ว');
};
$('restore').onclick = () => $('restore-file').click();
$('restore-file').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const restoreKey = storageKey,
    restoreRaw = lastStoredRaw;
  try {
    if (file.size > 20000000) throw new Error('ไฟล์ใหญ่เกินขนาดที่รองรับ');
    const next = validateState(JSON.parse(await file.text()));
    if (storageKey !== restoreKey || lastStoredRaw !== restoreRaw)
      throw new Error('บัญชีหรือข้อมูลเปลี่ยนระหว่างอ่านไฟล์ กรุณาเลือกไฟล์สำรองใหม่');
    if (
      !confirm(
        `กู้คืน ${next.entries.length} รายการ และ ${next.trips.length} ทริป แทนชุดปัจจุบัน (${state.entries.length} รายการ / ${state.trips.length} ทริป)? ควรสำรองชุดปัจจุบันก่อน`,
      )
    )
      return;
    const oldFault = storageFault,
      oldLegacy = legacyConflict;
    storageFault = false;
    legacyConflict = false;
    try {
      commit(next);
      currentPage = 1;
      render();
    } catch (error) {
      storageFault = oldFault;
      legacyConflict = oldLegacy;
      throw error;
    }
    deleted = null;
    lastSave = null;
    tripsUI?.reset();
    $('start-empty').hidden = false;
    resetForm();
    render();
    configureSync();
    notify('กู้คืนข้อมูลและบันทึกแล้ว');
  } catch (error) {
    notify(error instanceof SyntaxError ? 'ไฟล์ JSON อ่านไม่ได้' : error.message);
  } finally {
    event.target.value = '';
  }
};
$('summary-nav').onclick = () => {
  if (storageFault) {
    notify('อ่านข้อมูลเดิมไม่ได้ โปรดกู้คืนก่อนดูสรุป');
    return;
  }
  const month = $('month').value,
    sums = totals(state, month),
    categories = new Map();
  for (const row of state.entries.filter(
    (r) => r.date.startsWith(month + '-') && r.type === 'expense',
  )) {
    const key = row.category || 'ไม่ระบุหมวด';
    categories.set(key, (categories.get(key) || 0) + row.amountCents);
  }
  $('summary-period').textContent = monthName(month);
  $('summary-content').innerHTML =
    `<div class="summary-row"><span>รายรับ</span><strong>฿${money(sums.income)}</strong></div><div class="summary-row"><span>รายจ่าย</span><strong>฿${money(sums.expense)}</strong></div><div class="summary-row"><span>รับ − จ่าย เดือนนี้</span><strong>฿${money(sums.income - sums.expense)}</strong></div><p>รายจ่ายแยกหมวด</p>` +
    [...categories]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([key, cents]) =>
          `<div class="summary-row"><span>${escape(key)}</span><strong>฿${money(cents)}</strong></div>`,
      )
      .join('');
  $('summary-dialog').showModal();
};
$('close-summary').onclick = () => $('summary-dialog').close();
$('summary-done').onclick = () => {
  $('summary-dialog').close();
  showView('entry-panel', { focus: true });
};
tripsUI = createTripsUI({
  getState: () => state,
  commit,
  notify,
  money,
  thaiDate,
  editEntry,
  readPreference: (name) => repository.readPreference(storageKey, name),
  writePreference: (name, value) => repository.writePreference(storageKey, name, value),
  isEditing: () => Boolean(editingId),
  hasDraft: hasEntryDraft,
  prepareExpense: () => setType('expense'),
});
tripsUI.reset();
$('trips-new').disabled = false;
resetForm();
render();
$('entry-fields').disabled = false;
$('entry-loading').hidden = true;
if (activeView() === 'entry-panel' && matchMedia('(pointer: fine)').matches && !storageFault)
  $('amount').focus({ preventScroll: true });
if (storageFault) notify('อ่านข้อมูลเดิมไม่สำเร็จ ยังไม่ได้เขียนทับ โปรดกู้คืนจากไฟล์สำรอง');

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  if (event.newValue === null) {
    lastStoredRaw = null;
    cloudSync?.pause();
    notify('ข้อมูลในเครื่องถูกล้าง ระบบพักซิงค์ไว้ กรุณาเลือกกู้คืนจากคลาวด์หรือโหลดหน้าใหม่');
    return;
  }
  try {
    const input = JSON.parse(event.newValue);
    if (input.version === 1 && state.trips.length) {
      const recovery = JSON.stringify(state);
      try {
        repository.saveRecovery(storageKey, state);
      } catch {}
      download(recovery, 'jodngern-trips-recovery-' + localDate() + '.json', 'application/json');
      lastStoredRaw = event.newValue;
      legacyConflict = true;
      cloudSync?.pause('พบแท็บรุ่นเก่า · เลือกชุดข้อมูลเพื่อรักษาทริป');
      notify(
        'พบแท็บแอปรุ่นเก่า พักซิงค์และสำรองชุดที่มีทริปแล้ว กรุณาปิดแท็บเก่าและกู้คืนไฟล์สำรอง หรือเลือกชุดข้อมูลในหน้า “ข้อมูล”',
      );
      return;
    }
    const wasLegacy = legacyConflict,
      next = validateState(input);
    state = next;
    lastStoredRaw = event.newValue;
    storageFault = false;
    legacyConflict = false;
    $('start-empty').hidden = false;
    render();
    if (wasLegacy) configureSync();
    else cloudSync?.changed();
    notify('อัปเดตข้อมูลจากแท็บอื่นแล้ว');
  } catch {
    storageFault = true;
    lastStoredRaw = event.newValue;
    render();
    notify('ข้อมูลจากแท็บอื่นอ่านไม่ได้ กรุณากู้คืนจากไฟล์');
  }
});

const aiUI = createAIUI({
  getState: () => state,
  getRaw: () => lastStoredRaw,
  hasStorageFault: () => storageFault,
  commit,
  rememberSave,
  notify,
  afterSave(rows) {
    currentPage = 1;
    $('month').value = rows[0].date.slice(0, 7);
    $('search').value = '';
    $('filter-type').value = 'all';
    $('trip-filter').value = '';
    render();
  },
});

function configureSync() {
  cloudSync?.dispose();
  cloudSync = null;
  shownSyncConflict = false;
  $('data-nav-link').classList.remove('sync-warning');
  $('data-nav-link').setAttribute('aria-label', 'ข้อมูล');
  $('sync-conflict').hidden = true;
  if (owner === 'anonymous') {
    $('sync-status').textContent = 'บันทึกในเครื่อง · เข้าสู่ระบบเพื่อซิงค์';
    $('sync-retry').hidden = true;
    return;
  }
  $('sync-retry').hidden = false;
  cloudSync = createCloudSync({
    key: storageKey,
    getRaw: () => lastStoredRaw,
    getState: () => {
      if (storageFault) throw new Error('อ่านข้อมูลในเครื่องไม่ได้');
      return state;
    },
    applyState: (next) => {
      if (storageFault) throw new Error('อ่านข้อมูลในเครื่องไม่ได้ โปรดสำรองและกู้คืนก่อน');
      const { state: checked, raw } = repository.write(storageKey, next, lastStoredRaw);
      lastStoredRaw = raw;
      state = checked;
      legacyConflict = false;
      deleted = null;
      aiUI.reset();
      render();
    },
    status: (text, conflict) => {
      $('sync-status').textContent = text;
      $('sync-conflict').hidden = !conflict;
      $('data-nav-link').classList.toggle('sync-warning', conflict);
      $('data-nav-link').setAttribute(
        'aria-label',
        conflict ? 'ข้อมูล · ต้องเลือกชุดข้อมูลสำหรับซิงค์' : 'ข้อมูล',
      );
      if (conflict && !shownSyncConflict)
        notify('ซิงค์ต้องการให้เลือกชุดข้อมูล กรุณาเปิดหน้า “ข้อมูล”');
      shownSyncConflict = conflict;
    },
    notify,
    backup: (data, label) =>
      download(
        JSON.stringify(data, null, 2),
        'budget-' + label + '-' + localDate() + '.json',
        'application/json',
      ),
  });
  if (legacyConflict) cloudSync.pause('พบแท็บรุ่นเก่า · เลือกชุดข้อมูลเพื่อรักษาทริป');
  else if (!storageFault) cloudSync.start();
}
$('sync-retry').onclick = () => cloudSync?.retry();
$('sync-use-cloud').onclick = () => cloudSync?.useCloud();
$('sync-use-local').onclick = () => cloudSync?.useLocal();
window.addEventListener('budget-auth-changed', () => {
  const nextOwner = window.budgetAuth.getUser()?.uid || 'anonymous';
  if (nextOwner === owner) return;
  cloudSync?.dispose();
  cloudSync = null;
  owner = nextOwner;
  storageKey = repository.keyFor(owner);
  currentPage = 1;
  deleted = null;
  lastSave = null;
  storageFault = false;
  legacyConflict = false;
  editingId = null;
  editingOriginal = null;
  lastStoredRaw = null;
  try {
    loadState();
  } catch {
    state = emptyState();
    storageFault = true;
  }
  aiUI.reset();
  tripsUI.reset();
  resetForm();
  render();
  configureSync();
  notify('เปลี่ยนบัญชีแล้ว · แสดงเฉพาะข้อมูลของบัญชีนี้');
});
configureSync();
