const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');

const API = '/api/v1';
const KEY = 'internal-key-internal-key-internal-key-1234';
const ASHA = '9876543210';
const BILAL = '9123456780';
const CHANDNI = '9988776655';

const when = minutes => new Date(Date.UTC(2026, 10, 6, 10, minutes)).toISOString();

const callLog = (extra = {}) => ({
  kind: 'voice',
  callerMobile: ASHA,
  calleeMobile: BILAL,
  outcome: 'completed',
  startedAt: when(0),
  endedAt: when(5),
  durationSec: 300,
  ...extra,
});

const message = (extra = {}) => ({meetingId: 'abc-defg-hij', fromMobile: ASHA, fromName: 'Asha', text: 'hello', sentAt: when(1), ...extra});

describe('the internal routes (for call-backend only)', () => {
  test('do not exist unless INTERNAL_API_KEY is set', async () => {
    const t = buildTestApp();
    await request(t.app).post(`${API}/internal/call-logs`).set('X-Internal-Key', KEY).send({logs: [callLog()]}).expect(404);
  });

  test('need the shared secret, and a short secret stops the server from starting', async () => {
    const t = buildTestApp({INTERNAL_API_KEY: KEY});
    const body = {logs: [callLog()]};
    await request(t.app).post(`${API}/internal/call-logs`).send(body).expect(401);
    await request(t.app).post(`${API}/internal/call-logs`).set('X-Internal-Key', 'wrong').send(body).expect(401);
    await request(t.app).post(`${API}/internal/call-logs`).set('X-Internal-Key', `${KEY}x`).send(body).expect(401);
    await request(t.app).post(`${API}/internal/call-logs`).set('Authorization', 'Bearer abc').send(body).expect(401); // a user token is not the key
    expect(t.prisma.callLog.rows).toHaveLength(0);
    expect(() => buildTestApp({INTERNAL_API_KEY: 'too-short'})).toThrow(/INTERNAL_API_KEY/);
  });

  test('save call history once, even when the same call is sent again', async () => {
    const t = buildTestApp({INTERNAL_API_KEY: KEY});
    const send = logs => request(t.app).post(`${API}/internal/call-logs`).set('X-Internal-Key', KEY).send({logs});
    const first = await send([callLog({externalId: 'call-1'}), callLog({externalId: 'call-2', outcome: 'missed', durationSec: 0})]).expect(201);
    expect(first.body).toEqual({saved: 2, duplicates: 0});
    const again = await send([callLog({externalId: 'call-1'})]).expect(201);
    expect(again.body).toEqual({saved: 0, duplicates: 1});
    expect(t.prisma.callLog.rows).toHaveLength(2);
  });

  test('refuse bad rows: unknown fields, bad numbers, bad kind, too many', async () => {
    const t = buildTestApp({INTERNAL_API_KEY: KEY});
    const send = body => request(t.app).post(`${API}/internal/call-logs`).set('X-Internal-Key', KEY).send(body);
    await send({logs: [callLog({extra: 1})]}).expect(400);
    await send({logs: [callLog({callerMobile: '12345'})]}).expect(400);
    await send({logs: [callLog({kind: 'fax'})]}).expect(400);
    await send({logs: [callLog({startedAt: 'yesterday'})]}).expect(400);
    await send({logs: []}).expect(400);
    await send({logs: Array.from({length: 101}, (_, i) => callLog({externalId: `c${i}`}))}).expect(400);
    await request(t.app).post(`${API}/internal/meeting-messages`).set('X-Internal-Key', KEY).send({messages: [message({text: ''})]}).expect(400);
    expect(t.prisma.callLog.rows).toHaveLength(0);
  });
});

