# Conference calls

A **conference call** is a one-to-one call that grows. During a call (voice or video) either person taps **Add person**,
types a mobile number (or picks a contact) and the new person's phone rings. When they accept, everybody is in one
group call, shown on the same call-style screen. It is **not** a meeting: there is no meeting id, no host, no chat and no
lock. It is separate from meetings (`docs/MEETINGS.md`) and they never share a room, a screen or a limit.

## How it works for the user

1. Two people are on a call. Either taps **Add person** (top right of the call screen) and enters a number.
2. The call turns into a conference. Both people move over **by themselves** (a few seconds of break while they move to
   the new room); the new person gets an **Accept / Decline** screen.
3. Anyone in the conference can add more people the same way, up to **100**.
4. Anyone can leave at any time. When only one person is left, the conference ends.
5. A voice call stays a voice conference; a video call stays a video conference (camera on at the start).

If the new person cannot be rung (not using the app, on another call, a meeting or a conference, ...) **nothing changes**
and the call goes on; the app says why.

## What it is not

- It is **not recorded**. Conference calls run on Agora, and Agora recording is not built. A recording running on the
  one-to-one call stops when it moves over.
- It uses **Agora's free minutes**, not LiveKit's.
- There is no host: everyone has the same rights. Nobody can remove or mute another person.
- The app must be open for the phone to ring (no push notifications yet).
- Who a person is rests on the mobile number the app sends (there is no OTP login yet).

## 100 people

The server allows up to 100 people (`CONFERENCE_MAX_PARTICIPANTS`, never above 100). A phone cannot show 100 videos, so
the screen shows one big tile and a row of small ones for the first few people and a **+N** tile that opens the People
list; only the people on screen have their video downloaded, while everybody's **audio** is heard.

## Server (`call-backend/src/conferences.js`)

Client -> server (each has an ack `{ok, ...}` or `{ok: false, error}`):

| Event | What it does |
|---|---|
| `call:add {callId, to}` | On a one-to-one call: make it a conference and ring `to`. Both get `call:upgrade {callId, conferenceId}`, the call ends with reason `upgraded` |
| `conference:join {id}` | Accept an invitation, move over from a call, or come back after a dropped connection. Only people who were added can join |
| `conference:leave {id}` | Leave |
| `conference:state {id, muted?, cameraOn?}` | Your mic and camera, shown to the others |
| `conference:invite {id, to}` | Anyone in it: ring a number |
| `conference:decline {id}` / `conference:cancel-invite {id, userId}` | The person rung says no / the person who rang stops the ringing |
| `conference:token {id}` | A fresh Agora token (the app asks before the 4-hour token runs out) |

Server -> client: `conference:update` (full list of people and who is being rung), `conference:invitation`,
`conference:invitation-ended`, `conference:invite-result` (`declined` or `no-answer`), `conference:ended`
(`alone` or `empty`).

Errors: `not-found`, `ended`, `not-in-conference`, `in-conference`, `in-call`, `full`, `self`, `already-in`,
`already-invited`, `offline`, `busy`, `slow-down`, `not-configured` (Agora keys missing), `not-active` (the call is not
connected yet).

Busy rules: a person in a conference cannot start or get a call, join a meeting or be rung into another conference, and
the other way round. They show as busy in the list of people online.

Settings (all optional, in `call-backend/.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `CONFERENCE_MAX_PARTICIPANTS` | 100 | People in one conference (capped at 100) |
| `CONFERENCE_INVITE_SECONDS` | 45 | How long an added person's phone rings |
| `CONFERENCE_INVITES_PER_MINUTE` | 20 | How many people one person may ring per minute |
| `CONFERENCE_RECONNECT_GRACE_MS` | 20000 | How long a dropped connection keeps its place |
| `CONFERENCE_KEEP_ENDED_MS` | 600000 | How long an ended conference is remembered |

`/health` shows `conferences` (live ones) next to `meetings` and `calls`.

Conferences are kept in server memory (nothing is saved to a database). If the server restarts, a running conference
ends; the apps notice and close it.

## Tests

- Server: `call-backend/test/conferences.test.js` (23 tests: the call becomes a conference, either person can add,
  everybody in one room with their own token, accept / decline / no answer / cancel, every refusal reason, busy rules
  with meetings and calls, being left alone ends it, reconnecting, token renewal, the 100-person limit, rate limit).
- App: `__tests__/conference/`.
