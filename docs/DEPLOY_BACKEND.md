# Putting the Atiya Herbs API on the internet (so the app works without a USB cable)

Why this is needed: the app talks to the API at `localhost:4100`, which on a phone means the phone itself. A USB cable
(`adb reverse`) is the only thing that makes it reach the PC. Home Wi-Fi does not help when the PC and the phone are on
different networks (the PC here is on cable `10.20.60.x`, the phone on Wi-Fi `192.168.87.x`, and they cannot see each other).
So the API and its database must live on the internet, with an `https://` address.

```
Phone app  --https-->  Render (the API, backend/)  --SSL-->  Cloud MySQL (data AND videos)
Admin panel (website) --https-->  the same API
```

Everything secret (passwords, keys) is typed only in the dashboards of Render and the MySQL provider, never in the code,
in git or in a chat message.

## What you need (accounts, all can start free)

| What | Which | Cost note |
|---|---|---|
| Code on GitHub | your repo `Atiya-Herbs` | the code must be **pushed** before Render can build it |
| API hosting | Render (Web Service, Docker) | `starter` plan is always on; `free` sleeps and wakes in about a minute |
| MySQL | a cloud MySQL with SSL, for example Aiven or TiDB Cloud | **videos are stored inside MySQL**, so choose enough storage; a free plan fills up quickly |

## Step 1: the cloud MySQL

1. Create a MySQL service. Note: host, port, the admin user and its password.
2. Create the database `atiyaherbs` (utf8mb4).
3. Run `backend/db/setup-mysql.sql` with the provider's admin user (or its SQL console): it makes the two logins.
   Replace the two `CHANGE-ME` passwords with long random ones first (at least 20 characters). `atiya_app` can only read
   and change data (the API uses it). `atiya_migrator` may also change the tables (only the migration uses it).
4. If the provider does not let you run `CREATE USER`, make the two users in its panel with the same rights.

## Step 2: the secrets (make them on your own PC)

In PowerShell, three random values (each at least 32 characters). Copy each straight into Render, do not share them:

```powershell
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64url'));console.log('OTP_PEPPER='+c.randomBytes(48).toString('base64url'));console.log('INTERNAL_API_KEY='+c.randomBytes(48).toString('base64url'))"
```

## Step 3: create the tables in the cloud database (once, from your PC)

The migrations run from your PC against the cloud database. In PowerShell, in `backend\`, set the values for this one window
only (they are gone when you close it; nothing is saved in a file):

```powershell
cd C:\Users\HP\AtiyaHerbs\backend
$env:DB_HOST="<cloud host>"; $env:DB_PORT="<cloud port>"; $env:DB_NAME="atiyaherbs"; $env:DB_SSL="true"
$env:DB_USER="atiya_app"; $env:DB_PASSWORD="<app password>"
$env:MIGRATE_DB_USER="atiya_migrator"; $env:MIGRATE_DB_PASSWORD="<migrator password>"
npm run db:migrate:deploy
```

Then the starting data (clinics, doctors, shop) if you want it, in the same window:

```powershell
npm run db:seed
npm run db:seed-consultation
npm run db:import-shopify -- --file=products.json --hide-others
```

Make the first admin: sign up in the app, then change that account's `role_id` to `1` in the cloud database. Link the doctors
to their logins with the admin panel (Doctors → Create login).

## Step 4: Render

1. Render → New → **Blueprint** (it reads `render.yaml`) or New → Web Service → your repo → Runtime Docker,
   Dockerfile `./backend/Dockerfile`, context `./backend`.
2. In **Environment** fill the values the file leaves empty:

| Key | Value |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME` | from the cloud MySQL |
| `DB_USER`, `DB_PASSWORD` | `atiya_app` and its password (not the migrator) |
| `JWT_ACCESS_SECRET`, `OTP_PEPPER`, `INTERNAL_API_KEY` | the three values of step 2 |
| `PUBLIC_API_URL` | the address Render gives, like `https://atiyaherbs-api.onrender.com` |
| `CORS_ORIGINS` | the address of the admin panel website (later), comma separated |

`NODE_ENV=production`, `DB_SSL=true`, `OTP_SENDER=sms`, `VIDEO_STORAGE=database` are already set by `render.yaml`.
(`OTP_SENDER=dev` is refused in production. Password login needs no OTP, so nothing breaks; the OTP routes simply say
"not available".)

3. Deploy. When it is live, open `https://<your address>/api/v1/health/ready`: it must answer `{"status":"ok"}`.

## Step 5: build the app for that address

Tell Claude the Render address (it is not a secret). Then `src/config/api.js` gets
`PRODUCTION_API_URL = 'https://<address>/api/v1'` and a new release APK is built. That APK works on any phone and any
network, with no USB cable. (The `http` exception for localhost stays only for the developer's tests.)

## Step 6: the admin panel

Build it (`npm run build` in `AtiyaHerbsAdmin`), put the `dist` folder on a static host (Netlify, Vercel, Cloudflare Pages),
set `VITE_API_BASE_URL=https://<your address>/api/v1` before building, and put the panel's address in the API's
`CORS_ORIGINS` on Render.

## Things to know before real users

- **Videos are in MySQL.** A 500 MB video is 500 MB of database. Watch the storage, use `npm run videos:archive` every day
  (a Render Cron Job) and think about cloud file storage (S3) later (only `src/videos/storage.js` changes).
- **Render keeps no files** between restarts: that is why videos and everything else are in MySQL and nothing is written to
  the disk.
- **Backups:** switch on the automatic backups of the MySQL provider.
- **Call backend** (`atiyaherbs-calls`) is separate and already described in `docs/CALLS_LIVEKIT.md`.
- The app is signed with a **debug key**. For the Play Store a release key is needed (one-time, keep it safe).
- A privacy policy that mentions the recorded videos (who sees them, how long they are kept) is needed.
