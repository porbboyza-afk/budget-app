import { validateState } from './model.js';
export function createCloudSync({
  key,
  getRaw,
  getState,
  getLocalBackup = () => ({ state: getState(), raw: getRaw() }),
  applyState,
  status,
  backup,
  backupRaw,
  notify,
}) {
  let active = true,
    busy = false,
    conflict = false,
    timer,
    revision = 0,
    syncedRaw = null,
    known = false;
  let pauseEpoch = 0;
  try {
    const meta = JSON.parse(localStorage.getItem(key + ':sync') || 'null');
    if (
      meta &&
      Number.isSafeInteger(meta.revision) &&
      meta.revision >= 0 &&
      (meta.revision === 0 ? meta.raw === null : typeof meta.raw === 'string')
    ) {
      if (meta.raw !== null) validateState(JSON.parse(meta.raw));
      revision = meta.revision;
      syncedRaw = meta.raw;
      known = true;
    }
  } catch {}
  let missingKnownLocal = known && syncedRaw !== null && getRaw() === null;
  if (missingKnownLocal) conflict = true;
  const dirty = () => getRaw() !== syncedRaw;
  function show(text) {
    if (active) status(text, conflict);
  }
  function record(raw) {
    localStorage.setItem(key + ':sync', JSON.stringify({ revision, raw }));
    syncedRaw = raw;
    known = true;
    missingKnownLocal = false;
  }
  async function request(method, payload, allowPaused = false) {
    const controller = new AbortController(),
      requestEpoch = pauseEpoch;
    let deadline;
    function assertActive() {
      if (!active) throw new Error('บัญชีเปลี่ยนแล้ว');
      if (controller.signal.aborted) throw new Error('ซิงค์ใช้เวลานานเกินไป กรุณาลองใหม่');
      if (pauseEpoch !== requestEpoch || (conflict && !allowPaused)) throw new Error('พักซิงค์ไว้');
    }
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        reject(new Error('ซิงค์ใช้เวลานานเกินไป กรุณาลองใหม่'));
        controller.abort();
      }, 20000);
    });
    const operation = (async () => {
      const token = await window.budgetAuth.getToken();
      assertActive();
      const response = await fetch('/api/ledger', {
        method,
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + token,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
      });
      assertActive();
      const data = await response.json();
      assertActive();
      if (!response.ok) {
        const error = new Error(data.error || 'ซิงค์ไม่สำเร็จ');
        error.status = response.status;
        throw error;
      }
      if (!Number.isSafeInteger(data.revision) || data.revision < 0)
        throw new Error('ข้อมูลคลาวด์ไม่ถูกต้อง');
      return data;
    })();
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(deadline);
    }
  }
  async function sync() {
    if (active && missingKnownLocal && conflict) {
      show('ข้อมูลในเครื่องหายไป · เลือกชุดคลาวด์เพื่อกู้คืน');
      return;
    }
    if (!active || busy || conflict) return;
    busy = true;
    show('กำลังซิงค์');
    try {
      const remote = await request('GET');
      if (!active || conflict) return;
      const remoteState = remote.state === null ? null : validateState(remote.state);
      if (
        remoteState &&
        getRaw() !== null &&
        JSON.stringify(validateState(getState())) === JSON.stringify(remoteState)
      ) {
        revision = remote.revision;
        record(getRaw());
      }
      if (!known) {
        if (remoteState && getRaw() !== null) {
          conflict = true;
          show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');
          return;
        }
        revision = remote.revision;
        if (remoteState) {
          applyState(remoteState);
          record(getRaw());
        } else {
          known = true;
          record(null);
        }
      } else if (remote.revision !== revision) {
        if (remote.revision < revision || dirty()) {
          conflict = true;
          show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');
          return;
        }
        if (remoteState) {
          applyState(remoteState);
          revision = remote.revision;
          record(getRaw());
        } else throw new Error('ข้อมูลคลาวด์หายไป กรุณาตรวจสอบก่อนซิงค์');
      }
      if (dirty()) {
        const raw = getRaw(),
          result = await request('PUT', { state: getState(), revision });
        if (!active || conflict) return;
        revision = result.revision;
        record(raw);
      }
      show(dirty() ? 'บันทึกในเครื่อง · รอซิงค์' : 'ซิงค์แล้ว');
      if (dirty()) timer = setTimeout(sync, 300);
    } catch (error) {
      if (!active || conflict) return;
      if (error.status === 409) {
        conflict = true;
        show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');
      } else {
        show('บันทึกในเครื่อง · ซิงค์ไม่สำเร็จ');
        notify(error.message);
      }
    } finally {
      busy = false;
    }
  }
  async function resolve(useLocal) {
    if (!active || busy) return;
    busy = true;
    show('กำลังตรวจข้อมูล');
    try {
      const remote = await request('GET', undefined, true);
      if (!active) return;
      const localRaw = getRaw(),
        cloud = remote.state === null ? null : validateState(remote.state);
      const resolvingEpoch = pauseEpoch;
      const localBackup = getLocalBackup();
      if (useLocal && !localBackup.state)
        throw new Error('อ่านข้อมูลในเครื่องไม่ได้ กรุณาเลือกชุดคลาวด์หรือกู้คืนไฟล์สำรอง');
      if (!useLocal && !cloud) throw new Error('คลาวด์ยังไม่มีรายการให้กู้คืน');
      if (
        !confirm(
          useLocal
            ? localBackup.raw === null
              ? 'ใช้ชุดในเครื่องแทนคลาวด์? ยังไม่มีข้อมูลบันทึกในเครื่อง จะสำรองชุดคลาวด์ก่อน'
              : 'ใช้ข้อมูลในเครื่องแทนคลาวด์? จะดาวน์โหลดสำรองทั้งสองชุดก่อน'
            : localBackup.raw !== null
              ? 'ใช้ข้อมูลคลาวด์แทนในเครื่อง? จะสำรองข้อมูลเดิมและชุดคลาวด์ก่อน'
              : 'ใช้ข้อมูลคลาวด์กู้คืนในเครื่อง? ข้อมูลเดิมในเครื่องถูกล้างแล้ว จะสำรองชุดคลาวด์ก่อน',
        )
      )
        return;
      if (localRaw !== getRaw()) throw new Error('ข้อมูลในเครื่องเปลี่ยน กรุณาลองใหม่');
      if (localBackup.state && localBackup.raw !== null)
        backup(localBackup.state, 'local-before-sync');
      else if (localBackup.raw !== null) {
        if (!backupRaw) throw new Error('ยังสำรองข้อมูลดิบไม่ได้ จึงยังไม่แทนที่ข้อมูล');
        backupRaw(localBackup.raw, 'local-unreadable-before-sync');
      }
      if (cloud) backup(cloud, 'cloud-before-sync');
      if (useLocal) {
        const selected = getState();
        applyState(selected);
        const sentRaw = getRaw();
        const result = await request('PUT', { state: selected, revision: remote.revision }, true);
        if (!active || pauseEpoch !== resolvingEpoch) return;
        revision = result.revision;
        record(sentRaw);
      } else {
        if (!cloud) throw new Error('คลาวด์ยังไม่มีรายการให้กู้คืน');
        applyState(cloud, { recovery: true });
        revision = remote.revision;
        record(getRaw());
      }
      conflict = false;
      missingKnownLocal = false;
      show(dirty() ? 'บันทึกในเครื่อง · รอซิงค์' : 'ซิงค์แล้ว');
      notify('เลือกชุดข้อมูลแล้ว');
      if (dirty()) timer = setTimeout(sync, 300);
    } catch (error) {
      if (active) {
        conflict = true;
        show('ข้อมูลขัดแย้ง · ยังไม่เขียนทับ');
        notify(error.message);
      }
    } finally {
      busy = false;
      if (active && conflict) show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');
    }
  }
  const online = () => sync();
  window.addEventListener('online', online);
  const visibility = () => {
    if (document.visibilityState === 'visible') sync();
  };
  document.addEventListener('visibilitychange', visibility);
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') sync();
  }, 30000);
  return {
    start: sync,
    pause(message = 'ข้อมูลในเครื่องถูกล้าง · เลือกชุดข้อมูลเพื่อกู้คืน') {
      pauseEpoch++;
      conflict = true;
      clearTimeout(timer);
      show(message);
    },
    changed() {
      show(conflict ? 'ข้อมูลขัดแย้ง · เลือกชุดข้อมูล' : 'บันทึกในเครื่อง · รอซิงค์');
      clearTimeout(timer);
      timer = setTimeout(sync, 500);
    },
    retry: sync,
    useCloud: () => resolve(false),
    useLocal: () => resolve(true),
    dispose() {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
