# Atiya Herbs

Mobile app for the Atiya Herbs store (Unani and Ayurvedic medicines): shop, clinic locator, voice search,
and **voice and video calls** with optional **call recording**. React Native (CLI, JavaScript), Android first.

## Project layout

```
.
├── App.js, index.js            app entry (providers, LiveKit setup)
├── src/
│   ├── calling/                voice & video calls: context, call screen, Calls list, permissions, contacts, config
│   ├── navigation/             stacks and tabs
│   ├── screens/                Home, Explore, Clinic, Reels, Cart, Profile, auth/, shop/
│   ├── components/             shared UI (shop/ cards, headers, clinic locator)
│   ├── context/                Auth and Cart state
│   ├── data/                   catalog and store info (static data for now)
│   ├── utils/                  location, voice search, product filters, profile photo, Google sign-in
│   ├── config/                 Google sign-in settings
│   ├── theme/                  colours and spacing
│   └── assets/                 fonts, icons, images
├── backend/                    Node.js API (Express, Prisma, SQL Server): OTP login, accounts, security base
├── call-backend/               Node.js server: rings the other phone, makes LiveKit tokens, call recording
├── android/, ios/              native projects (Kotlin modules in android/.../voice and .../contacts)
├── __tests__/                  app tests (Jest); call-backend/test has the server tests
├── docs/                       plans and call documentation (see below)
└── render.yaml                 Render blueprint that hosts call-backend
```

## Run the app (Windows PowerShell)

```powershell
npm install
npx react-native start --reset-cache     # keep this window open
npx react-native run-android             # in a second window
```

Native code changed? Run `run-android` again (a reload is not enough).

## Run the call backend locally

```powershell
cd call-backend
npm install
Copy-Item .env.example .env              # then fill in your LiveKit keys
npm start
```

The app talks to `http://10.0.2.2:4000` in development (the emulator's name for your PC) and to the Render
address in release builds. Both are set in `src/calling/config.js`.

## Tests and checks

```powershell
npm test                                 # app tests
npx eslint .                             # lint
cd call-backend; npm test                # server tests
```

## Release APK

```powershell
cd android
.\gradlew.bat assembleRelease
# android\app\build\outputs\apk\release\app-release.apk
```

The APK is signed with the debug key; create your own keystore before publishing to Google Play.

## Documentation

| File | What it covers |
|---|---|
| `docs/CALLING_HOW_IT_WORKS.md` | The whole calling process step by step: ring, LiveKit/Agora, recording, browser links, settings, troubleshooting |
| `docs/CALLS_LIVEKIT.md` | How calls work and how to set them up (LiveKit, backend, hosting) |
| `docs/CALL_RECORDING.md` | Call recording: consent, R2, Cloudinary, Cloudflare D1 |
| `docs/CALLING_OVERVIEW.md` | What is used for calling and what is free, with limits |
| `docs/DEVELOPMENT_PLAN.md`, `docs/SYSTEM_PROMPT.md` | Product plan and engineering rules |

## Secrets

API keys and secrets live only in `call-backend/.env` (git-ignored) and in Render's Environment settings.
Never put them in the app or in git.
