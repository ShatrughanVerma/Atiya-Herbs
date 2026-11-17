const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createRecordingServerArchiver} = require('../src/recordingServerArchiver');

const ENV = {RECORDING_SERVER_URL: 'https://rec.example.com/', RECORDING_SERVER_KEY: 'k'.repeat(40), RECORDING_SERVER_ATTEMPTS: '3'};
const FOLDER = 'recordings/2026/11/call-1-1700000000000/';
const PLAYLIST = `${FOLDER}playlist.m3u8`;

// A stand-in for the R2 staging bucket
function fakeS3(files) {
  const sent = [];
  return {
    sent,
    files,
    async send(command) {
      const name = command.constructor.name;
      sent.push(name);
      if (name === 'ListObjectsV2Command') {
        return {Contents: Object.keys(files).filter(k => k.startsWith(command.input.Prefix)).map(Key => ({Key, Size: files[Key].length})), IsTruncated: false};
      }
      if (name === 'GetObjectCommand') {
        const data = files[command.input.Key];
        return {Body: {transformToByteArray: async () => new Uint8Array(data)}};
      }
      if (name === 'DeleteObjectsCommand') {
        command.input.Delete.Objects.forEach(o => delete files[o.Key]);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

// A stand-in for the Recording Server's HTTP API
function fakeServer({failFirst = 0, status = 201} = {}) {
  const calls = [];
  let failures = failFirst;
  const fetchFn = async (url, init) => {
    calls.push({url, method: init.method, headers: init.headers, body: init.body});
    if (failures > 0 && init.method === 'PUT') {
      failures -= 1;
      return new Response('{"error":"store_failed"}', {status: 500});
    }
    return new Response('{"ok":true}', {status: init.method === 'PUT' ? status : 202});
  };
  return {fetchFn, calls};
}

const chunks = () => ({
  [PLAYLIST]: Buffer.from('#EXTM3U'),
  [`${FOLDER}part_00000.ts`]: Buffer.from('aaa'),
  [`${FOLDER}part_00001.ts`]: Buffer.from('bbb'),
  [`${FOLDER}part_00002.ts`]: Buffer.from('ccc'),
});

const make = (files, server, extra = {}) =>
  createRecordingServerArchiver({env: {...ENV, ...extra}, s3: fakeS3(files), fetchFn: server.fetchFn, sleepFn: async () => {}});

test('is only available when the URL and key are set', () => {
  assert.equal(createRecordingServerArchiver({env: {}}).available, false);
  assert.equal(createRecordingServerArchiver({env: ENV}).available, true);
});

test('sends every chunk with its checksum and key, then says finish with the count, then clears R2', async () => {
  const files = chunks();
  const server = fakeServer();
  const archiver = make(files, server);
  const result = await archiver.archive({bucket: 'b', objectKey: PLAYLIST, callId: 'call-1', mode: 'video'});

  assert.equal(result.ok, true);
  assert.equal(result.destination, 'recording-server');
  assert.equal(result.chunks, 3);

  const puts = server.calls.filter(c => c.method === 'PUT');
  assert.deepEqual(
    puts.map(c => c.url),
    [0, 1, 2].map(n => `https://rec.example.com/calls/call-1-1700000000000/tracks/av/chunks/${n}`),
  );
  assert.ok(puts.every(c => c.headers.Authorization === `Bearer ${ENV.RECORDING_SERVER_KEY}` && /^[0-9a-f]{64}$/.test(c.headers['x-chunk-sha256'])));

  const finish = server.calls.find(c => c.method === 'POST');
  assert.equal(finish.url, 'https://rec.example.com/calls/call-1-1700000000000/finish');
  assert.deepEqual(JSON.parse(finish.body), {expectedChunks: 3});
  assert.deepEqual(Object.keys(files), []); // staging cleared
});

test('a failed chunk upload is retried', async () => {
  const server = fakeServer({failFirst: 2});
  const result = await make(chunks(), server).archive({bucket: 'b', objectKey: PLAYLIST, callId: 'call-1', mode: 'video'});
  assert.equal(result.ok, true);
  assert.equal(server.calls.filter(c => c.method === 'PUT').length, 5); // 3 chunks + 2 retries
});

test('when the recording server stays down nothing is deleted and no finish is sent', async () => {
  const files = chunks();
  const server = fakeServer({failFirst: 99});
  const result = await make(files, server).archive({bucket: 'b', objectKey: PLAYLIST, callId: 'call-1', mode: 'video'});
  assert.deepEqual(result, {ok: false, error: 'send-failed'});
  assert.equal(Object.keys(files).length, 4); // all still in R2, the sweep will try again
  assert.equal(server.calls.some(c => c.method === 'POST'), false);
});

test('a chunk the server already has because the call was finished is counted as delivered', async () => {
  const fetchFn = async (url, init) =>
    init.method === 'PUT' ? new Response('{"error":"call_closed"}', {status: 409}) : new Response('{"ok":true}', {status: 202});
  const result = await createRecordingServerArchiver({env: ENV, s3: fakeS3(chunks()), fetchFn, sleepFn: async () => {}}).archive({
    bucket: 'b',
    objectKey: PLAYLIST,
    callId: 'call-1',
    mode: 'video',
  });
  assert.equal(result.ok, true);
});

test('a wrong key is not retried', async () => {
  const server = {calls: [], fetchFn: async () => new Response('{"error":"unauthorized"}', {status: 401})};
  const result = await make(chunks(), server).archive({bucket: 'b', objectKey: PLAYLIST, callId: 'call-1', mode: 'video'});
  assert.equal(result.ok, false);
});

test('audio (one .ogg file) is sent as chunk 0 of the audio track', async () => {
  const files = {'recordings/2026/11/call-2-1700000000001.ogg': Buffer.from('ogg-bytes')};
  const server = fakeServer();
  const result = await make(files, server).archive({bucket: 'b', objectKey: 'recordings/2026/11/call-2-1700000000001.ogg', callId: 'call-2', mode: 'audio'});
  assert.equal(result.ok, true);
  assert.equal(server.calls[0].url, 'https://rec.example.com/calls/call-2-1700000000001/tracks/audio/chunks/0');
  assert.deepEqual(JSON.parse(server.calls[1].body), {expectedChunks: 1});
});

test('a recording with no chunks reports no-segments', async () => {
  const result = await make({[PLAYLIST]: Buffer.from('#EXTM3U')}, fakeServer()).archive({bucket: 'b', objectKey: PLAYLIST, callId: 'call-1', mode: 'video'});
  assert.deepEqual(result, {ok: false, error: 'no-segments'});
});

test('live forwarding sends new chunks during the call and archive() does not send them twice', async () => {
  const files = chunks();
  const server = fakeServer();
  let tick;
  const archiver = createRecordingServerArchiver({
    env: ENV,
    s3: fakeS3(files),
    fetchFn: server.fetchFn,
    sleepFn: async () => {},
    setTimer: fn => {
      tick = fn;
      return {unref() {}};
    },
    clearTimer: () => {},
  });
  archiver.watch({bucket: 'b', objectKey: PLAYLIST, mode: 'video'});
  await tick();
  assert.equal(server.calls.filter(c => c.method === 'PUT').length, 3);

  const result = await archiver.archive({bucket: 'b', objectKey: PLAYLIST, callId: 'call-1', mode: 'video'});
  assert.equal(result.ok, true);
  assert.equal(server.calls.filter(c => c.method === 'PUT').length, 3); // none repeated
  assert.deepEqual(JSON.parse(server.calls.find(c => c.method === 'POST').body), {expectedChunks: 3});
});