describe('call and meeting history for a person', () => {
  async function setup() {
    const t = buildTestApp({INTERNAL_API_KEY: KEY});
    const asha = await t.login(ASHA);
    const bilal = await t.login(BILAL);
    const chandni = await t.login(CHANDNI);
    const send = (path, body) => request(t.app).post(`${API}/internal/${path}`).set('X-Internal-Key', KEY).send(body).expect(201);
    await send('call-logs', {
      logs: [
        callLog({externalId: 'c1'}), // Asha calls Bilal
        callLog({externalId: 'c2', callerMobile: CHANDNI, calleeMobile: ASHA, kind: 'video', outcome: 'missed', durationSec: 0, startedAt: when(30), endedAt: null}),
        callLog({externalId: 'c3', callerMobile: BILAL, calleeMobile: CHANDNI, startedAt: when(40)}), // does not involve Asha
        // a meeting that Asha and Bilal were in (one row each)
        callLog({externalId: 'm-asha', kind: 'meeting', calleeMobile: null, meetingId: 'abc-defg-hij', title: 'Monthly check-in', startedAt: when(50), durationSec: 900}),
        callLog({externalId: 'm-bilal', kind: 'meeting', callerMobile: BILAL, calleeMobile: null, meetingId: 'abc-defg-hij', title: 'Monthly check-in', startedAt: when(50), durationSec: 800}),
        callLog({externalId: 'conf-asha', kind: 'conference', calleeMobile: null, meetingId: 'xyz-wxyz-ghj', startedAt: when(55), durationSec: 120}),
      ],
    });
    await send('meeting-messages', {
      messages: [
        message({externalId: 'x1', text: 'welcome everyone'}), // Asha to all
        message({externalId: 'x2', fromMobile: BILAL, fromName: 'Bilal', toMobile: ASHA, text: 'only for you', sentAt: when(2)}),
        message({externalId: 'x3', fromMobile: BILAL, fromName: 'Bilal', toMobile: CHANDNI, text: 'secret between us', sentAt: when(3)}),
        message({externalId: 'x4', fromMobile: ASHA, toMobile: BILAL, text: 'thanks Bilal', sentAt: when(4)}),
        message({externalId: 'x5', fromMobile: CHANDNI, fromName: 'Chandni', meetingId: 'zzz-zzzz-zzz', text: 'another meeting'}),
      ],
    });
    return {...t, asha, bilal, chandni};
  }

  test('need a login', async () => {
    const t = buildTestApp();
    for (const path of ['calls', 'meetings', 'meetings/abc-defg-hij/messages']) {
      await request(t.app).get(`${API}/history/${path}`).expect(401);
    }
  });

  test('calls: only my one-to-one calls, with the direction and the other person', async () => {
    const t = await setup();
    const res = await request(t.app).get(`${API}/history/calls`).set(t.bearer(t.asha)).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map(c => [c.direction, c.kind, c.peerMobile, c.outcome])).toEqual([
      ['incoming', 'video', CHANDNI, 'missed'], // newest first
      ['outgoing', 'voice', BILAL, 'completed'],
    ]);
    const chandni = await request(t.app).get(`${API}/history/calls`).set(t.bearer(t.chandni)).expect(200);
    expect(chandni.body.total).toBe(2); // her missed call to Asha and Bilal's call to her
  });

  test('meetings: the ones I took part in', async () => {
    const t = await setup();
    const res = await request(t.app).get(`${API}/history/meetings`).set(t.bearer(t.asha)).expect(200);
    expect(res.body.items.map(m => [m.kind, m.meetingId, m.title, m.durationSec])).toEqual([
      ['conference', 'xyz-wxyz-ghj', null, 120],
      ['meeting', 'abc-defg-hij', 'Monthly check-in', 900],
    ]);
    expect((await request(t.app).get(`${API}/history/meetings`).set(t.bearer(t.chandni))).body.total).toBe(0);
  });

  test('messages: what I sent, what was sent only to me, and what was sent to everyone', async () => {
    const t = await setup();
    const asha = await request(t.app).get(`${API}/history/meetings/abc-defg-hij/messages`).set(t.bearer(t.asha)).expect(200);
    expect(asha.body.items.map(m => [m.text, m.mine, m.private])).toEqual([
      ['welcome everyone', true, false],
      ['only for you', false, true],
      ['thanks Bilal', true, true],
    ]);
    expect(JSON.stringify(asha.body)).not.toContain('secret between us');
    expect(JSON.stringify(asha.body)).not.toContain(BILAL); // no phone numbers in chat rows

    const bilal = await request(t.app).get(`${API}/history/meetings/abc-defg-hij/messages`).set(t.bearer(t.bilal)).expect(200);
    expect(bilal.body.items.map(m => m.text)).toEqual(['welcome everyone', 'only for you', 'secret between us', 'thanks Bilal']);
  });

  test('someone who was not in the meeting gets nothing, even for a real meeting id', async () => {
    const t = await setup();
    await request(t.app).get(`${API}/history/meetings/abc-defg-hij/messages`).set(t.bearer(t.chandni)).expect(404);
    await request(t.app).get(`${API}/history/meetings/zzz-zzzz-zzz/messages`).set(t.bearer(t.asha)).expect(404);
    await request(t.app).get(`${API}/history/meetings/BAD%20ID/messages`).set(t.bearer(t.asha)).expect(400);
  });

  test('messages are paged', async () => {
    const t = await setup();
    const page = await request(t.app).get(`${API}/history/meetings/abc-defg-hij/messages?pageSize=2&page=2`).set(t.bearer(t.asha)).expect(200);
    expect(page.body).toMatchObject({page: 2, pageSize: 2, total: 3});
    expect(page.body.items).toHaveLength(1);
  });
});
