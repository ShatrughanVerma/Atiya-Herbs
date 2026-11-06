# Group video meetings (Agora)

Zoom / Google Meet style meetings: many people in **one meeting room** (one Agora channel), each with their own video,
with chat, a people list, and host controls. It is separate from the one-to-one LiveKit calls, which are unchanged.

## 1. How it fits together

```
 Phone A  <-- Socket.IO -->  call-backend (Render)  <-- Socket.IO -->  Phone B, C, D ...
    |                        meetings.js: who is in, chat,                  |
    |                        host powers, Agora tokens                      |
    +========= video and audio (Agora RTC, one channel per meeting) =======+
```

- **Meeting room = one Agora channel** named `mtg-<meeting id>`. Everyone who joins the meeting joins that channel.
- The **server** (`call-backend/src/meetings.js`) keeps the live state: who is in, who is host, the chat, who is
  sharing a screen. It makes each person's **Agora token** with the App Certificate, which never leaves the server.
- The **app** (`src/meetings/`) joins the channel with the token the server gave, draws the grid, and sends the
  person's actions (mute, chat, host controls) to the server over the **same Socket.IO connection** the calls use.
- Video and audio go **straight between phones and Agora**, not through the server.

## 2. Using it

| Who | Does what |
|---|---|
| Anyone logged in (with a mobile number) | Calls screen -> the people icon (top right) -> **Meetings** |
| Host | **Start meeting** (a name is optional). The meeting id looks like `abc-defg-hij` |
| Host | Share the id or the link (the share icon on the meeting screen): `atiyaherbs://meeting/abc-defg-hij` |
| Others | **Join with a meeting id**, or open the link on their phone (the app asks to join) |

In the meeting: mic, camera, switch camera, speaker/earpiece, **share screen** (Android), **People**, **Chat**, leave.
The top bar shows the name, id, **timer** and how many are in. The person who is talking gets an orange frame.
A meeting starts with the **camera off**. Up to **8 tiles + a "+N more" tile** are drawn; everyone is in the People list.

### Adding people by mobile number

Anyone in a meeting can **add a person by mobile number**: People -> **Add people by mobile number**, type the number
(or pick a contact) and tap Add. That person's phone **rings** with an **Accept / Decline** screen (like an incoming
call). Accept joins the meeting; Decline, or no answer for 45 seconds, tells whoever rang. Everyone sees the person as
"Ringing..." in the People list, and whoever rang (or the host) can stop the ringing.

- If the person cannot be rung (not using the app right now, on a call, meeting or conference, ...) the app says why.
- Locked meetings: only the host can ring someone. A person the host rang may enter even though it is locked.
- Adding a person to a one-to-one **call** is a different feature: it makes a **conference call**, not a meeting
  (see `docs/CONFERENCE.md`). Meetings and conference calls are separate and do not share rooms or screens.

### Host controls
Only the host (the person who started it, or the longest-standing person if the host leaves) can:
**mute one person or everyone**, **remove** someone (they cannot rejoin), **lock** the meeting (no new people), and
**end it for everyone**. The server refuses these from anyone else.

### Rules the server keeps
- One meeting at a time per person, and **not while on a one-to-one call** (and the other way round: someone in a
  meeting shows as busy to callers). Meetings do not change how LiveKit calls work.
- At most `MEETING_MAX_PARTICIPANTS` (25) people; the host may ask for fewer.
- One person shares their screen at a time.
- A dropped connection keeps your place for 20 seconds; coming back (the app asks automatically) keeps your role.
- When the host leaves, the longest-standing person becomes the host. When the last person leaves, the meeting ends.

## 3. Server API

Everything the app does goes over Socket.IO (each call has an acknowledgement `{ok, ...}` or `{ok:false, error}`),
because the app already has that connection and the live state is real-time. There is one HTTP route for links.

| Event (phone -> server) | Meaning |
|---|---|
| `meeting:create {title?, maxParticipants?}` | Make a meeting and join it as host. Returns the meeting, **Agora join details**, chat |
| `meeting:join {id}` | Join by id (also used to come back after a drop) |
| `meeting:leave {id}` / `meeting:end {id}` | Leave / end for everyone (host) |
| `meeting:state {id, muted?, cameraOn?}` | Your mic and camera, shown to the others |
| `meeting:chat {id, text}` | Chat (max 1000 characters, 8 messages per 10 seconds) |
| `meeting:mute {id, userId or 'all'}` | Host: ask someone to mute |
| `meeting:remove {id, userId}` | Host: take someone out |
| `meeting:lock {id, locked}` | Host: lock or unlock |
| `meeting:share {id, sharing}` | Start / stop sharing (one at a time) |
| `meeting:invite {id, to}` | Anyone in it: ring a mobile number to join |
| `meeting:decline {id}` / `meeting:cancel-invite {id, userId}` | The person rung says no / whoever rang stops the ringing |
| `meeting:token {id}` | A fresh Agora token (the app asks before the 4-hour token runs out) |
| `meeting:info {id}`, `meeting:list` | What a link shows; your recent meetings |

