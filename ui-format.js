// Web presentation helpers; business calculations never depend on these.
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const money = (cents) =>
  new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const thaiDate = (date) =>
  new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date + 'T12:00:00'),
  );
export const monthName = (month) =>
  new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(
    new Date(month + '-01T12:00:00'),
  );
