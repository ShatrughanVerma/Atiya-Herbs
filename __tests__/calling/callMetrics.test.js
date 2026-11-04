import { callMetrics } from '../../src/calling/CallOverlay';

// The call screen's sizes for different screens. What matters most: all the control buttons fit in one row.
const rowWidth = (m, actions) => m.actionSize * actions + m.endSize;
const inner = m => m.contentWidth - 40;

describe('callMetrics', () => {
  test.each([
    ['a small phone', 320, 640],
    ['a common phone', 360, 800],
    ['a large phone', 412, 915],
    ['a tablet', 800, 1280],
    ['a phone turned sideways', 800, 360],
    ['a small phone turned sideways', 640, 320],
  ])('%s: every button fits in one row, with 3, 4 or 5 actions', (_, width, height) => {
    for (const actions of [3, 4, 5]) {
      const m = callMetrics({ width, height, actionCount: actions });
      expect(rowWidth(m, actions)).toBeLessThanOrEqual(inner(m));
      expect(m.actionSize).toBeGreaterThanOrEqual(40); // still easy to tap
    }
  });

  test('buttons shrink on a narrow screen and keep their normal size on a normal one', () => {
    const narrow = callMetrics({ width: 320, height: 640, actionCount: 5 });
    const normal = callMetrics({ width: 390, height: 844, actionCount: 4 });
    expect(narrow.actionSize).toBeLessThan(normal.actionSize);
    expect(normal.actionSize).toBe(56);
    expect(normal.endSize).toBe(64);
  });

  test('on a tablet the controls stay in one column and the buttons do not grow without limit', () => {
    const m = callMetrics({ width: 800, height: 1280, actionCount: 5 });
    expect(m.contentWidth).toBe(560);
    expect(m.actionSize).toBeLessThanOrEqual(Math.round(56 * 1.2));
    expect(m.avatar).toBeLessThanOrEqual(200);
  });

  test('turned sideways the picture of the other person is smaller, so the header, picture and buttons still fit', () => {
    const portrait = callMetrics({ width: 390, height: 844 });
    const landscape = callMetrics({ width: 844, height: 390 });
    expect(portrait.landscape).toBe(false);
    expect(landscape.landscape).toBe(true);
    expect(landscape.avatar).toBeLessThan(portrait.avatar);
    expect(landscape.headerTop).toBeLessThan(portrait.headerTop);
    expect(landscape.panelBottom).toBeLessThan(portrait.panelBottom);
    expect(landscape.avatar).toBeGreaterThanOrEqual(72);
  });

  test('your own small video turns with the phone and keeps clear of the notch', () => {
    const portrait = callMetrics({ width: 390, height: 844, insets: { top: 40, right: 0 } });
    expect(portrait.selfHeight).toBeGreaterThan(portrait.selfWidth);
    expect(portrait.selfTop).toBe(96); // below the status bar / notch (40) plus the top bar
    const landscape = callMetrics({ width: 844, height: 390, insets: { top: 0, right: 44 } });
    expect(landscape.selfWidth).toBeGreaterThan(landscape.selfHeight);
    expect(landscape.selfRight).toBe(60); // clear of a notch on the right edge
  });

  test('sizes stay in sensible bounds for very small and very large screens', () => {
    const tiny = callMetrics({ width: 240, height: 400, actionCount: 5 });
    const huge = callMetrics({ width: 1600, height: 2400, actionCount: 5 });
    for (const m of [tiny, huge]) {
      expect(m.scale).toBeGreaterThanOrEqual(0.85);
      expect(m.scale).toBeLessThanOrEqual(1.2);
      expect(m.bigSize).toBeGreaterThanOrEqual(64);
      expect(m.nameSize).toBeGreaterThanOrEqual(25);
      expect(m.nameSize).toBeLessThanOrEqual(32);
    }
    expect(huge.contentWidth).toBe(560);
  });
});
