const {test, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {createCallBackend} = require('../src');
const {MemoryStore} = require('../src/recordingStore');

const AGORA = {AGORA_APP_ID: '0123456789abcdef0123456789abcdef', AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210'};
const ENV = {...AGORA, INVITE_KEY: 'a-long-secret-invite-key-for-tests', PUBLIC_URL: 'https://calls.example.com'};

let server;
let url;
let clock;

const start = async (env = ENV) => {
  clock = 1_000_000;
  ({server} = createCallBackend(env, () => {}, {store: new MemoryStore(), now: () => clock}));
  server.listen(0);
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}`;
};
beforeEach(() => start());
afterEach(() => new Promise(resolve => server.close(resolve)));

const post = (path, body, headers = {}) =>
  fetch(`${url}${path}`, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body || {})});
const createInvite = () => post('/agora/invites', {}, {'x-invite-key': ENV.INVITE_KEY});
const codeOf = link => link.url.split('/join/')[1];

test('an invite needs the secret key', async () => {
  assert.equal((await post('/agora/invites', {})).status, 401);
  assert.equal((await post('/agora/invites', {}, {'x-invite-key': 'wrong'})).status, 401);
  assert.equal((await createInvite()).status, 201);
});

test('invites are switched off until both Agora and the key are set up', async () => {
  for (const env of [{...AGORA}, {INVITE_KEY: ENV.INVITE_KEY}]) {
    await new Promise(resolve => server.close(resolve));
    await start(env);
    assert.equal((await createInvite()).status, 503);
  }
});

test('an invite gives a host link and a guest link for the same room, using long random codes', async () => {
  const invite = await (await createInvite()).json();
  assert.match(invite.room, /^meet-/);
  assert.match(invite.host.url, /^https:\/\/calls\.example\.com\/join\/[\w-]{24}$/);
  assert.notEqual(invite.host.url, invite.guest.url);
  const other = await (await createInvite()).json();
  assert.notEqual(codeOf(other.host), codeOf(invite.host));
  assert.equal(new Date(invite.expiresAt).getTime(), clock + 60 * 60_000);
});

test('joining gives an Agora token for that room only, and never the certificate', async () => {
  const invite = await (await createInvite()).json();
  const res = await post(`/agora/join/${codeOf(invite.guest)}`, {name: 'Asha'});
  assert.equal(res.status, 200);
  const text = await res.text();
  const join = JSON.parse(text);
  assert.deepEqual([join.provider, join.appId, join.channel, join.name, join.role], ['agora', AGORA.AGORA_APP_ID, invite.room, 'Asha', 'guest']);
  assert.match(join.token, /^007/);
  assert.match(join.account, /^g-[0-9a-f]{12}$/);
  assert.equal(text.includes(AGORA.AGORA_APP_CERTIFICATE), false);

  const host = await (await post(`/agora/join/${codeOf(invite.host)}`, {})).json();
  assert.deepEqual([host.channel, host.role, host.name], [invite.room, 'host', 'Host']); // same room, own account
  assert.notEqual(host.account, join.account);
});

test('an unknown, expired or used-up link is refused', async () => {
  assert.equal((await post('/agora/join/not-a-real-code', {})).status, 404);

  const invite = await (await createInvite()).json();
  const code = codeOf(invite.guest);
  for (let i = 0; i < 4; i++) {
    assert.equal((await post(`/agora/join/${code}`, {})).status, 200);
  }
  assert.equal((await post(`/agora/join/${code}`, {})).status, 403); // used too many times

  clock += 61 * 60_000;
  assert.equal((await post(`/agora/join/${codeOf(invite.host)}`, {})).status, 410); // expired
  assert.equal((await post(`/agora/join/${codeOf(invite.host)}`, {})).status, 404); // and then forgotten
});

test('too many attempts from one address are slowed down', async () => {
  let last;
  for (let i = 0; i < 31; i++) {
    last = await post('/agora/join/guess', {});
  }
  assert.equal(last.status, 429);
});

test('the link opens the join page, which keeps no cache and loads the Agora browser SDK', async () => {
  const res = await fetch(`${url}/join/anything`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.match(html, /agora-rtc-sdk-ng@4\.\d+\.\d+\/AgoraRTC_N-production\.js/);
  assert.equal(html.includes(AGORA.AGORA_APP_CERTIFICATE), false);
});
