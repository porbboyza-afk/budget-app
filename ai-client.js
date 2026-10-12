// No provider credentials belong in browser code. The authenticated server calls AI.
export async function requestAI(payload) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new DOMException('AI request timed out', 'AbortError'));
      controller.abort();
    }, 60000);
  });
  try {
    return await Promise.race([deadline, performRequest()]);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI ใช้เวลานานเกินไป กรุณาลองใหม่');
    if (error instanceof TypeError) throw new Error('เชื่อมต่อ AI ไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ');
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  async function performRequest() {
    const owner = window.budgetAuth?.getUser?.()?.uid;
    await window.budgetAuth?.ready;
    controller.signal.throwIfAborted();
    const token = await window.budgetAuth?.getToken?.();
    // A timed-out token promise may resolve later. Never send its stale payload.
    controller.signal.throwIfAborted();
    if (window.budgetAuth?.getUser?.()?.uid !== owner)
      throw new Error('บัญชีเปลี่ยนระหว่างเตรียมคำขอ กรุณาส่งใหม่');
    if (!token) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้ AI');
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error('บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้ AI กรุณาเข้าสู่ระบบใหม่หรือตรวจสิทธิ์บัญชี');
      if (response.status === 429)
        throw new Error('ใช้ AI ครบขีดจำกัดชั่วคราว กรุณาลองใหม่ภายหลัง');
      throw new Error('AI ยังไม่พร้อมใช้งาน กรุณาลองอีกครั้ง ข้อมูลของคุณยังไม่ถูกแก้ไข');
    }
    if (!body || typeof body !== 'object') throw new Error('AI ส่งคำตอบที่อ่านไม่ได้');
    return body;
  }
}
