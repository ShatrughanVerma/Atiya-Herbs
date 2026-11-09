# Atiya Herbs API (backend)

The server behind the app: **mobile OTP login**, the **shop** (products, coupons, banners), **addresses**,
**orders** (cash on delivery), **call and meeting history**, and the security base for all of it.
JavaScript (Node.js 22+), Express 5, Prisma 7 and **MySQL 8**.

> Calling itself (ringing, LiveKit/Agora tokens, meetings, conferences) still runs on the separate `call-backend/`
> server. It can save call history and meeting chat here through the `/internal` routes (see below).

## What is in it

| Folder | Job |
|---|---|
| `src/config/` | Settings from environment variables, checked at start-up |
| `src/auth/` | OTP login, access tokens (JWT), refresh tokens with rotation, role checks |
| `src/otp/` | Making, sending and checking one-time codes |
| `src/users/` | `GET/PATCH/DELETE /users/me` |
| `src/catalog/` | Categories, concerns, products, banners, coupons (public reads, admin changes), and the seed |
| `src/addresses/` | Saved delivery addresses |
| `src/orders/` | Placing, listing and cancelling orders; admin status changes |
| `src/history/` | Call and meeting history for a person, and the `/internal` routes call-backend writes to |
| `src/audit/` | Security trail (logins, token theft, profile, orders, admin changes) |
| `src/health/` | `/health` and `/health/ready` for the hosting platform |
| `src/common/` | Errors, validation, paging, rate limiting, crypto helpers |
| `prisma/` | Database schema, migrations and the seed command |
| `db/` | One-time MySQL setup script |
| `test/` | Tests (run against an in-memory fake database, so no MySQL is needed) |

## API (all under `/api/v1`)

Login is `Authorization: Bearer <accessToken>`. "Admin" means a user whose `role` is `admin`.
Lists answer `{items, page, pageSize, total}` (`?page=1&pageSize=20`, at most 50 per page). Money is whole rupees.

**Login and account**

| Method and path | Login | What it does |
|---|---|---|
| `POST /auth/otp/request` `{mobile}` | no | Sends a 6-digit code |
| `POST /auth/otp/verify` `{mobile, code, deviceName?}` | no | Checks the code; creates the account the first time; returns `accessToken` + `refreshToken` |
| `POST /auth/refresh` `{refreshToken}` | no | Swaps a refresh token for a new pair |
| `POST /auth/logout` `{refreshToken}` | no | Ends this login |
| `GET /users/me` | yes | The logged-in user |
| `PATCH /users/me` `{name?, email?}` | yes | Changes name and email only |
| `DELETE /users/me` | yes | Deletes the account (see below). 409 while an order is on its way |
| `GET /health`, `GET /health/ready` | no | Process up / database reachable |

**Shop (public reads)**

| Method and path | What it does |
|---|---|
| `GET /categories`, `GET /concerns`, `GET /banners` | The lists the home screen needs |
| `GET /products?category=&concern=&q=&bestseller=&page=&pageSize=` | Active products. Best sellers first |
| `GET /products/:id` | One product (`inStock` only; the exact stock is private) |
| `POST /coupons/validate` `{code, subtotal}` | What the coupon would take off. One answer for every failure |

**Shop (admin only)**

| Method and path | What it does |
|---|---|
| `GET /admin/products` | Every product, also switched-off ones, with exact `stock` |
| `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` | Add, change, remove. A product that was ever ordered is switched off instead of deleted |
| `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` | Delete is refused while it still has products |
| `POST /banners`, `PATCH /banners/:id`, `DELETE /banners/:id` | Home banners |
| `GET /coupons`, `POST /coupons`, `PATCH /coupons/:code`, `DELETE /coupons/:code` | Coupons (percent, minimum, cap, expiry) |

