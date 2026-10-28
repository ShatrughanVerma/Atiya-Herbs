import {CLINICS} from '../data/store';
import {distanceKm} from './location';

export const isValidPincode = pincode => /^[1-9][0-9]{5}$/.test(pincode);

// India Post's free lookup: pincode → area, district and state (also tells us the pincode is real)
async function lookupPostOffice(pincode) {
  const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
  const [data] = await res.json();
  const office = data?.Status === 'Success' ? data.PostOffice?.[0] : null;
  return office ? {area: office.Name, district: office.District, state: office.State} : null;
}

// OpenStreetMap's free geocoder: pincode → coordinates. Returns null if it has no match.
async function lookupCoordinates(pincode) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?postalcode=${pincode}&countrycodes=in&format=json&limit=1`,
      {headers: {'User-Agent': 'AtiyaHerbsApp/1.0 (helpdesk@atiyaherbs.com)', 'Accept-Language': 'en'}},
    );
    const [hit] = await res.json();
    return hit ? {lat: Number(hit.lat), lng: Number(hit.lon)} : null;
  } catch {
    return null;
  }
}

/** All clinics, nearest first when `from` ({lat, lng}) is known. Items are {clinic, km?}. */
export function sortClinics(from) {
  if (!from) {
    return CLINICS.map(clinic => ({clinic}));
  }
  return CLINICS.map(clinic => ({clinic, km: distanceKm(from, clinic)})).sort((a, b) => a.km - b.km);
}

// Without coordinates: same city first, then any clinic in the same state
function matchByName({district, state}) {
  const same = (a, b) => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
  return (
    CLINICS.find(c => c.city && same(district, c.city)) ||
    CLINICS.find(c => c.state.toLowerCase() === state.toLowerCase()) ||
    null
  );
}

/**
 * Finds the nearest clinic to a pincode.
 * Resolves to {pincode, area, district, state, point, clinic, km} (point/km may be undefined).
 * Rejects with an Error whose message is safe to show to the user.
 */
export async function searchByPincode(pincode) {
  if (!isValidPincode(pincode)) {
    throw new Error('Enter a valid 6-digit pincode');
  }
  let place;
  let point;
  try {
    [place, point] = await Promise.all([lookupPostOffice(pincode), lookupCoordinates(pincode)]);
  } catch {
    throw new Error('Couldn’t check the pincode. Please check your internet.');
  }
  if (!place) {
    throw new Error('We couldn’t find this pincode. Please check and try again.');
  }
  if (point) {
    const [nearest] = sortClinics(point);
    return {pincode, ...place, point, clinic: nearest.clinic, km: nearest.km};
  }
  return {pincode, ...place, clinic: matchByName(place)};
}
