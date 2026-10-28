import {NativeModules, Platform} from 'react-native';
import {PRODUCTS} from '../data/catalog';

const {VoiceSearch} = NativeModules;

export const isVoiceSearchAvailable = Platform.OS === 'android' && !!VoiceSearch;

// Speech recognizers often hear single-letter product names as words ("T Care" -> "tea care").
const SPOKEN_ALIASES = {
  't-care': ['tea care', 'tee care', 'te care'],
  'h-care-hair-oil': ['h care', 'edge care', 'ech care', 'age care'],
  'd-care-advance': ['d care', 'dee care', 'the care'],
  'p-care': ['pee care', 'pea care', 'pe care'],
  'f-care': ['f care', 'ef care', 'eff care'],
  'b-care': ['bee care', 'be care'],
};

const normalize = text =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ');

const containsPhrase = (heard, phrase) => ` ${heard} `.includes(` ${phrase} `);

// Returns how well `heard` names the product: 1 = every word of the name (or an alias) was said.
const scoreProduct = (heard, product) => {
  const names = [product.name, ...(SPOKEN_ALIASES[product.id] || [])].map(normalize);
  let best = 0;
  for (const name of names) {
    if (containsPhrase(heard, name)) {
      return 1 + name.length / 1000; // full match; longer names win ties ("gond siyah capsules")
    }
    const words = name.split(' ');
    const said = words.filter(w => containsPhrase(heard, w)).length;
    best = Math.max(best, said / words.length);
  }
  return best;
};

/**
 * Picks the product the user most likely said, or null when no product name was clearly spoken.
 * `phrases` are the recognizer's guesses, best first.
 */
export function matchProduct(phrases) {
  let winner = null;
  let winnerScore = 0;
  for (const phrase of phrases) {
    const heard = normalize(phrase);
    for (const product of PRODUCTS) {
      const score = scoreProduct(heard, product);
      if (score > winnerScore) {
        winner = product;
        winnerScore = score;
      }
    }
    if (winnerScore >= 1) {
      break; // trust the recognizer's best guess when it names a product
    }
  }
  return winnerScore >= 1 ? winner : null;
}

/** Opens the voice popup. Resolves to the recognizer's guesses (empty if the user cancelled). */
export function listen(prompt = 'Say a product name, like "Pain Relief Oil"') {
  return VoiceSearch.listen(prompt);
}