**Addresses (login; always the caller's own)**

| Method and path | What it does |
|---|---|
| `GET /addresses`, `GET /addresses/:id` | List (default first) / one |
| `POST /addresses` | Add (max 10; the first one is the default) |
| `PATCH /addresses/:id`, `DELETE /addresses/:id` | Change / remove (removing the default promotes another) |
| `POST /addresses/:id/default` | Make this the default |

**Cart (login; the caller's own)**

The cart lives on the server, so it follows a person to a new phone. Only product ids and quantities are stored;
prices, stock and "still on sale" are read from the product each time. Every answer is the whole cart:
`{items, itemCount, subtotal, savings, hasIssues}`. A line has `quantity` (what will be ordered, never more than the
stock or 10), `requested` (only when it was cut down) and `issue`: `null`, `limited`, `out-of-stock` or
`unavailable`. Lines with the last two are left out of the totals.

| Method and path | What it does |
|---|---|
| `GET /cart` | The cart (reading never changes it) |
| `PUT /cart/items/:productId` `{quantity}` | Sets the exact quantity (0 to 10; 0 removes the line). Cut down to the stock. 404 for an unknown or switched-off product, 409 when sold out |
| `DELETE /cart/items/:productId` | Removes one line |
| `DELETE /cart` | Empties the cart |
| `POST /cart/merge` `{items:[{productId, quantity}]}` | Adds a guest's local cart after login: quantities are added up and cut to the stock; unknown, switched-off and sold-out products are skipped |

**Orders (login; the caller's own, cash on delivery only)**

| Method and path | What it does |
|---|---|
| `POST /orders` `{addressId, couponCode?, paymentMethod:"cod", items?:[{productId, qty}]}` | Places an order. Without `items` it is made from the person's server cart, and the cart is emptied in the same transaction (400 when the cart is empty). Prices, stock, coupon and total are worked out on the server; the stock is taken in one transaction |
| `GET /orders`, `GET /orders/:id` | My orders, newest first |
| `POST /orders/:id/cancel` | Only while `placed` or `confirmed`; puts the stock back |
| `GET /admin/orders?status=` | Admin: every order |
| `PATCH /admin/orders/:id/status` `{status}` | Admin: `placed → confirmed → shipped → delivered`, or `cancelled` before shipping |

There is no card, UPI or other online payment, and no card or billing data is stored anywhere.

**History (login; the caller's own)**

| Method and path | What it does |
|---|---|
| `GET /history/calls` | One-to-one voice and video calls (direction, other number, outcome, duration) |
| `GET /history/meetings` | Meetings and conference calls I took part in |
| `GET /history/meetings/:meetingId/messages` | The chat of a meeting as I saw it: what I sent, what was sent to me alone, and what was sent to everyone. Private messages between other people are never shown. 404 if I was not in the meeting |

## Run it on your PC (Windows PowerShell)

1. **Install MySQL 8** (once): <https://dev.mysql.com/downloads/installer/> (choose "MySQL Server") or
   `winget install Oracle.MySQL`. Remember the root password you set. (No MySQL on your PC? Use a free cloud
   MySQL, see the next section.)
2. **Create the database and the two logins (once).** Open `db\setup-mysql.sql`, replace the two `CHANGE-ME`
   passwords, then:

```powershell
cd C:\Users\HP\AtiyaHerbs\backend
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "source db/setup-mysql.sql"
```

3. **Settings.**

```powershell
npm install
Copy-Item .env.example .env
notepad .env        # DB passwords from step 2, plus the two secrets (the command to make them is inside the file)
```

4. **Create the tables, load the sample shop, start.**

```powershell
npm run db:migrate:deploy     # applies prisma\migrations to the database (uses the MIGRATE_DB_* login)
npm run db:seed               # loads the app's sample catalog; safe to run again
npm run db:import-shopify     # optional: copies the real products of atiyaherbs.com (see below)
npm run dev                   # http://localhost:4100/api/v1/health/ready
```

5. **Try login.** With `OTP_SENDER=dev` the code appears in the server window (no SMS). Set `OTP_DEV_ECHO=true`
   to get it in the response too while testing:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4100/api/v1/auth/otp/request -ContentType application/json -Body '{"mobile":"9876543210"}'
Invoke-RestMethod http://localhost:4100/api/v1/products
```

To make yourself an admin (the API cannot do it, on purpose), run once in MySQL:
`UPDATE users SET role = 'admin' WHERE mobile = '9876543210';` then log in again.

## A cloud MySQL for Render (free options)

Render has no free MySQL, so the database lives elsewhere and Render connects to it over the internet:

- **Aiven for MySQL** (free plan) or **TiDB Cloud Starter** (free, MySQL compatible) or **Railway** (small monthly
  credit). Create the database there, then copy host, port, user and password from its panel.
- Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` and **`DB_SSL=true`** on Render. Cloud MySQL needs
  an encrypted connection, and production refuses `DB_SSL=false` for a database on another machine.
- Run the migration once from your PC against the cloud database: put the cloud values in `.env`
  (`MIGRATE_DB_USER` / `MIGRATE_DB_PASSWORD` can be the provider's admin user), then
  `npm run db:migrate:deploy` and `npm run db:seed`.
- If the provider only gives one user, leave `MIGRATE_DB_*` empty (the same login is used) and keep that user's
  password only in Render and your own `.env`.
- Never paste passwords into chat or commit `.env`.

## Importing the real products of atiyaherbs.com

The company site is a Shopify store and its product list is public (`https://atiyaherbs.com/products.json`).
`npm run db:import-shopify` copies it into the `products` table:

```powershell
npm run db:import-shopify -- --dry-run     # only reads the site and shows a count and a sample; saves nothing
npm run db:import-shopify                  # saves the products
npm run db:import-shopify -- --hide-others # also switches the sample products (from db:seed) off, deletes nothing
```

- Matched by the product handle, so running it again updates and never duplicates. A product already in the database
  keeps its live **stock**, rating, badge and benefits; only name, prices, photos, text, size and category are refreshed.
- The public list has no stock numbers: a new product listed as available gets `--default-stock=N` (default 100),
  a sold-out one gets 0. Set the real stock afterwards.
- `product_type`, tags and the title are mapped onto the app's categories and concerns; an unknown product type becomes
  a new category.
- It is polite: a clear User-Agent, 3 s between pages, and a 429 ("too many requests") is waited out up to
  `--max-retries=3` times and then it stops with nothing saved. If the site keeps answering 429 to scripts, open
  `https://atiyaherbs.com/products.json?limit=250` in a browser, save the page as `products.json` and run
  `npm run db:import-shopify -- --file=products.json`.
- Photos stay on the company site's CDN (the database keeps only their links).

## Saving call history and meeting chat from call-backend

Not wired yet: this is the next step. Routes exist only when `INTERNAL_API_KEY` (32+ random characters) is set
on this API; call-backend then sends the same value in the header `X-Internal-Key`. Without the key they return 404.

`POST /api/v1/internal/call-logs`

```json
{"logs": [{
  "externalId": "call-<callId>",          // optional, any unique text: a retry never saves it twice
  "kind": "voice",                        // voice | video | conference | meeting
  "callerMobile": "9876543210",           // for a meeting or conference: the person this row is about
  "calleeMobile": "9123456780",           // null for a meeting or conference
  "meetingId": "abc-defg-hij",            // meeting or conference id, otherwise null
  "title": "Monthly check-in",            // optional
  "outcome": "completed",                 // completed | missed | declined | no-answer | cancelled | failed
  "startedAt": "2026-11-06T10:00:00Z",
  "endedAt": "2026-11-06T10:05:00Z",      // optional
  "durationSec": 300
}]}
```

A meeting or conference is saved as one row per person who took part (`externalId` such as
`<meetingId>:<mobile>:<startedAt>`). Up to 100 rows per request.

`POST /api/v1/internal/meeting-messages`

```json
{"messages": [{
  "externalId": "msg-<messageId>",
  "meetingId": "abc-defg-hij",
  "fromMobile": "9876543210", "fromName": "Asha",
  "toMobile": null,                       // a number = private message; null = to everyone
  "text": "hello",
  "sentAt": "2026-11-06T10:01:00Z"
}]}
```

Both answer `201 {saved, duplicates}`. Up to 50 messages per request.

## Account deletion

`DELETE /users/me` (an app-store and DPDP Act requirement) removes the person in one transaction: logins and saved
addresses are deleted; **orders stay for the shop's books** but lose the link to the person and the address copy; the
person's meeting chat is deleted; their number is blanked in other people's call history; the audit trail keeps its
rows but loses the link to the account. The number can sign up again later as a new person. A person with an order
that is placed, confirmed or shipped must wait (or cancel it) first.

## Security in this API

- **OTP:** 6 digits from a secure random generator, valid 5 minutes, 5 tries, single use, only the newest code
  works. Stored only as an HMAC (with a server secret), never the code itself. 3 codes per number per 10 minutes.
  Every failure gives the same answer, so nothing leaks about who has an account.
- **Sessions:** 15-minute access tokens (JWT, algorithm pinned, issuer and audience checked). Refresh tokens are
  random, stored only as a SHA-256 hash, and rotate on every use. If an old one is replayed (stolen), the whole
  login is cancelled and the event is logged.
- **Access control:** the user always comes from the verified token, never from the request. There is no route that
  takes a user id, so one person can never read or change another person's addresses, orders or history. Roles are
  `customer, doctor, distributor, moderator, admin` (`requireRole`). A user cannot change their own role.
- **Orders:** the client only says what it wants. Prices, stock, coupons and totals come from the database; the stock
  is taken with a conditional update inside a transaction, so the last item cannot be sold twice and a failed order
  takes nothing.
- **Input:** every body and query is checked by a strict schema; unknown fields are rejected; bad values are never
  echoed back.
- **Database:** only Prisma (all values are parameters, no string-built SQL). The API login can read and write
  data but cannot change tables; migrations use a separate login.
- **Internal routes:** a shared secret compared in constant time; they do not exist unless the secret is set.
- **Transport and headers:** Helmet security headers, no caching of API answers, CORS off unless listed, 100 KB
  request limit, rate limits per IP (global and stricter on login, orders and coupon routes).
- **Errors and logs:** callers see only safe messages. Logs hold method, path, status and time, never bodies, tokens
  or codes. Phone numbers are masked (`******3210`) in the audit trail.
- **Start-up checks:** missing or weak secrets stop the server. Production refuses the development OTP sender, OTP
  echo, and an unencrypted connection to a database on another machine.
- **Supply chain:** `npm audit` runs in CI (`.github/workflows/backend-ci.yml`).

## Before real users

1. **SMS provider.** `OTP_SENDER=sms` is a placeholder: production cannot send OTPs until a provider
   (MSG91, Twilio, ...) is written in `src/otp/otpSender.js`. It is paid per SMS.
2. **Host with HTTPS and an encrypted database connection** (`DB_SSL=true`).
3. **Rate limits are in memory.** With more than one server, share them (a Redis store for `express-rate-limit`).
4. **Connect the app and call-backend to this API** (the app still uses its built-in sample catalog and local
   orders; call-backend does not save history yet).
5. **Data export** (DPDP Act) is not built yet; account deletion is.
6. **Admin panel** needs 2FA and an IP allow-list.
7. Have the API tested by a security professional (VAPT) before launch.
8. The migration was generated from the schema and checked by hand, but only the in-memory tests ran against it:
   run `npm run db:migrate:deploy` on a real MySQL and try the API once before relying on it.

## Tests, lint, Docker

```powershell
npm test         # no database needed
npm run lint
docker build -t atiyaherbs-backend .
```