| Event (server -> phone) | Meaning |
|---|---|
| `meeting:update` | The whole picture (title, host, locked, people, who shares), on every change |
| `meeting:chat`, `meeting:mute-request`, `meeting:removed`, `meeting:ended` | Chat message; host asks you to mute; you were removed; it is over |
| `meeting:invitation`, `meeting:invitation-ended`, `meeting:invite-result` | You are being rung; the ringing stopped; what happened to someone you rang (`declined`, `no-answer`) |

**HTTP:** `GET /meetings/<id>` returns the public basics (title, host name, live or ended, locked, how many people).
It never returns a token. `/health` now also shows how many meetings are live.

Errors: `not-found`, `ended`, `removed`, `locked`, `full`, `in-call`, `in-meeting`, `not-in-meeting`, `host-only`,
`busy` (someone else is sharing, or the person rung is on a call or in a meeting), `slow-down`, `not-configured`
(Agora keys missing), and for adding people: `self`, `offline`, `already-in`, `already-invited`, `not-active`.

## 4. Database

Meeting records use the same store as call recordings (`call-backend/src/recordingStore.js`): **Cloudflare D1** when
`CF_ACCOUNT_ID`, `D1_DATABASE_ID` and `CF_API_TOKEN` are set, otherwise **memory** (lost on restart).

**Migration** = the new `CREATE TABLE IF NOT EXISTS` statements in `SCHEMA`; the server runs them when it starts
(safe to run again).

| Table | Columns |
|---|---|
| `meetings` | `id`, `title`, `host_id`, `host_name`, `max_participants`, `status` (live/ended), `locked`, `created_at`, `ended_at`, `ended_by`, `peak_participants` |
| `meeting_participants` | `id`, `meeting_id`, `user_id`, `name`, `role`, `joined_at`, `left_at`, `removed` |

**Not stored:** the chat text (it lives in server memory for the meeting only, last 200 messages) and who is online
right now (live state is in memory). A server restart ends live meetings.

## 5. Settings (Render environment)

Needs `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` (same as the browser links). Optional:

| Variable | Default | Meaning |
|---|---|---|
| `MEETING_MAX_PARTICIPANTS` | 25 | Most people in one meeting (cap 100) |
| `MEETING_RECONNECT_GRACE_MS` | 20000 | How long a dropped connection keeps its place |
| `MEETING_CREATE_PER_HOUR` | 10 | Meetings one person may start per hour |
| `MEETING_KEEP_ENDED_MS` | 3600000 | How long an ended meeting is remembered |
| `MEETING_INVITE_SECONDS` | 45 | How long a person's phone rings when added |
| `MEETING_INVITES_PER_MINUTE` | 10 | How many people one person may ring per minute |

## 6. App and platform setup

| What | Where |
|---|---|
| Screens, state, Agora wrapper | `src/meetings/` (`MeetingsScreen`, `MeetingRoom`, `MeetingContext`, `meetingAgora`, `meetingLayout`) |
| Mounted above every screen | `App.js` (`MeetingProvider`, `MeetingRoom`) |
| Entry | `src/calling/CallsScreen.js` (people icon), route `Meetings` in `src/navigation/AppNavigator.js` |
| Shared connection | `src/calling/CallContext.js` exposes its `socket` (no other change to calls) |
| **Android** | Camera / microphone permissions were already there. The meeting link `atiyaherbs://meeting/...` is in `AndroidManifest.xml`. **Screen sharing**: Agora's own `full-screen-sharing` library adds the foreground-service permissions and the `mediaProjection` service automatically; the app now keeps `libagora_screen_capture_extension.so` (it had been left out to save size) |
| **iOS** | `Info.plist`: camera and microphone texts mention meetings, and the `atiyaherbs://` link scheme is added. **Not built or tested** (this machine is Windows). Screen sharing is **not** offered on iOS (it needs a separate Broadcast Upload extension) |

Commands:
```
npm install                      # react-native-agora is already a dependency
cd call-backend && npm install   # agora-token is already a dependency
npm test                         # app tests
cd call-backend && npm test      # server tests
cd android && gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
```

## 7. Tests

