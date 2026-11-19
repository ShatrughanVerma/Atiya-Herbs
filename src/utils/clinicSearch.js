import axios from 'axios';
import {CLINICS} from '../data/store';
import {GOOGLE_MAPS_API_KEY} from '../config/api';
import {distanceKm} from './location';

/** A distance for people: metres under 1 km (700 m), then km with one decimal (24.4 km, 1,164.3 km). */
export const formatDistance = km =>
  km < 1
    ? `${Math.max(1, Math.round(km * 1000))} m`
    : `${km.toLocaleString('en-IN', {minimumFractionDigits: 1, maximumFractionDigits: 1})} km`;

export const isValidPincode = pincode => /^[1-9][0-9]{5}$/.test(pincode);

// India Post's free lookup: pincode → area, district and state (also tells us the pincode is real)
async function lookupPostOffice(pincode) {
  const res = await axios.get(`https://api.postalpincode.in/pincode/${pincode}`);
  const [data] = res.data;
  const office = data?.Status === 'Success' ? data.PostOffice?.[0] : null;
  return office ? {area: office.Name, district: office.District, state: office.State} : null;
}

// OpenStreetMap's free geocoder: pincode → coordinates. Returns null if it has no match.
async function lookupCoordinates(pincode) {
  try {
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/search?postalcode=${pincode}&countrycodes=in&format=json&limit=1`,
      {headers: {'User-Agent': 'AtiyaHerbsApp/1.0 (helpdesk@atiyaherbs.com)', 'Accept-Language': 'en'}},
    );
    const [hit] = res.data;
    return hit ? {lat: Number(hit.lat), lng: Number(hit.lon)} : null;
  } catch {
    return null;
  }
}

// Google's own road distances, the numbers Google Maps shows: the clinics are looked up by their full address
async function googleRoadDistances(from) {
  const places = CLINICS.map(c => c.address || `${c.lat},${c.lng}`).map(encodeURIComponent).join('|');
  const res = await axios.get(
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${from.lat},${from.lng}&destinations=${places}&units=metric&key=${GOOGLE_MAPS_API_KEY}`,
    {timeout: 10000},
  );
  const elements = res.data?.rows?.[0]?.elements;
  if (res.data?.status !== 'OK' || !Array.isArray(elements)) {
    throw new Error('Google could not answer');
  }
  const found = {};
  CLINICS.forEach((clinic, i) => {
    const metres = elements[i]?.status === 'OK' ? elements[i].distance?.value : undefined;
    if (typeof metres === 'number') {
      found[clinic.id] = metres / 1000;
    }
  });
  return found;
}

const OSRM_DRIVING = 'https://router.project-osrm.org/table/v1/driving';
const OSRM_WALKING = 'https://routing.openstreetmap.de/routed-foot/table/v1/foot';
const WALKING_RANGE_KM = 25; // walking routes are only looked up for clinics this close (straight line)

// One OSRM "table" call: the route distance from `from` to each of `clinics`, as {clinicId: km}; {} when it fails
async function osrmDistances(base, from, clinics) {
  try {
    const points = [from, ...clinics].map(p => `${p.lng},${p.lat}`).join(';');
    const res = await axios.get(`${base}/${points}?sources=0&annotations=distance`, {timeout: 10000});
    const row = res.data?.distances?.[0];
    if (res.data?.code !== 'Ok' || !Array.isArray(row)) {
      return {};
    }
    const found = {};
    clinics.forEach((clinic, i) => {
      const metres = row[i + 1];
      if (typeof metres === 'number' && metres >= 0) {
        found[clinic.id] = metres / 1000;
      }
    });
    return found;
  } catch {
    return {};
  }
}

/**
 * Distance by road, in km, from `from` ({lat, lng}) to every clinic: {clinicId: km}. Google's Distance Matrix when
 * GOOGLE_MAPS_API_KEY is set (matches Google Maps), otherwise one call to the public OSRM routing server. Either way
 * the position is sent to that service. Resolves to {} when nobody can answer, and the straight-line distance is
 * used instead.
 */
export async function fetchRoadDistances(from) {
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const found = await googleRoadDistances(from);
      if (Object.keys(found).length > 0) {
        return found;
      }
    } catch {
      // falls through to the free routing server
    }
  }
  // The shortest way: the car route (driving) and, for clinics close by, the walking route, which can use lanes and
  // footpaths and ignore one-way streets, so it is often shorter. The smaller distance is shown.
  const near = CLINICS.filter(clinic => distanceKm(from, clinic) <= WALKING_RANGE_KM);
  const [driving, walking] = await Promise.all([
    osrmDistances(OSRM_DRIVING, from, CLINICS),
    near.length > 0 ? osrmDistances(OSRM_WALKING, from, near) : {},
  ]);
  const found = {...driving};
  Object.entries(walking).forEach(([id, km]) => {
    if (found[id] === undefined || km < found[id]) {
      found[id] = km;
    }
  });
  return found;
}

/**
 * All clinics, nearest first when `from` ({lat, lng}) is known. Items are {clinic, km?}.
 * `road` ({clinicId: km}, from fetchRoadDistances) wins over the straight-line distance where it has the clinic.
 */
export function sortClinics(from, road = {}) {
  if (!from) {
    return CLINICS.map(clinic => ({clinic}));
  }
  return CLINICS.map(clinic => ({clinic, km: road[clinic.id] ?? distanceKm(from, clinic)})).sort((a, b) => a.km - b.km);
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
