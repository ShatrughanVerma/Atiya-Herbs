// Wellness days are Indian calendar days written as text ("2026-11-24"). Text days sort correctly and never shift with
// the time zone of the server (Render runs in UTC).
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const istDay = (date = new Date()) => new Date(date.getTime() + IST_MS).toISOString().slice(0, 10);

// "2026-11-24" + 3 -> "2026-11-27" (negative numbers go back)
const addDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);

// whole days from a to b ("2026-11-24", "2026-11-26" -> 2)
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

// The Monday of the week of a day (weeks run Monday to Sunday)
const weekStartOf = day => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

// First and last day of the month of a day, and the first day of a month some months away
const monthStartOf = day => `${day.slice(0, 7)}-01`;
const monthEndOf = day => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addMonths = (day, count) => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + count, 1)).toISOString().slice(0, 10);
};

// "2026-11-09" -> "9 Nov"
const shortDay = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
// "2026-11-09" -> "November 2026"
const monthName = day => `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

module.exports = {istDay, addDays, daysBetween, weekStartOf, monthStartOf, monthEndOf, addMonths, shortDay, monthName};
