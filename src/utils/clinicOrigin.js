import {fetchRoadDistances} from './clinicSearch';
import {getApproximateLocation, getCurrentLocation} from './location';

// Where the person is and how far every clinic is by road, found once when the app opens (and again when asked), so
// the clinic list is ready by the time it is shown.
//   {here: {lat, lng} | null, approx: boolean, error: string | null, road: {clinicId: km}, at: ms}
// `here` is the phone's own location; when that is off or not allowed it is a rough position from the internet
// connection (approx = true, error = why the phone's location failed).

const FRESH_MS = 5 * 60 * 1000; // a result this young is reused

let last = null;
let pending = null;

/** The latest result if it is still fresh, otherwise null. */
export const cachedClinicOrigin = () => (last && Date.now() - last.at < FRESH_MS ? last : null);

/** Finds the position and the road distances. `force` skips the saved result (the "try again" buttons). */
export function loadClinicOrigin(force = false) {
  if (!force) {
    const fresh = cachedClinicOrigin();
    if (fresh) {
      return Promise.resolve(fresh);
    }
  }
  if (pending) {
    return pending;
  }
  pending = (async () => {
    let here = null;
    let approx = false;
    let error = null;
    try {
      here = await getCurrentLocation();
    } catch (e) {
      error = e.message;
      try {
        here = await getApproximateLocation();
        approx = true;
      } catch {
        here = null;
      }
    }
    const road = here ? await fetchRoadDistances(here) : {};
    last = {here, approx, error, road, at: Date.now()};
    return last;
  })().finally(() => {
    pending = null;
  });
  return pending;
}