- **Server** (`call-backend/test/meetings.test.js`, 39 tests, real Socket.IO clients, up to 6 people in one meeting):
  create/join/leave/end, host transfer, chat and history, rate limits, mute/remove/lock, full and locked meetings,
  one screen sharer at a time, reconnect and grace period, token renewal, the link info route, recent meetings, the
  database records, and that **LiveKit one-to-one calls still work** next to a live meeting (and the busy rules).
  Adding people: ringing, accept, decline, no answer, cancel, every refusal reason, locked and full meetings, and a
  one-to-one call becoming a meeting with a third person (either person can add; nothing changes if the number cannot
  be rung). The whole server suite is 109 tests (the 70 older ones, including all LiveKit call tests, are unchanged).
- **App** (`__tests__/meetings/` and `__tests__/calling/`, 74 new tests): grid layout for 1-20 people on several screen sizes, the meeting logic with
  a fake server and a fake Agora engine for **three people** (video, mute, speaking, chat, host controls, removal,
  end, reconnect, token renewal, screen sharing, links, errors), and the meeting screen. The call screen's Add person button and the call-to-meeting move are tested too. The whole app suite is 139.

## 8. What is NOT proven, and limits (please read)

- **No test with three real phones yet.** The tests use real Socket.IO clients on the server and a fake Agora engine in
  the app. Real audio and video between three devices, the real video views, and Android screen sharing have to be
  checked on devices (checklist below).
- **Removing someone is cooperative.** The server takes the person out of the meeting list, tells their app to leave,
  and refuses to let them back in. A modified app could ignore that and stay in the Agora channel, because stopping it
  for real needs Agora's server-side "kick" API (Agora RESTful credentials). Not done.
- **Muting someone is a request** the app obeys; Agora does not let a phone mute another phone.
- **The host's power rests on the mobile number the app sends.** There is no verified login yet (OTP is not built), so
  anyone who connects with the host's number is treated as the host. This is the same weakness the calls have.
- **Meetings live in server memory.** A restart (Render's free plan also sleeps after 15 idle minutes) ends live
  meetings; the records of past meetings are kept only if D1 is set up.
- **Meetings are not recorded** (Agora cloud recording is paid and needs string-free user ids).
- **Free minutes:** every person's minutes count (6 people x 10 minutes = 60 minutes of Agora's 10,000 free minutes a month).
- **Phones:** 4 to 6 videos are comfortable; with more people, ask most of them to keep their camera off.
- **Screen sharing** sends the screen instead of the camera on one phone; whether other phones see it correctly in the
  tile has to be verified on devices. Android only.
- **No push notification** for a meeting: people join with the id or link. (App-closed ringing is not built for calls
  either.)

## 9. Test checklist with three phones

1. Phone A: Calls -> people icon -> Start meeting. Note the id.
2. Phones B and C: Join with the id. All three see three tiles and "3 in meeting".
   (Also try: phone A taps People -> Add people by mobile number and adds phone C's number; phone C rings with Accept /
   Decline.)
3. Everyone turns the camera on: each sees the other two. The talker gets an orange frame.
4. B sends a chat message: A and C see it; the chat badge shows on phones with the chat closed.
5. A (host): People -> Mute all; B and C are muted. Remove C: C is told, A and B see two people. C cannot rejoin.
6. B: Share screen. A sees the screen in B's tile. C (or A) tries to share: told someone else is sharing.
7. A: Lock meeting; D cannot join. Unlock.
8. A leaves (not End): B becomes host. B: End for all: everyone is told.
9. On two phones, make a normal call (LiveKit). On either, tap **Add person**, enter a third phone's number: the third
   rings, and both on the call move into one group call without redialling. Decline on the third phone: the others see
   "declined".
10. During a meeting, try to start a call to someone in it: they show as busy. Then make a normal call between two
   people who are not in the meeting: LiveKit works as before.
11. Switch a phone from Wi-Fi to mobile data: "Reconnecting..." then back, still in the meeting.

## 10. Files changed or added

Added: `call-backend/src/meetings.js`, `call-backend/test/meetings.test.js`, `src/meetings/*` (8 files, including
`AddPersonCard.js` and `MeetingInvite.js`),
`__tests__/meetings/*` (2 files), `docs/MEETINGS.md`.
Changed: `call-backend/src/index.js`, `signaling.js` (busy rule and the new `call:add` event), `recordingStore.js` (tables and methods),
`.env.example`, `src/calling/CallContext.js` (exposes the socket, `call:upgrade`, `addPersonToCall`), `CallOverlay.js` (Add person button),
`CallsScreen.js` (button), `src/navigation/AppNavigator.js`,
`App.js`, `android/app/build.gradle`, `AndroidManifest.xml`, `ios/AtiyaHerbs/Info.plist`.
