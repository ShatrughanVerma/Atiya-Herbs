// Small helpers for the consultation screens. The clinics work in Indian time (IST, UTC+5:30), so dates and
// times are shown in IST whatever the phone's own time zone is.

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const CONSULT_TYPES = [
  { id: 'clinic', label: 'In-clinic', title: 'Clinic visit', note: 'Visit the clinic and meet the doctor in person', icon: 'map-marker-outline' },
  { id: 'video', label: 'Video', title: 'Video consultation', note: 'Talk to the doctor face to face on a video call', icon: 'video-outline' },
  { id: 'audio', label: 'Audio', title: 'Audio consultation', note: 'Speak to the doctor on a phone call', icon: 'phone-outline' },
  { id: 'text', label: 'Chat', title: 'Chat consultation', note: 'Send your questions to the doctor as messages', icon: 'message-text-outline' },
];

// The quick choices of the booking form. DURATIONS must be the same words as the server accepts.
export const HEALTH_CONCERNS = ['Joint & back pain', "Men's health", "Women's health", 'Blood sugar', 'Digestion & acidity', 'Skin care', 'Low immunity'];
export const DURATIONS = ['Less than 1 month', '1-3 months', '3-6 months', '6-12 months', 'More than 1 year'];

export const typeLabel = id => CONSULT_TYPES.find(type => type.id === id)?.label ?? id;

const istParts = date => new Date(date.getTime() + IST_MS);

// The next `count` Indian dates from today: [{ymd: '2026-11-10', day: 'Tue', date: 10, month: 'Nov'}]
export function upcomingDays(count = 7, now = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const d = istParts(new Date(now.getTime() + i * DAY_MS));
    return {
      ymd: d.toISOString().slice(0, 10),
      day: DAYS[d.getUTCDay()],
      date: d.getUTCDate(),
      month: MONTHS[d.getUTCMonth()],
    };
  });
}

// '2026-11-10T04:30:00.000Z' -> '10:00 AM'
export function formatTime(iso) {
  const d = istParts(new Date(iso));
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// '2026-11-10T04:30:00.000Z' -> 'Tue, 10 Nov 2026'
export function formatDay(iso) {
  const d = istParts(new Date(iso));
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const WEEKDAY_NAMES = DAYS;

// The first free time on a doctor card: "Today 4:30 PM", "Tomorrow 11:00 AM", "Wed 10:00 AM" (null = none soon)
export function formatNextSlot(iso, now = new Date()) {
  if (!iso) {
    return null;
  }
  const slotDay = istParts(new Date(iso)).toISOString().slice(0, 10);
  const today = istParts(now).toISOString().slice(0, 10);
  const tomorrow = istParts(new Date(now.getTime() + DAY_MS)).toISOString().slice(0, 10);
  const when = slotDay === today ? 'Today' : slotDay === tomorrow ? 'Tomorrow' : DAYS[istParts(new Date(iso)).getUTCDay()];
  return `${when} ${formatTime(iso)}`;
}

// "Mon-Sat 10:00 AM - 1:00 PM, 5:00 PM - 8:00 PM" from the doctor's weeklyTimings
export function summarizeTimings(weeklyTimings = []) {
  const to12 = hhmm => {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const byDay = new Map();
  weeklyTimings.forEach(({ weekday, startTime, endTime }) => {
    byDay.set(weekday, [...(byDay.get(weekday) || []), `${to12(startTime)} - ${to12(endTime)}`]);
  });
  const groups = [];
  [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([weekday, ranges]) => {
      const text = ranges.join(', ');
      const last = groups[groups.length - 1];
      if (last && last.text === text && last.to === weekday - 1) {
        last.to = weekday;
      } else {
        groups.push({ from: weekday, to: weekday, text });
      }
    });
  return groups.map(g => `${g.from === g.to ? DAYS[g.from] : `${DAYS[g.from]}-${DAYS[g.to]}`}: ${g.text}`);
}

// The days of one month for a calendar, 7 per row, with null before the 1st and after the last day:
// monthGrid(2026, 10) is November 2026. `month` is 0-11.
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}

export const monthTitle = (year, month) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month]} ${year}`;

export const toYmd = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

// Today's Indian date as 'YYYY-MM-DD'
export const todayYmd = (now = new Date()) => istParts(now).toISOString().slice(0, 10);

// 'YYYY-MM-DD' -> 'Tue, 10 Nov 2026'
export const formatYmd = ymd => formatDay(`${ymd}T00:00:00+05:30`);
