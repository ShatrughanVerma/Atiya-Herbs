// Wellness days come from the backend as Indian calendar days written as text ("2026-11-24").
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const partsOf = day => {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

// "2026-11-21" -> "Sat"
export const weekdayShort = day => WEEKDAYS[partsOf(day).weekday];

// "2026-11-21" -> "21 Nov"
export const shortDay = day => {
  const { m, d } = partsOf(day);
  return `${d} ${MONTHS[m - 1]}`;
};

// "2026-11-21" -> "Sat, 21 Nov"
export const dayLabel = day => {
  const { m, d, weekday } = partsOf(day);
  return `${WEEKDAYS[weekday]}, ${d} ${MONTHS[m - 1]}`;
};
