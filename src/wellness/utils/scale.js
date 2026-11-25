import { Dimensions } from 'react-native';

// Responsive sizes for the Health Wellness screens. A phone 420 dp wide gets the sizes as written; a narrower phone gets
// them smaller and a wider one a little bigger (never below 85% or above 110%), so the cards neither overflow on a small
// phone nor look lost on a big one. The scale is worked out once, when the app starts (portrait phones).
const BASE_WIDTH = 420;
const FONT_SHRINK = 0.92; // fonts are 8% smaller than their size on the drawing
const MIN_FONT = 10;

const { width } = Dimensions.get('window');
export const scale = Math.min(1.1, Math.max(0.85, width / BASE_WIDTH));

const round = value => Math.round(value * 10) / 10;

// sizes: padding, margin, width, height, radius, icons
export const sz = n => round(n * scale);

// font sizes
export const fz = n => Math.max(MIN_FONT, round(n * scale * FONT_SHRINK));
