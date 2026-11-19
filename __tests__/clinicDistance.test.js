import {fetchRoadDistances, formatDistance, sortClinics} from '../src/utils/clinicSearch';
import {CLINICS} from '../src/data/store';
import axios from 'axios';

const DELHI = {lat: 28.6139, lng: 77.209};

describe('clinic distances', () => {
  test('near clinics show in metres, the rest in km', () => {
    expect(formatDistance(0.7)).toBe('700 m');
    expect(formatDistance(0.0004)).toBe('1 m');
    expect(formatDistance(1)).toBe('1.0 km');
    expect(formatDistance(24.44)).toBe('24.4 km');
    expect(formatDistance(1164.3)).toBe('1,164.3 km');
  });

  test('straight-line distance is used when there is no road distance', () => {
    const list = sortClinics(DELHI);
    expect(list[0].clinic.id).toBe('karol-bagh'); // nearest first
    expect(list.every(item => typeof item.km === 'number')).toBe(true);
  });

  test('a road distance wins over the straight line, and the list is sorted by what is shown', () => {
    const list = sortClinics(DELHI, {hyderabad: 5, 'karol-bagh': 900});
    expect(list[0].clinic.id).toBe('hyderabad');
    expect(list[0].km).toBe(5);
    expect(list.find(i => i.clinic.id === 'karol-bagh').km).toBe(900);
  });

  test('fetchRoadDistances gives the shortest of the driving and walking routes, and {} when everything fails', async () => {
    const table = metres => ({data: {code: 'Ok', distances: [[0, ...metres]]}});
    const get = jest.spyOn(axios, 'get').mockImplementation(async url => {
      if (url.includes('/driving/')) {
        return table(CLINICS.map((_, i) => (i + 1) * 1000)); // clinic 0: 1 km, clinic 1: 2 km ...
      }
      // walking is only asked for the clinics close to Delhi; its answer for the first one is shorter, for the next longer
      const count = (url.match(/;/g) || []).length;
      return table(Array.from({length: count}, (_, i) => (i === 0 ? 400 : 99000)));
    });
    const found = await fetchRoadDistances(DELHI);
    expect(found['karol-bagh']).toBe(0.4); // the first clinic near Delhi: 400 m on foot beats 2 km by car
    expect(found[CLINICS[0].id]).toBe(1); // Lucknow is too far to walk: the driving distance
    expect(get.mock.calls.some(call => call[0].includes('routing.openstreetmap.de/routed-foot'))).toBe(true);

    get.mockRejectedValue(new Error('down'));
    expect(await fetchRoadDistances(DELHI)).toEqual({});
    get.mockRestore();
  });

  test('with a Google key, Google answers by address; if Google fails, the free server is used', async () => {
    jest.resetModules();
    jest.doMock('../src/config/api', () => ({GOOGLE_MAPS_API_KEY: 'test-key', API_BASE_URL: 'x', API_TIMEOUT_MS: 1}));
    const keyed = require('../src/utils/clinicSearch');
    const ax = require('axios');
    const get = jest.spyOn(ax, 'get');
    get.mockResolvedValueOnce({
      data: {status: 'OK', rows: [{elements: CLINICS.map((_, i) => ({status: 'OK', distance: {value: (i + 1) * 2000}}))}]},
    });
    const found = await keyed.fetchRoadDistances(DELHI);
    expect(get.mock.calls[0][0]).toContain('maps.googleapis.com/maps/api/distancematrix');
    expect(get.mock.calls[0][0]).toContain(encodeURIComponent(CLINICS[0].address));
    expect(found[CLINICS[0].id]).toBe(2);

    get.mockRejectedValueOnce(new Error('denied'));
    get.mockImplementation(async url =>
      url.includes('/driving/')
        ? {data: {code: 'Ok', distances: [[0, ...CLINICS.map(() => 7000)]]}}
        : {data: {code: 'NoRoute'}},
    );
    expect((await keyed.fetchRoadDistances(DELHI))[CLINICS[1].id]).toBe(7);
    get.mockRestore();
    jest.dontMock('../src/config/api');
  });
});
