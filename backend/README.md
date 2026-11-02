# Atiya Herbs API (backend)

The server behind the app: **mobile OTP login**, accounts, and the security base for everything that follows.
JavaScript (Node.js 22+), Express 5, Prisma 7 and **SQL Server**.

> Calling (ringing, LiveKit tokens, recording) still runs on the separate `call-backend/` server. This API
> is where the app's accounts live; calling will move onto it later so that only logged-in users can call.

## What is in it

| Folder | Job |
|---|---|
| `src/config/` | Settings from environment variables, checked at start-up |
| `src/auth/` | OTP login, access tokens (JWT), refresh tokens with rotation, role checks |
| `src/otp/` | Making, sending and checking one-time codes |
| `src/users/` | `GET/PATCH /users/me` |
| `src/audit/` | Security trail (logins, token theft, profile changes) |
| `src/health/` | `/health` and `/health/ready` for the hosting platform |
| `src/common/` | Errors, validation, rate limiting, crypto helpers |
| `prisma/` | Database schema and migrations |
| `db/` | One-time SQL Server setup script |
| `test/` | Tests (run against an in-memory fake database) |

## API (all under `/api/v1`)

| Method and path | Needs login | What it does |
|---|---|---|
| `POST /auth/otp/request` `{mobile}` | no | Sends a 6-digit code |
| `POST /auth/otp/verify` `{mobile, code, deviceName?}` | no | Checks the code; creates the account the first time; returns `accessToken` + `refreshToken` |
| `POST /auth/refresh` `{refreshToken}` | no | Swaps a refresh token for a new pair |
| `POST /auth/logout` `{refreshToken}` | no | Ends this login |
| `GET /users/me` | yes (`Authorization: Bearer <accessToken>`) | The logged-in user |
| `PATCH /users/me` `{name?, email?}` | yes | Changes name and email only |
| `GET /health`, `GET /health/ready` | no | Process up / database reachable |

## Run it on your PC (Windows PowerShell)

1. **Database (once).** Open `db\setup-sqlserver.sql` in SQL Server Management Studio, replace the two
   `CHANGE-ME` passwords, and run it as an administrator. It creates the `atiyaherbs` database and two logins.
2. **Settings.**

```powershell
cd C:\Users\HP\AtiyaHerbs\backend
npm install
Copy-Item .env.example .env
notepad .env        # DB passwords from step 1, plus two secrets (command inside the file)
```

3. **Create the tables and start.**

```powershell
npm run db:migrate:deploy     # applies prisma\migrations to the database
npm run dev                   # http://localhost:4100/api/v1/health
```

4. **Try login.** With `OTP_SENDER=dev` the code appears in the server window (no SMS). Set `OTP_DEV_ECHO=true`
   to get it in the response too while testing:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4100/api/v1/auth/otp/request -ContentType application/json -Body '{"mobile":"9876543210"}'
```

## Security in this API

- **OTP:** 6 digits from a secure random generator, valid 5 minutes, 5 tries, single use, only the newest code
  works. Stored only as an HMAC (with a server secret), never the code itself. 3 codes per number per 10 minutes.
  Every failure gives the same answer, so nothing leaks about who has an account.
- **Sessions:** 15-minute access tokens (JWT, algorithm pinned, issuer and audience checked). Refresh tokens are
  random, stored only as a SHA-256 hash, and rotate on every use. If an old one is replayed (stolen), the whole
  login is cancelled and the event is logged.
- **Access control:** the user always comes from the verified token, never from the request. Roles are
  `customer, doctor, distributor, moderator, admin` (`requireRole`). A user cannot change their own role.
- **Input:** every body is checked by a strict schema; unknown fields are rejected; bad values are never echoed back.
- **Database:** only Prisma (all values are parameters, no string-built SQL). The API login can read and write
  data but cannot change tables; migrations use a separate login.
- **Transport and headers:** Helmet security headers, no caching of API answers, CORS off unless listed, 100 KB
  request limit, rate limits per IP (global and stricter on login routes).
- **Errors and logs:** callers see only safe messages. Logs hold method, path, status and time, never bodies, tokens
  or codes. Phone numbers are masked (`******3210`) in the audit trail.
- **Start-up checks:** missing or weak secrets stop the server. Production refuses the development OTP sender,
  OTP echo, unencrypted database connections and trusted self-signed certificates.
- **Supply chain:** `npm audit` runs in CI (`.github/workflows/backend-ci.yml`).

## Before real users

1. **SMS provider.** `OTP_SENDER=sms` is a placeholder: production cannot send OTPs until a provider
   (MSG91, Twilio, ...) is written in `src/otp/otpSender.js`. It is paid per SMS.
2. **Host with HTTPS and a real SQL Server certificate** (`DB_ENCRYPT=true`, `DB_TRUST_SERVER_CERT=false`).
3. **Rate limits are in memory.** With more than one server, share them (a Redis store for `express-rate-limit`).
4. **Account deletion and data export** (Play Store and DPDP Act requirement) are not built yet.
5. **Admin panel** needs 2FA and an IP allow-list (see `docs/SYSTEM_PROMPT.md`).
6. Have the API tested by a security professional (VAPT) before launch.

## Tests, lint, Docker

```powershell
npm test         # 39 tests, no database needed
npm run lint
docker build -t atiyaherbs-backend .
```
