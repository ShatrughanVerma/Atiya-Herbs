import {Dimensions} from 'react-native';

describe('responsive sizes of the wellness screens', () => {
  // the scale is worked out once from the width of the phone, so each width gets a fresh copy of the module
  const withWidth = width => {
    jest.resetModules();
    jest.spyOn(Dimensions, 'get').mockReturnValue({width, height: 900, scale: 2, fontScale: 1});
    return require('../../src/wellness/utils/scale');
  };
  afterEach(() => jest.restoreAllMocks());

  test('a phone 420 wide gets the sizes as drawn, and fonts 8% smaller', () => {
    const {sz, fz, scale} = withWidth(420);
    expect(scale).toBe(1);
    expect(sz(40)).toBe(40);
    expect(fz(10)).toBe(10); // never below 10
    expect(fz(15)).toBe(13.8);
  });

  test('a narrow phone gets smaller sizes, but never below 85%', () => {
    const {sz, scale} = withWidth(360);
    expect(scale).toBeCloseTo(0.857, 2);
    expect(sz(100)).toBe(85.7);
    expect(withWidth(280).scale).toBe(0.85);
  });

  test('a wide phone or tablet gets a little more, but never above 110%', () => {
    expect(withWidth(450).scale).toBeCloseTo(1.071, 2);
    expect(withWidth(800).scale).toBe(1.1);
    expect(withWidth(800).sz(100)).toBe(110);
  });

  test('fonts keep a readable minimum on the smallest phones', () => {
    const {fz} = withWidth(280);
    expect(fz(11)).toBe(10);
    expect(fz(24)).toBeGreaterThanOrEqual(18);
  });
});
