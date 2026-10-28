# Voice and video calls with LiveKit

Audio and video go through **LiveKit** (WebRTC). A small Node.js backend (`call-backend/`) rings the
other phone (Socket.IO) and gives each person a short-lived LiveKit token for that call's own room.
The LiveKit API secret lives only in the backend, never in the app.

```
Phone A ◄── Socket.IO: ring / accept / reject / end ──► call-backend ──► makes LiveKit tokens
Phone A ◄════════ audio + video (WebRTC) via LiveKit Cloud ════════► Phone B
```

LiveKit Cloud also does TURN relaying, so calls work on mobile data and strict networks without
running your own TURN server.

## Where things are

| Part | File |
|---|---|
| Ringing + tokens | `call-backend/src/signaling.js`, `call-backend/src/livekitToken.js` |
| Call logic (join room, mute, speaker, camera, history) | `src/context/CallContext.js` |
| Call screen (incoming / outgoing / in-call) | `src/components/CallOverlay.js` |
| Calls list + "New call" | `src/screens/CallsScreen.js` (Home → Ask Expert) |
| Backend address | `src/config/calls.js` |
| LiveKit setup | `index.js` (`registerGlobals`), `MainApplication.kt` (`LiveKitReactNative.setup`) |

## Step 1: LiveKit project (once)

1. Sign up at cloud.livekit.io and create a project (the free "Build" plan).
2. Project **Settings → Keys**: create an API key. Note the **WebSocket URL** (`wss://….livekit.cloud`),
   the **API key** and the **API secret**.

## Step 2: Start the backend (PowerShell)

```powershell
cd C:\Users\HP\AtiyaHerbs\call-backend
npm install
Copy-Item .env.example .env
notepad .env          # fill LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
npm start
```

It prints `Phones on this Wi-Fi can use: http://<ip>:4000`. Open `http://localhost:4000/health`:
you should see `"livekitConfigured":true`.

## Step 3: Build and run the app

```powershell
cd C:\Users\HP\AtiyaHerbs
npx react-native start --reset-cache      # keep this window open
npx react-native run-android              # in a second window; native code changed, so rebuild
```

- **Emulator:** the app already points at `http://10.0.2.2:4000` (the emulator's name for your PC).
- **Real phone:** it must reach your PC. Same Wi-Fi as the PC, then set `DEV_BACKEND_URL` in
  `src/config/calls.js` to `http://<PC Wi-Fi IP>:4000`, and allow port 4000 in Windows Firewall
  (PowerShell as Administrator):
  `New-NetFirewallRule -DisplayName "Call backend" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private`

## Step 4: Make a call

Log in on two devices with **different mobile numbers** (Profile → Edit profile → mobile number).
Home → **Ask Expert** → the green button → type the other phone's number → Voice or Video.
The other phone rings (vibrates); Accept or Decline. In a call: Speaker, Camera (also switches a voice
call to video), Switch camera, Mute, End.

## Host the backend (so one APK works on any phone, any network)

The audio and video already run on LiveKit Cloud. Only the ringing backend needs to be on the internet,
with an `https://` address. Render's free plan works (no card, WebSockets and HTTPS included):

1. Put the project on GitHub (a private repo): `git add call-backend render.yaml docs`, `git commit`, `git push`.
2. render.com → sign up with GitHub → **New → Blueprint** → pick the repo (it reads `render.yaml`).
3. When asked, enter `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (the values from your `.env`).
4. You get an address like `https://atiyaherbs-calls.onrender.com`. Open `<address>/health`: it should show
   `"livekitConfigured":true`.
5. Keep it awake: Render's free server sleeps after ~15 minutes without web requests, and the next call
   would wait ~30-60 s. At uptimerobot.com add an HTTP monitor on `<address>/health` every 5 minutes.
6. Put the address in `src/config/calls.js` (`CALLS_BACKEND_URL`) and build the APK:

```powershell
cd C:\Users\HP\AtiyaHerbs\android
.\gradlew.bat assembleRelease
# android\app\build\outputs\apk\release\app-release.apk
```

Install that same APK on both phones, log in with different mobile numbers, and call.

## Tests

```powershell
npm test                                  # app, including the call flow with a fake LiveKit room
cd call-backend; npm test; cd ..          # backend: ringing and tokens
```

## What is not done yet (needed before many users)

1. **Anyone can claim any mobile number.** The backend trusts the number the app sends
   (`io.use(...)` in `signaling.js`, marked TODO). Verify numbers with an OTP at sign-up, have your
   backend issue a signed login token, and check it there. Tokens are already limited to the call's
   own room and to the two people in the call, but the identity itself isn't verified yet.
2. **Calls ring only while the app is open.** Ringing a closed app needs push notifications
   (Firebase Cloud Messaging, free) and a full-screen call notification.
3. **Login isn't remembered** when the app closes (`AuthContext.js` TODO), so users must log in again
   to receive calls.
4. **Host the backend with HTTPS.** Release builds block plain `http://`. Put `call-backend/` on any
   Node.js host with a domain and HTTPS, then set `CALLS_BACKEND_URL` in `src/config/calls.js`.
5. **Release signing:** the APK is signed with the debug key; make your own keystore for Play Store.
6. The ringing is a vibration only; add a ringtone if you want one.
7. LiveKit Cloud's free plan has monthly limits. Check its current limits, and consider self-hosting
   LiveKit if you outgrow them.
