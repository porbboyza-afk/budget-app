// Inject a synchronous key/value adapter. The browser passes localStorage.
import { STORAGE_KEY, validateState } from './model.js';
import { emptyState } from './ledger-domain.js';

export function createLedgerRepository(storage) {
  const keyFor = (owner) => STORAGE_KEY + ':owner:' + encodeURIComponent(owner);
  function assertCurrent(key, expectedRaw) {
    if (storage.getItem(key) !== expectedRaw)
      throw new Error('ข้อมูลเปลี่ยนจากแท็บอื่น กรุณาโหลดหน้าใหม่ก่อนบันทึก');
  }
  function load(key, raw = storage.getItem(key)) {
    const input = raw === null ? null : JSON.parse(raw);
    let state = raw === null ? emptyState() : validateState(input);
    const recovery = input?.version === 1 ? storage.getItem(key + ':trip-recovery') : null;
    if (recovery) state = validateState(JSON.parse(recovery));
    return { raw, state, legacyConflict: Boolean(recovery) };
  }
  function write(key, next, expectedRaw, { backupLegacy = true } = {}) {
    assertCurrent(key, expectedRaw);
    const state = validateState(next),
      raw = JSON.stringify(state);
    let priorVersion;
    try {
      priorVersion = expectedRaw ? JSON.parse(expectedRaw)?.version : undefined;
    } catch {}
    try {
      if (backupLegacy && expectedRaw) {
        const suffix =
          priorVersion === 1
            ? ':before-version2'
            : ![1, 2].includes(priorVersion)
              ? ':before-repair'
              : null;
        if (suffix && !storage.getItem(key + suffix)) storage.setItem(key + suffix, expectedRaw);
      }
      storage.setItem(key, raw);
    } catch {
      throw new Error('บันทึกไม่สำเร็จ พื้นที่อาจเต็มหรือเบราว์เซอร์ปิดการเก็บข้อมูล');
    }
    return { raw, state };
  }
  return {
    keyFor,
    load,
    write,
    assertCurrent,
    readRaw: (key) => storage.getItem(key),
    readPreference: (key, name) => storage.getItem(key + ':' + name),
    writePreference: (key, name, value) => storage.setItem(key + ':' + name, value),
    saveRecovery(key, state) {
      const raw = JSON.stringify(validateState(state));
      storage.setItem(key + ':trip-recovery', raw);
      return raw;
    },
  };
}
