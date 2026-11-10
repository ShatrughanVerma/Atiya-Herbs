import {daysToTimings, doctorSubtitle, greetingFor, timeOptions, timingsToDays, to12Hour, validateDays} from '../../src/utils/doctor';

describe('doctor helpers', () => {
  test('greeting follows the hour', () => {
    expect(greetingFor(new Date(2026, 10, 9, 9))).toBe('Good morning,');
    expect(greetingFor(new Date(2026, 10, 9, 14))).toBe('Good afternoon,');
    expect(greetingFor(new Date(2026, 10, 9, 19))).toBe('Good evening,');
  });

  test('subtitle skips what is missing', () => {
    expect(doctorSubtitle({system: 'Unani', specialization: 'Digestive wellness', clinicName: 'AIHM Lucknow Clinic'})).toBe('Unani · Digestive wellness · AIHM Lucknow Clinic');
    expect(doctorSubtitle({specialization: 'Skin & Hair'})).toBe('Skin & Hair');
    expect(doctorSubtitle(null)).toBe('');
  });

  test('timetable goes from the server list to seven days and back', () => {
    const timings = [
      {weekday: 1, startTime: '17:00:00', endTime: '20:00', slotMinutes: 20},
      {weekday: 1, startTime: '10:00', endTime: '13:00', slotMinutes: 20},
      {weekday: 0, startTime: '09:00', endTime: '11:00', slotMinutes: 30},
    ];
    const days = timingsToDays(timings);
    expect(days).toHaveLength(7);
    expect(days[1].map(r => r.startTime)).toEqual(['10:00', '17:00']); // sorted, seconds cut
    expect(days[2]).toEqual([]);
    expect(daysToTimings(days)).toEqual([
      {weekday: 0, startTime: '09:00', endTime: '11:00', slotMinutes: 30},
      {weekday: 1, startTime: '10:00', endTime: '13:00', slotMinutes: 20},
      {weekday: 1, startTime: '17:00', endTime: '20:00', slotMinutes: 20},
    ]);
  });

  test('validation finds a backwards or overlapping range', () => {
    const empty = () => timingsToDays([]);
    const ok = empty();
    ok[1] = [{startTime: '10:00', endTime: '13:00', slotMinutes: 20}, {startTime: '13:00', endTime: '15:00', slotMinutes: 20}];
    expect(validateDays(ok)).toBe('');
    const backwards = empty();
    backwards[3] = [{startTime: '13:00', endTime: '10:00', slotMinutes: 20}];
    expect(validateDays(backwards)).toMatch(/Wednesday: the start time must be before/);
    const overlap = empty();
    overlap[5] = [{startTime: '10:00', endTime: '13:00', slotMinutes: 20}, {startTime: '12:00', endTime: '14:00', slotMinutes: 20}];
    expect(validateDays(overlap)).toMatch(/Friday: two time ranges overlap/);
    expect(validateDays(empty())).toBe(''); // a doctor may switch every day off
  });

  test('times for the picker and 12-hour text', () => {
    const times = timeOptions();
    expect(times[0]).toBe('06:00');
    expect(times[1]).toBe('06:30');
    expect(times[times.length - 1]).toBe('22:00');
    expect(to12Hour('00:00')).toBe('12:00 AM');
    expect(to12Hour('13:30')).toBe('1:30 PM');
  });
});

describe('video helpers', () => {
  const {formatBytes, formatDuration, isSupportedVideo} = require('../../src/utils/doctor');

  test('file sizes and lengths read like a person would say them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4024)).toBe('3.9 KB');
    expect(formatBytes(52428800)).toBe('50 MB');
    expect(formatBytes(157286400)).toBe('150 MB');
    expect(formatBytes(1610612736)).toBe('1.5 GB');
    expect(formatBytes(undefined)).toBe('');
    expect(formatDuration(95)).toBe('1:35');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('');
  });

  test('only the video types the server accepts are let through', () => {
    expect(isSupportedVideo('video/mp4')).toBe(true);
    expect(isSupportedVideo('VIDEO/QUICKTIME')).toBe(true);
    expect(isSupportedVideo('image/png')).toBe(false);
    expect(isSupportedVideo(undefined)).toBe(false);
  });
});

describe('the address of the server', () => {
  const {originOf} = require('../../src/utils/doctor');
  test('only the part before /api/v1 is kept', () => {
    expect(originOf('http://10.0.2.2:4100/api/v1')).toBe('http://10.0.2.2:4100');
    expect(originOf('https://api.atiyaherbs.com/api/v1')).toBe('https://api.atiyaherbs.com');
    expect(originOf('')).toBe('');
  });
});
