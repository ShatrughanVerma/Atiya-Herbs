# Recording server

Separate Windows server that receives call recording chunks from the live calling side, keeps them on its own disk,
joins them with FFmpeg into one MP4, and tracks everything in MySQL. It does not touch the calling infrastructure.

```
LiveKit side ──HTTPS + key──► PUT chunks ─► D:\recordings\chunks\<callId>\  (+ row in CallChunks)
                              POST finish ─► queue (CallRecordings.Status = pending)
Worker (same process) ─► verify chunks ─► ffmpeg concat ─► D:\recordings\final\<yyyy-mm>\<callId>.mp4
Node.js backend ──READ_KEY──► GET status / GET recording (MP4, Range supported)
```

## API

| Call | Key | What |
|---|---|---|
| `PUT /calls/:callId/tracks/:track/chunks/:seq` | INGEST_KEY | Body = raw chunk bytes. `track` is `av`, `audio` or `video`. Header `x-chunk-sha256` is checked (422 = damaged in transit, send again). Same chunk twice is stored once, so retrying is safe. 409 once the call is closed. |
| `POST /calls/:callId/finish` | INGEST_KEY | `{"expectedChunks": 120}` (optional). Queues the call for processing. |
| `GET /calls/:callId/status` | READ_KEY | status, chunk counts, missing chunks, error |
| `GET /calls/:callId/recording` | READ_KEY | the finished MP4 |
| `GET /health` | none | `{ok:true}` |

Send `Authorization: Bearer <key>`. Call ids may contain only letters, digits, `_` and `-`.

Status: `receiving` → `pending` → `processing` → `completed` / `partial` (some chunks missing or damaged) / `failed`.

## Missing and damaged chunks
- With `expectedChunks`, every number 0..n-1 must exist; without it, any gap below the highest number is a gap.
- Missing chunks are waited for (retry 30 s, 60 s, 120 s ...). On the last try the call is joined from what exists
  and marked `partial` (chunks are kept on disk). A damaged chunk (size or SHA-256 differs from arrival) is marked
  `corrupt` and skipped.
- ffmpeg or disk errors are retried the same way; after `MAX_ATTEMPTS` the call is `failed` with the reason in
  `CallRecordings.Error`, and the chunks stay on disk.
- A call with no new chunk for `IDLE_FINISH_SECONDS` and no `finish` is closed by itself.
- After a crash, calls left in `processing` are queued again on start.

## Windows setup
1. Install Node 22+, **FFmpeg** (static build, e.g. `C:\ffmpeg\bin`), and make a separate drive/volume `D:` for
   recordings. Turn on **BitLocker** for it.
2. MySQL 8: the server creates the database `recordings` and its tables itself on first start (from `sql/schema.sql`) if the
   MySQL user may create databases; otherwise create an empty database called `recordings` and give the user rights on it.
3. `copy .env.example .env`, fill both keys (32+ random characters, different from each other) and the MYSQL_* values.
4. Folder permissions: only the service account (and Administrators) may read `D:\recordings`:
   `icacls D:\recordings /inheritance:r /grant "NT SERVICE\AtiyaRecording:(OI)(CI)F" /grant "Administrators:(OI)(CI)F"`
5. Run as a Windows service with NSSM:
   `nssm install AtiyaRecording "C:\Program Files\nodejs\node.exe" "C:\recording-server\src\server.js"`
   then set the start folder to `C:\recording-server`, "Startup" = Automatic, and restart on failure.
   (`npm install --omit=dev` once in that folder.)
6. HTTPS: either put IIS (URL Rewrite + ARR) or Caddy in front with a certificate, keeping `HOST=127.0.0.1`, or set
   `TLS_KEY` / `TLS_CERT` and `HOST=0.0.0.0`. Chunk size can be large: set the proxy's request limit above `MAX_CHUNK_MB`.
7. Windows Firewall: allow inbound 443 only from the calling server's IP and the Node.js backend's IP.
8. Backup: Task Scheduler nightly `robocopy D:\recordings\final \\backup-host\recordings /MIR /R:2 /W:5` (or to another disk).
9. Logs: one JSON line per event in `LOG_DIR\recording-YYYY-MM-DD.log`. Watch for `failed for good`,
   `recordings drive is nearly full`, and `chunk checksum mismatch`.

## Test
`npm test` (FFmpeg is faked, MySQL is replaced by an in-memory store, so it needs neither).

## How the calling side sends chunks
`call-backend` has a forwarder (`call-backend/src/recordingServerArchiver.js`). LiveKit Egress still writes the 5-second
`.ts` chunks to the R2 staging bucket (it cannot write anywhere else); the forwarder then
- sends each new chunk here every few seconds during the call (`RECORDING_SERVER_LIVE_SECONDS`),
- after the call sends the rest, calls `finish` with the chunk count, and only then clears R2,
- if this server is down, leaves the chunks in R2 and the existing sweep (every few minutes) sends them again.

Turn it on in `call-backend/.env`: `RECORDING_SERVER_URL` (this server's HTTPS address) and `RECORDING_SERVER_KEY` (= INGEST_KEY here).
LiveKit Cloud and this server must be able to reach each other through the internet only for the call-backend → here hop;
call-backend must be able to open `RECORDING_SERVER_URL`. For a test on one PC use a tunnel (ngrok / Cloudflare Tunnel) or run both on the same machine with `http://127.0.0.1:5000`.

## Not built yet
- Routes in the main backend and screens in the app to list and play these recordings.
