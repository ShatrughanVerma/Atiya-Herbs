import {formatDay, formatNextSlot, formatTime, formatYmd, monthGrid, monthTitle, todayYmd, toYmd, summarizeTimings, typeLabel, upcomingDays} from '../../src/utils/consult';

describe('consultation helpers', () => {
  test('times and days are shown in Indian time whatever the phone zone is', () => {
    expect(formatTime('2026-11-10T04:30:00.000Z')).toBe('10:00 AM');
    expect(formatTime('2026-11-10T12:30:00.000Z')).toBe('6:00 PM');
    expect(formatTime('2026-11-10T18:30:00.000Z')).toBe('12:00 AM');
    expect(formatDay('2026-11-10T04:30:00.000Z')).toBe('Tue, 10 Nov 2026');
    // 20:00 UTC is already the next day in India
    expect(formatDay('2026-11-10T20:00:00.000Z')).toBe('Wed, 11 Nov 2026');
  });

  test('upcomingDays starts with the Indian today and counts on', () => {
    const days = upcomingDays(3, new Date('2026-11-10T20:00:00.000Z')); // 11 Nov 01:30 in India
    expect(days.map(d => d.ymd)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
    expect(days[0]).toMatchObject({day: 'Wed', date: 11, month: 'Nov'});
  });

  test('weekly timings are summarised by day range', () => {
    const week = [1, 2, 3].flatMap(weekday => [
      {weekday, startTime: '10:00', endTime: '13:00'},
      {weekday, startTime: '17:00', endTime: '20:00'},
    ]);
    expect(summarizeTimings(week)).toEqual(['Mon-Wed: 10:00 AM - 1:00 PM, 5:00 PM - 8:00 PM']);
    expect(summarizeTimings([{weekday: 6, startTime: '09:00', endTime: '12:00'}])).toEqual(['Sat: 9:00 AM - 12:00 PM']);
    expect(summarizeTimings([])).toEqual([]);
  });

  test('the next free time reads Today / Tomorrow / weekday', () => {
    const now = new Date('2026-11-10T06:00:00.000Z'); // Tue 11:30 in India
    expect(formatNextSlot('2026-11-10T11:00:00.000Z', now)).toBe('Today 4:30 PM');
    expect(formatNextSlot('2026-11-11T05:30:00.000Z', now)).toBe('Tomorrow 11:00 AM');
    expect(formatNextSlot('2026-11-13T04:30:00.000Z', now)).toBe('Fri 10:00 AM');
    expect(formatNextSlot(null, now)).toBeNull();
  });

  test('the calendar grid starts on the right weekday and pads the rows', () => {
    const grid = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(grid[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(grid[grid.length - 1]).toEqual([29, 30, null, null, null, null, null]);
    const dec = monthGrid(2026, 11); // December 2026 starts on a Tuesday
    expect(dec[0]).toEqual([null, null, 1, 2, 3, 4, 5]);
    expect(grid.every(week => week.length === 7)).toBe(true);
    expect(monthTitle(2026, 10)).toBe('November 2026');
    expect(toYmd(2026, 10, 7)).toBe('2026-11-07');
  });

  test('today and a picked date are Indian dates', () => {
    expect(todayYmd(new Date('2026-11-10T20:00:00.000Z'))).toBe('2026-11-11');
    expect(formatYmd('2026-11-10')).toBe('Tue, 10 Nov 2026');
  });

  test('type labels', () => {
    expect(typeLabel('clinic')).toBe('In-clinic');
    expect(typeLabel('unknown')).toBe('unknown');
  });
});
