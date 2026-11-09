// Helpers of the doctor side of the app.

export const greetingFor = (now = new Date()) => {
  // the phone's own clock: a greeting is about where the doctor is, not about the clinic's time zone
  const hour = now.getHours();
  return hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : 'Good evening,';
};

// "Unani · Digestive wellness · AIHM Lucknow Clinic"
export const doctorSubtitle = me => [me?.system, me?.specialization, me?.clinicName].filter(Boolean).join(' · ');

// ---- the weekly timetable ("Days & times")
// The server keeps a flat list: [{weekday: 1, startTime: '10:00', endTime: '13:00', slotMinutes: 20}] (0 = Sunday).
// The screen works with seven days, each holding its time ranges.
export const SLOT_MINUTES = [10, 15, 20, 30, 45, 60];
// Monday first, like an Indian calendar
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const timingsToDays = (timings = []) =>
  Array.from({length: 7}, (_, weekday) =>
    timings
      .filter(t => t.weekday === weekday)
      .map(t => ({startTime: String(t.startTime).slice(0, 5), endTime: String(t.endTime).slice(0, 5), slotMinutes: t.slotMinutes}))
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  );

export const daysToTimings = days =>
  days.flatMap((ranges, weekday) =>
    ranges.map(r => ({weekday, startTime: r.startTime, endTime: r.endTime, slotMinutes: r.slotMinutes})),
  );

// '' when the timetable is fine, otherwise a sentence for the doctor
export function validateDays(days) {
  for (const weekday of DAY_ORDER) {
    const ranges = [...days[weekday]].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 0; i < ranges.length; i += 1) {
      const r = ranges[i];
      if (r.startTime >= r.endTime) {
        return `${DAY_NAMES[weekday]}: the start time must be before the end time.`;
      }
      if (i > 0 && r.startTime < ranges[i - 1].endTime) {
        return `${DAY_NAMES[weekday]}: two time ranges overlap.`;
      }
    }
  }
  return '';
}

// '06:00', '06:30', ... '22:00' for the time picker
export const timeOptions = (from = 6, to = 22) => {
  const list = [];
  for (let h = from; h <= to; h += 1) {
    list.push(`${String(h).padStart(2, '0')}:00`);
    if (h < to) {
      list.push(`${String(h).padStart(2, '0')}:30`);
    }
  }
  return list;
};

// '14:30' -> '2:30 PM'
export const to12Hour = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// ---- videos
// The types the server accepts (what a phone's camera makes). 'video/mp4' is by far the most common.
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/3gpp', 'video/webm', 'video/x-matroska'];
export const isSupportedVideo = type => VIDEO_TYPES.includes(String(type || '').toLowerCase());

// 4024 -> '3.9 KB', 52428800 -> '50 MB'
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

// 95 -> '1:35', 3725 -> '1:02:05'
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

