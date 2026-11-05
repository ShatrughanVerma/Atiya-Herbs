import {
  MAX_TILES,
  formatTimer,
  gridMetrics,
  meetingLink,
  orderTiles,
  parseMeetingLink,
} from '../../src/meetings/meetingLayout';

describe('gridMetrics', () => {
  test.each([
    ['a phone held upright', 390, 600],
    ['a small phone', 320, 480],
    ['a phone turned sideways', 760, 330],
    ['a tablet', 800, 900],
  ])('%s: for 1 to 20 people every tile fits inside the area', (_, width, height) => {
    for (let count = 1; count <= 20; count++) {
      const g = gridMetrics({ width, height, count });
      expect(g.count).toBeLessThanOrEqual(MAX_TILES);
      expect(g.tileWidth * g.columns + g.gap * (g.columns - 1)).toBeLessThanOrEqual(width);
      expect(g.tileHeight * g.rows + g.gap * (g.rows - 1)).toBeLessThanOrEqual(height);
      expect(g.columns * g.rows).toBeGreaterThanOrEqual(g.count);
      expect(g.tileWidth).toBeGreaterThanOrEqual(60);
    }
  });

  test('few people get big tiles, and the grid grows with the number of people', () => {
    const cols = n => gridMetrics({ width: 390, height: 600, count: n }).columns;
    expect([cols(1), cols(2), cols(3), cols(4), cols(6), cols(9)]).toEqual([1, 1, 2, 2, 2, 3]);
    const one = gridMetrics({ width: 390, height: 600, count: 1 });
    const nine = gridMetrics({ width: 390, height: 600, count: 9 });
    expect(one.tileWidth).toBeGreaterThan(nine.tileWidth);
    expect(one.tileHeight).toBeGreaterThan(nine.tileHeight);
  });

  test('two people stack on a tall screen and sit side by side on a wide one', () => {
    expect(gridMetrics({ width: 390, height: 700, count: 2 })).toMatchObject({ columns: 1, rows: 2 });
    expect(gridMetrics({ width: 800, height: 360, count: 2 })).toMatchObject({ columns: 2, rows: 1 });
  });

  test('more than the most that fit are not drawn', () => {
    expect(gridMetrics({ width: 390, height: 600, count: 25 }).count).toBe(MAX_TILES);
    expect(gridMetrics({ width: 390, height: 600, count: 0 }).count).toBe(1);
  });
});

describe('orderTiles', () => {
  const people = [
    { id: 'a', videoOn: false },
    { id: 'b', videoOn: true },
    { id: 'me', videoOn: false },
    { id: 'c', videoOn: false },
    { id: 'd', videoOn: true },
  ];
  const ids = list => list.map(p => p.id);

  test('the person sharing first, then you, then who is talking, then cameras, then the rest in join order', () => {
    expect(ids(orderTiles(people, { myId: 'me', speakingId: 'c', sharingId: 'd' }))).toEqual(['d', 'me', 'c', 'b', 'a']);
  });

  test('without a sharer or speaker you come first, then people with a camera on', () => {
    expect(ids(orderTiles(people, { myId: 'me' }))).toEqual(['me', 'b', 'd', 'a', 'c']);
  });

  test('does not change the list it was given', () => {
    const copy = [...people];
    orderTiles(people, { myId: 'me', sharingId: 'd' });
    expect(people).toEqual(copy);
  });
});

test('the meeting timer', () => {
  expect(formatTimer(0)).toBe('00:00');
  expect(formatTimer(65_000)).toBe('01:05');
  expect(formatTimer(3_600_000 + 61_000)).toBe('1:01:01');
  expect(formatTimer(-5000)).toBe('00:00');
});

test('a meeting link is made and read back, in any case and with or without dashes', () => {
  expect(meetingLink('abc-defg-hij')).toBe('atiyaherbs://meeting/abc-defg-hij');
  expect(parseMeetingLink('atiyaherbs://meeting/abc-defg-hij')).toBe('abc-defg-hij');
  expect(parseMeetingLink('atiyaherbs://meeting/ABCDEFGHIJ')).toBe('abcdefghij');
  expect(parseMeetingLink(' atiyaherbs://meeting/abc-defg-hij/ ')).toBe('abc-defg-hij');
  for (const bad of ['', null, 'https://example.com/meeting/abc-defg-hij', 'atiyaherbs://meeting/', 'atiyaherbs://meeting/abc-def', 'atiyaherbs://call/abc-defg-hij', 'atiyaherbs://meeting/abc-defg-hij?x=1']) {
    expect(parseMeetingLink(bad)).toBeNull();
  }
});
