import { localDate, validDate, parseMoney } from './model.js';
import { buildAIContext, validateAICandidates } from './ledger-domain.js';
import { monthName } from './ui-format.js';
import { requestAI } from './ai-client.js';
import { showView } from './views.js';

// Browser AI dialog controller. Native applications replace this presentation layer.
export function createAIUI({
  getState,
  getRaw,
  hasStorageFault,
  commit,
  rememberSave,
  afterSave,
  notify,
}) {
  const $ = (id) => document.getElementById(id);
  // AI proposes data only. Every write goes through the same validated local commit.
  let aiAction = 'extract',
    aiImage = null,
    aiPreviewURL = null,
    aiBusy = false,
    aiGeneration = 0,
    aiReviewedRaw = null,
    aiTripDefault = '';
  function clearAIImage() {
    aiImage = null;
    if (aiPreviewURL) URL.revokeObjectURL(aiPreviewURL);
    aiPreviewURL = null;
    $('ai-image').value = '';
    $('ai-image-preview').removeAttribute('src');
    $('ai-image-preview').hidden = true;
    $('ai-image-remove').hidden = true;
  }
  function clearAIResult() {
    $('ai-review').hidden = true;
    $('ai-answer').hidden = true;
    $('ai-answer').textContent = '';
    $('ai-candidates').replaceChildren();
    $('ai-warnings').replaceChildren();
    aiReviewedRaw = null;
  }
  function setAIBusy(busy) {
    aiBusy = busy;
    for (const id of ['ai-submit', 'ai-text', 'ai-image', 'ai-image-remove', 'ai-save-reviewed'])
      $(id).disabled = busy;
    $('ai-close').disabled = busy;
    if (busy) $('ai-status').textContent = 'กำลังอ่านและเตรียมคำตอบ…';
    else if ($('ai-status').textContent === 'กำลังอ่านและเตรียมคำตอบ…')
      $('ai-status').textContent = '';
  }
  function openAI(action, image = false, question = '') {
    if (hasStorageFault()) {
      notify('อ่านข้อมูลเดิมไม่ได้ โปรดกู้คืนก่อนใช้ AI');
      return;
    }
    if (getState().demo) {
      notify('กด “เริ่มจดข้อมูลของฉัน” ก่อนใช้ AI เพื่อไม่ปะปนกับข้อมูลตัวอย่าง');
      return;
    }
    aiAction = action;
    aiTripDefault = $('entry-trip').value;
    aiGeneration++;
    clearAIResult();
    clearAIImage();
    $('ai-error').textContent = '';
    $('ai-status').textContent = '';
    $('ai-text').value = question;
    $('ai-heading').textContent = action === 'extract' ? 'ช่วยจดด้วย AI' : 'ถามเรื่องเงิน';
    $('ai-guidance').textContent =
      action === 'extract'
        ? 'ตรวจรายการและทริปก่อนยืนยัน ถ้าสลิปไม่บอกว่าซื้ออะไร ให้เติมรายละเอียด'
        : 'ตอบจากรายการเดือน ' +
          monthName($('month').value) +
          ' และเดือนก่อนเพื่อเทียบ อาจไม่ครบเงินจริงของคุณ AI ไม่แก้ไขรายการ';
    $('ai-text-label').textContent =
      action === 'extract' ? 'เล่าให้ฟังว่ารับหรือจ่ายอะไร' : 'อยากรู้เรื่องอะไร';
    $('ai-text').placeholder =
      action === 'extract'
        ? 'วันนี้ข้าว 65 กาแฟ 50 เมื่อวานเติมน้ำมัน 800'
        : 'เดือนนี้จ่ายกับอะไรเยอะที่สุด';
    $('ai-submit').textContent = action === 'extract' ? 'ให้ AI เตรียมรายการ' : 'ถาม AI';
    $('ai-image-tools').hidden = action !== 'extract';
    $('ai-dialog').showModal();
    if (image) $('ai-image').click();
    else $('ai-text').focus();
  }
  $('ai-extract-open').onclick = () => openAI('extract');
  $('ai-ask-open').onclick = () =>
    openAI(
      'ask',
      false,
      'สรุปว่ารายจ่ายเดือนที่เลือกไปกับอะไรเป็นหลัก ชี้รายการสำคัญจากข้อมูลที่จด และบอกข้อจำกัดของข้อมูล',
    );
  $('ai-image-open').onclick = () => openAI('extract', true);
  $('expense-compare-open').onclick = () =>
    openAI(
      'ask',
      false,
      'เทียบรายจ่ายเดือนที่เลือกกับเดือนก่อน หมวดไหนเพิ่มขึ้นมากที่สุด และเพิ่มจากรายการอะไรบ้าง ถ้าข้อมูลไม่พอให้บอกตรง ๆ',
    );
  $('ai-close').onclick = () => $('ai-dialog').close();
  $('ai-dialog').addEventListener('cancel', (event) => {
    if (aiBusy) event.preventDefault();
  });
  $('ai-dialog').addEventListener('close', () => {
    aiGeneration++;
    setAIBusy(false);
    clearAIImage();
    clearAIResult();
    $('ai-text').value = '';
  });
  $('ai-image-remove').onclick = () => {
    clearAIImage();
    clearAIResult();
  };
  $('ai-text').oninput = () => {
    clearAIResult();
    $('ai-error').textContent = '';
    $('ai-status').textContent = '';
  };
  $('ai-image').onchange = async (event) => {
    const file = event.target.files[0];
    clearAIImage();
    clearAIResult();
    $('ai-error').textContent = '';
    if (!file) return;
    const generation = aiGeneration;
    setAIBusy(true);
    try {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 5 * 1024 * 1024 ||
        file.size === 0
      )
        throw new Error('ใช้ภาพ JPG, PNG หรือ WebP ไม่เกิน 5 MB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v),
        webp =
          String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
          String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
      if (!{ 'image/jpeg': jpeg, 'image/png': png, 'image/webp': webp }[file.type])
        throw new Error('ไฟล์นี้ไม่ใช่ภาพที่รองรับ');
      const bitmap = await createImageBitmap(file);
      let upload;
      try {
        if (
          bitmap.width * bitmap.height > 40000000 ||
          bitmap.width > 16000 ||
          bitmap.height > 16000
        )
          throw new Error('ภาพมีขนาดใหญ่เกินไป กรุณาครอปหรือย่อภาพก่อน');
        const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        upload = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        if (!upload || upload.size > 5 * 1024 * 1024)
          throw new Error('ภาพยังใหญ่เกินไป กรุณาครอปภาพก่อน');
      } finally {
        bitmap.close();
      }
      const uploadBytes = new Uint8Array(await upload.arrayBuffer());
      let binary = '';
      for (let i = 0; i < uploadBytes.length; i += 8192)
        binary += String.fromCharCode(...uploadBytes.subarray(i, i + 8192));
      if (generation !== aiGeneration || !$('ai-dialog').open) return;
      aiImage = { data: btoa(binary), mimeType: 'image/jpeg' };
      aiPreviewURL = URL.createObjectURL(upload);
      $('ai-image-preview').src = aiPreviewURL;
      $('ai-image-preview').hidden = false;
      $('ai-image-remove').hidden = false;
    } catch (error) {
      if (generation === aiGeneration) $('ai-error').textContent = error.message;
    } finally {
      if (generation === aiGeneration) {
        setAIBusy(false);
        $('ai-save-reviewed').disabled = true;
      }
    }
  };
  function candidateField(label, value, kind, maxLength) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.textContent = label;
    const control = document.createElement(
      kind === 'type' || kind === 'tripId' ? 'select' : 'input',
    );
    control.dataset.field = kind;
    if (kind === 'type') {
      for (const [v, t] of [
        ['expense', 'รายจ่าย'],
        ['income', 'รายรับ'],
      ]) {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = t;
        control.append(option);
      }
    } else if (kind === 'tripId') {
      control.add(new Option('ไม่ผูกกับทริป', ''));
      for (const trip of getState().trips) {
        if (!trip.archived || trip.id === value) control.add(new Option(trip.name, trip.id));
      }
    } else {
      control.type = kind === 'date' ? 'date' : 'text';
      if (kind === 'amount') control.inputMode = 'decimal';
      if (maxLength) control.maxLength = maxLength;
    }
    control.value = value;
    wrap.append(control);
    return wrap;
  }
  function displayAICandidates(result) {
    for (const warning of result.warnings) {
      const li = document.createElement('li');
      li.textContent = warning;
      $('ai-warnings').append(li);
    }
    result.entries.forEach((row, index) => {
      const item = document.createElement('article');
      item.className = 'ai-candidate';
      const selection = document.createElement('label');
      selection.className = 'ai-candidate-select';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = true;
      check.dataset.field = 'include';
      selection.append(check, document.createTextNode(' บันทึกรายการที่ ' + (index + 1)));
      item.append(selection);
      item.append(
        candidateField('ประเภท', row.type, 'type'),
        candidateField('จำนวนเงิน (บาท)', row.amount, 'amount', 24),
        candidateField('วันที่', row.date, 'date'),
        candidateField('รายละเอียด', row.description, 'description', 160),
        candidateField('หมวด', row.category, 'category', 60),
        candidateField('ทริป', aiTripDefault, 'tripId'),
      );
      const amount = parseMoney(row.amount),
        existing = getState().entries.some(
          (old) =>
            old.date === row.date &&
            old.type === row.type &&
            old.amountCents === amount &&
            old.description === row.description,
        );
      const earlier = result.entries
        .slice(0, index)
        .some(
          (old) =>
            old.date === row.date &&
            old.type === row.type &&
            parseMoney(old.amount) === amount &&
            old.description === row.description,
        );
      if (existing || earlier) {
        check.checked = false;
        const warning = document.createElement('p');
        warning.className = 'ai-duplicate';
        warning.textContent = 'อาจซ้ำกับรายการที่มีอยู่หรือรายการด้านบน จึงยังไม่เลือกบันทึก';
        item.append(warning);
      }
      $('ai-candidates').append(item);
    });
    aiReviewedRaw = getRaw();
    $('ai-review').hidden = false;
    $('ai-save-reviewed').disabled = !result.entries.length;
    $('ai-status').textContent = result.entries.length
      ? 'เตรียม ' + result.entries.length + ' รายการแล้ว ยังไม่ได้บันทึก'
      : 'ไม่พบรายการที่อ่านได้ กรุณาเติมรายละเอียด';
  }
  $('ai-form').onsubmit = async (event) => {
    event.preventDefault();
    if (aiBusy) return;
    clearAIResult();
    $('ai-error').textContent = '';
    const generation = aiGeneration,
      sourceRaw = getRaw();
    try {
      if (hasStorageFault() || getState().demo)
        throw new Error('กรุณาใช้ข้อมูลจริงที่อ่านได้ก่อนใช้ AI');
      const text = $('ai-text').value.trim();
      if (!text && (aiAction === 'ask' || !aiImage))
        throw new Error('พิมพ์ข้อความหรือแนบภาพก่อนส่ง');
      const payload = { action: aiAction, text };
      if (aiAction === 'extract') {
        if (aiImage) payload.image = aiImage;
        payload.date = localDate();
      } else payload.context = buildAIContext(getState(), $('month').value);
      setAIBusy(true);
      const response = await requestAI(payload);
      if (generation !== aiGeneration) return;
      if (getRaw() !== sourceRaw || hasStorageFault() || getState().demo)
        throw new Error('ข้อมูลเปลี่ยนระหว่างรอ AI กรุณาตรวจข้อมูลแล้วส่งใหม่');
      if (aiAction === 'extract') displayAICandidates(validateAICandidates(response));
      else {
        if (
          typeof response.answer !== 'string' ||
          !response.answer.trim() ||
          response.answer.length > 20000
        )
          throw new Error('คำตอบจาก AI ไม่ถูกต้อง');
        $('ai-answer').textContent = response.answer;
        $('ai-answer').hidden = false;
      }
    } catch (error) {
      if (generation === aiGeneration) $('ai-error').textContent = error.message;
    } finally {
      if (generation === aiGeneration) {
        setAIBusy(false);
        if (!$('ai-candidates').childElementCount) $('ai-save-reviewed').disabled = true;
      }
    }
  };
  $('ai-save-reviewed').onclick = () => {
    $('ai-error').textContent = '';
    try {
      if (aiBusy || hasStorageFault() || getState().demo || aiReviewedRaw !== getRaw())
        throw new Error('ข้อมูลเปลี่ยนไป กรุณาให้ AI เตรียมรายการใหม่ก่อนบันทึก');
      const rows = [];
      for (const item of $('ai-candidates').children) {
        const field = (name) => item.querySelector('[data-field="' + name + '"]');
        if (!field('include').checked) continue;
        const type = field('type').value,
          date = field('date').value,
          description = field('description').value.trim(),
          category = field('category').value.trim();
        if (
          !['income', 'expense'].includes(type) ||
          !validDate(date) ||
          !description ||
          description.length > 160 ||
          category.length > 60
        )
          throw new Error('ตรวจประเภท วันที่ และรายละเอียดของรายการที่เลือกให้ครบ');
        rows.push({
          id: crypto.randomUUID(),
          type,
          date,
          amountCents: parseMoney(field('amount').value),
          description,
          category,
          tripId: field('tripId').value,
        });
      }
      if (!rows.length) throw new Error('เลือกรายการที่ต้องการบันทึกอย่างน้อยหนึ่งรายการ');
      commit({ ...getState(), entries: [...getState().entries, ...rows] });
      rememberSave(
        rows.map((after) => ({ after, before: null })),
        'บันทึก ' + rows.length + ' รายการจาก AI',
      );
      afterSave(rows);
      $('ai-dialog').close();
      showView('entry-panel', { focus: true });
      notify('ตรวจและบันทึก ' + rows.length + ' รายการจาก AI แล้ว');
    } catch (error) {
      $('ai-error').textContent = error.message;
    }
  };

  return {
    reset() {
      aiGeneration++;
      setAIBusy(false);
      if ($('ai-dialog').open) $('ai-dialog').close();
      clearAIImage();
      clearAIResult();
      $('ai-text').value = '';
    },
  };
}
