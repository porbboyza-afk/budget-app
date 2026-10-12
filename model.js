export const STORAGE_KEY = 'budget-next-draft-v1';
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 1900 &&
    y <= 2200 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
export function parseMoney(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error('ใส่จำนวนเงินเป็นตัวเลขบวก ทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000000)
    throw new Error('จำนวนเงินต้องมากกว่า 0 และไม่เกิน 1,000,000,000 บาท');
  return cents;
}
export function validateState(data) {
  if (
    !data ||
    ![1, 2].includes(data.version) ||
    !Array.isArray(data.entries) ||
    data.entries.length > 100000 ||
    !Number.isSafeInteger(data.openingCents) ||
    Math.abs(data.openingCents) > 100000000000
  )
    throw new Error('ไฟล์นี้ไม่ใช่ข้อมูลจดเงินรุ่นที่รองรับ');
  const trips = data.version === 1 ? [] : data.trips;
  if (!Array.isArray(trips) || trips.length > 200)
    throw new Error('ข้อมูลทริปไม่ถูกต้องหรือมีเกิน 200 ทริป');
  const tripIds = new Set();
  for (const trip of trips) {
    if (
      !trip ||
      typeof trip.id !== 'string' ||
      !trip.id ||
      trip.id.length > 100 ||
      tripIds.has(trip.id) ||
      typeof trip.name !== 'string' ||
      !trip.name.trim() ||
      trip.name.length > 80 ||
      !validDate(trip.startDate) ||
      !validDate(trip.endDate) ||
      trip.startDate > trip.endDate ||
      !Number.isSafeInteger(trip.budgetCents) ||
      trip.budgetCents < 0 ||
      trip.budgetCents > 100000000000 ||
      typeof trip.archived !== 'boolean'
    )
      throw new Error('ชื่อ วันที่ หรืองบทริปไม่ถูกต้อง');
    tripIds.add(trip.id);
  }
  const ids = new Set();
  let totalMagnitude = Math.abs(data.openingCents);
  for (const row of data.entries) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      row.id.length > 100 ||
      ids.has(row.id) ||
      !validDate(row.date) ||
      !['income', 'expense'].includes(row.type) ||
      !Number.isSafeInteger(row.amountCents) ||
      row.amountCents <= 0 ||
      row.amountCents > 100000000000 ||
      typeof row.description !== 'string' ||
      !row.description.trim() ||
      row.description.length > 160 ||
      typeof row.category !== 'string' ||
      row.category.length > 60
    )
      throw new Error('ข้อมูลรายการไม่ถูกต้องหรือมีรายการซ้ำ');
    ids.add(row.id);
    if (
      data.version === 2 &&
      (typeof row.tripId !== 'string' || (row.tripId && !tripIds.has(row.tripId)))
    )
      throw new Error('รายการอ้างอิงทริปที่ไม่มีอยู่');
    totalMagnitude += row.amountCents;
    if (!Number.isSafeInteger(totalMagnitude))
      throw new Error('ยอดรวมเกินขนาดที่คำนวณได้อย่างแม่นยำ');
  }
  return {
    version: 2,
    openingCents: data.openingCents,
    demo: data.demo === true,
    trips: trips.map((t) => ({
      id: t.id,
      name: t.name.trim(),
      startDate: t.startDate,
      endDate: t.endDate,
      budgetCents: t.budgetCents,
      archived: t.archived,
    })),
    entries: data.entries.map((row) => ({
      id: row.id,
      date: row.date,
      type: row.type,
      amountCents: row.amountCents,
      description: row.description,
      category: row.category,
      tripId: data.version === 2 ? row.tripId : '',
    })),
  };
}
export function expenseCategories(entries) {
  const categories = new Map();
  for (const row of entries) {
    if (row.type !== 'expense') continue;
    const key = row.category || 'ไม่ระบุหมวด';
    categories.set(key, (categories.get(key) || 0) + row.amountCents);
  }
  return [...categories].sort((a, b) => b[1] - a[1]);
}
export function tripTotals(state, id) {
  const entries = state.entries.filter((row) => row.tripId === id),
    expense = entries
      .filter((row) => row.type === 'expense')
      .reduce((sum, row) => sum + row.amountCents, 0);
  return { entries, expense, categories: expenseCategories(entries) };
}
export function totals(state, month) {
  let income = 0,
    expense = 0,
    balance = state.openingCents;
  for (const row of state.entries) {
    if (row.date.slice(0, 7) <= month)
      balance += row.type === 'income' ? row.amountCents : -row.amountCents;
    if (row.date.startsWith(month + '-')) {
      if (row.type === 'income') income += row.amountCents;
      else expense += row.amountCents;
    }
  }
  return { income, expense, balance };
}
export function sampleState() {
  const month = localDate().slice(0, 7),
    day = new Date().getDate();
  const date = (offset) => `${month}-${String(Math.max(1, day - offset)).padStart(2, '0')}`;
  return {
    version: 1,
    openingCents: 0,
    demo: true,
    entries: [
      {
        id: 'sample-1',
        date: date(6),
        type: 'income',
        amountCents: 2500000,
        description: 'เงินเดือน',
        category: 'งานประจำ',
      },
      {
        id: 'sample-2',
        date: date(3),
        type: 'expense',
        amountCents: 450000,
        description: 'ค่าเช่าห้อง',
        category: 'บ้าน',
      },
      {
        id: 'sample-3',
        date: date(2),
        type: 'income',
        amountCents: 120000,
        description: 'งานออกแบบเพิ่มเติม',
        category: 'รายได้เสริม',
      },
      {
        id: 'sample-4',
        date: date(1),
        type: 'expense',
        amountCents: 89000,
        description: 'ซื้อของเข้าบ้าน',
        category: 'ของใช้',
      },
      {
        id: 'sample-5',
        date: date(0),
        type: 'expense',
        amountCents: 6500,
        description: 'อาหารกลางวัน',
        category: 'อาหาร',
      },
      {
        id: 'sample-6',
        date: date(0),
        type: 'expense',
        amountCents: 4000,
        description: 'ค่าเดินทาง',
        category: 'เดินทาง',
      },
    ],
  };
}
