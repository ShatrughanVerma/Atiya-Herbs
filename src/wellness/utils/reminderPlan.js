// What the phone should ring, worked out from the person's reminder settings (times are minutes after midnight).

// 540 -> "9:00 AM", 1260 -> "9:00 PM", 0 -> "12:00 AM"
export const clock12 = minutes => {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};

// The ids tell the reminders apart: water 1000+, medicines 2000+ (when medicines come), the evening check-in 3000
export const WATER_ID = 1000;
export const CHECKIN_ID = 3000;

// Water: every `waterEveryMin` minutes from `waterFromMin` up to and including `waterUntilMin`.
// Medicine times are saved too, but they ring only for medicines in prescriptions, which come later.
export function planReminders(settings) {
  const list = [];
  if (settings.waterReminderOn) {
    let index = 0;
    for (
      let at = settings.waterFromMin;
      at <= settings.waterUntilMin;
      at += settings.waterEveryMin
    ) {
      list.push({
        id: WATER_ID + index,
        hour: Math.floor(at / 60),
        minute: at % 60,
        title: 'Time to drink water 💧',
        body: 'A glass of water keeps you going.',
      });
      index += 1;
    }
  }
  if (settings.checkinOn) {
    list.push({
      id: CHECKIN_ID,
      hour: Math.floor(settings.checkinAtMin / 60),
      minute: settings.checkinAtMin % 60,
      title: 'Evening check-in',
      body: "Complete today's check-in: your water and how you feel.",
    });
  }
  return list;
}

// The fields of the settings that change the alarms (so nothing is set again when only a goal changed)
export const reminderKey = settings =>
  JSON.stringify([
    settings.waterReminderOn,
    settings.waterEveryMin,
    settings.waterFromMin,
    settings.waterUntilMin,
    settings.checkinOn,
    settings.checkinAtMin,
  ]);
