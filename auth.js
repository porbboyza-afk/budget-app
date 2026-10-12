let auth,
  sdk,
  local = false,
  offlineUser = null;
const OWNER_KEY = 'budget-last-owner-v1';
const accountDialog = document.getElementById('account-dialog');
document.getElementById('account-close').onclick = () => accountDialog.close();
function accountStatus(message, notice = false) {
  const status = document.getElementById('ai-account-status');
  if (status) {
    status.textContent = message;
    status.classList.toggle('sr-only', !notice);
  }
}
function accountButton(button, user) {
  if (!button) return;
  button.replaceChildren();
  button.classList.toggle('signed-in', Boolean(user));
  if (!user) {
    button.textContent = 'เข้าสู่ระบบ';
    button.setAttribute('aria-label', 'เข้าสู่ระบบด้วย Google');
    button.removeAttribute('title');
    return;
  }
  const label = user.displayName || 'Google';
  button.setAttribute('aria-label', 'เปิดบัญชี ' + label + ' · เข้าสู่ระบบแล้ว');
  button.title = 'บัญชี · เข้าสู่ระบบแล้ว';
  const avatar = document.createElement('span');
  avatar.className = 'account-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  const fallback = document.createElement('span');
  fallback.className = 'avatar-initial';
  fallback.textContent = Array.from(user.displayName || user.email || 'G')[0].toLocaleUpperCase();
  avatar.append(fallback);
  try {
    const photo = new URL(user.photoURL);
    if (photo.protocol === 'https:' && /^lh\d+\.googleusercontent\.com$/.test(photo.hostname)) {
      const image = document.createElement('img');
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.hidden = true;
      image.onload = () => {
        fallback.hidden = true;
        image.hidden = false;
      };
      image.onerror = () => image.remove();
      image.src = photo.href;
      avatar.append(image);
    }
  } catch {}
  const dot = document.createElement('span');
  dot.className = 'account-dot';
  dot.setAttribute('aria-hidden', 'true');
  avatar.append(dot);
  button.append(avatar);
}
function getUser() {
  return local
    ? { uid: 'local-owner', email: '' }
    : auth?.currentUser
      ? { uid: auth.currentUser.uid, email: auth.currentUser.email || '' }
      : offlineUser;
}
function offline(button, status) {
  try {
    const uid = localStorage.getItem(OWNER_KEY);
    if (uid && /^[A-Za-z0-9_-]{1,128}$/.test(uid)) offlineUser = { uid, email: '', offline: true };
  } catch {}
  accountStatus(
    navigator.onLine
      ? 'เชื่อมต่อบัญชีไม่สำเร็จ · ตรวจอินเทอร์เน็ตแล้วลองเชื่อมต่ออีกครั้ง'
      : offlineUser
        ? 'ออฟไลน์ · ใช้ข้อมูลบัญชีล่าสุดในเครื่อง · เชื่อมต่อก่อนซิงค์หรือใช้ AI'
        : 'ออฟไลน์ · จดข้อมูลในเครื่องได้',
    true,
  );
  if (button) {
    accountButton(button, null);
    button.textContent = 'ลองเชื่อมต่ออีกครั้ง';
    button.setAttribute('aria-label', 'ลองเชื่อมต่อบัญชีอีกครั้ง');
    button.disabled = false;
    button.onclick = () => location.reload();
  }
  announce();
}
function announce() {
  window.dispatchEvent(new CustomEvent('budget-auth-changed', { detail: getUser() }));
}
function bounded(promise, ms = 12000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Auth timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
function loginError(error) {
  switch (error?.code) {
    case 'auth/popup-blocked':
      return 'เบราว์เซอร์บล็อกหน้าล็อกอิน · อนุญาตป๊อปอัปสำหรับเว็บนี้แล้วกดเข้าสู่ระบบอีกครั้ง หากเปิดจาก LINE / Facebook ให้เปิดลิงก์ใน Brave, Chrome หรือ Safari';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'ยังไม่ได้เข้าสู่ระบบ · กดเข้าสู่ระบบ Google เพื่อเริ่มอีกครั้ง';
    case 'auth/network-request-failed':
      return 'เชื่อมต่อ Google ไม่สำเร็จ · ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
    case 'auth/unauthorized-domain':
      return 'โดเมนนี้ยังไม่ได้รับอนุญาตให้เข้าสู่ระบบ · เปิดผ่าน budget-app-porbboyza.pages.dev';
    case 'auth/web-storage-unsupported':
      return 'เบราว์เซอร์ไม่อนุญาตให้เก็บสถานะบัญชี · เปิดในโหมดปกติและอนุญาตข้อมูลเว็บไซต์';
    default:
      return 'เข้าสู่ระบบไม่สำเร็จ · ลองอีกครั้งผ่าน Brave, Chrome หรือ Safari';
  }
}
const ready = (async () => {
  const button = document.getElementById('ai-login'),
    status = document.getElementById('ai-account-status');
  if (!navigator.onLine) {
    offline(button, status);
    return;
  }
  try {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 8000);
    let config;
    try {
      const response = await fetch('/api/config', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error();
      config = await response.json();
    } finally {
      clearTimeout(timer);
    }
    if (config.localPreview) {
      local = true;
      if (button) button.hidden = true;
      accountStatus('AI พร้อมใช้ในเครื่องนี้');
      announce();
      return;
    }
    if (!config.firebase) throw new Error();
    const [{ initializeApp }, authSDK] = await bounded(
      Promise.all([
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
      ]),
    );
    sdk = authSDK;
    auth = sdk.getAuth(initializeApp(config.firebase));
    await bounded(
      new Promise((resolve, reject) => {
        const unsubscribe = sdk.onAuthStateChanged(
          auth,
          () => {
            unsubscribe();
            resolve();
          },
          reject,
        );
      }),
    );
    sdk.onAuthStateChanged(auth, (user) => {
      offlineUser = null;
      try {
        if (user) localStorage.setItem(OWNER_KEY, user.uid);
        else localStorage.removeItem(OWNER_KEY);
      } catch {}
      accountButton(button, user);
      accountStatus(user ? 'เข้าสู่ระบบแล้ว' : 'เข้าสู่ระบบเพื่อซิงค์และใช้ AI');
      document.getElementById('account-identity').textContent = user
        ? user.email || 'บัญชี Google'
        : '';
      if (!user && accountDialog.open) accountDialog.close();
      announce();
    });
    if (button) {
      button.disabled = false;
      button.onclick = async () => {
        if (auth.currentUser) {
          accountDialog.showModal();
          return;
        }
        button.disabled = true;
        try {
          accountStatus('กำลังเปิดหน้าเข้าสู่ระบบ Google…');
          await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
        } catch (error) {
          accountStatus(loginError(error), true);
        } finally {
          button.disabled = false;
        }
      };
    }
    const logout = document.getElementById('account-logout');
    logout.onclick = async () => {
      logout.disabled = true;
      try {
        await sdk.signOut(auth);
        accountDialog.close();
      } catch {
        accountStatus('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง', true);
      } finally {
        logout.disabled = false;
      }
    };
  } catch {
    auth = null;
    sdk = null;
    local = false;
    offline(button, status);
  }
})();
window.budgetAuth = {
  ready,
  getUser,
  async getToken() {
    await ready;
    if (local) return 'local-preview';
    if (!auth?.currentUser) throw new Error('กรุณาเข้าสู่ระบบ Google ก่อนใช้ AI');
    return auth.currentUser.getIdToken();
  },
};
