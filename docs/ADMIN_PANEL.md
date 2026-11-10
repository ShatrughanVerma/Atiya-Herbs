# Atiya Herbs - Admin Panel (Doctor Consultation) - Design and API Guide

Status: **design, not built yet.** The "Exists" column below says what the backend already has. Everything marked
"To build" is the work for the backend admin module; the web panel (frontend) is built separately by the company
developer using this guide.

---

## 1. What it is

A web panel for the company staff to run the doctor consultation module of the Atiya Herbs app:

- see and handle appointment requests (confirm a time, complete, cancel)
- manage doctors, their photos, fees and weekly timetable
- manage clinics (address, phone, timings)
- give or take back discount credits
- see a small dashboard

It is a **separate web app** (`admin/`). It talks to the same backend as the mobile app (`backend/`) through the
same `/api/v1` API, with admin-only routes protected on the server.

```
 Mobile app (React Native)  --\
                                >--  Backend API (Express, /api/v1)  --  MySQL
 Admin panel (React + Vite)  --/
```

The panel never talks to the database directly. Every rule (who may do what, slot clashes, credits) is checked
in the backend, so a hand-made request cannot get around it.

---

## 2. Folder structure

### 2.1 Admin web panel (new): `admin/`

```
admin/
├─ package.json
├─ vite.config.js
├─ index.html
├─ .env.example                  # VITE_API_BASE_URL=http://localhost:4100/api/v1
├─ public/
│  └─ favicon.svg
└─ src/
   ├─ main.jsx                   # app start: router, query client, auth provider
   ├─ App.jsx                    # route table
   │
   ├─ api/                       # ALL calls to the backend live here, nothing else calls fetch
   │  ├─ client.js               # fetch wrapper: base URL, Bearer token, refresh on 401, error type
   │  ├─ auth.js                 # login, refresh, logout
   │  ├─ appointments.js
   │  ├─ doctors.js
   │  ├─ clinics.js
   │  ├─ credits.js
   │  ├─ users.js
   │  └─ dashboard.js
   │
   ├─ auth/
   │  ├─ AuthProvider.jsx        # who is logged in, role, login/logout
   │  ├─ RequireRole.jsx         # route guard: wrong role -> "not allowed" page
   │  └─ tokenStore.js           # where tokens are kept (see section 8)
   │
   ├─ layout/
   │  ├─ AppShell.jsx            # sidebar + top bar + page area
   │  ├─ Sidebar.jsx             # menu items depend on the role
   │  └─ Topbar.jsx
   │
   ├─ pages/
   │  ├─ LoginPage.jsx
   │  ├─ DashboardPage.jsx
   │  ├─ appointments/
   │  │  ├─ AppointmentsPage.jsx          # table + filters
   │  │  ├─ AppointmentDrawer.jsx         # one appointment: details + actions
   │  │  └─ ConfirmTimeDialog.jsx         # pick a free slot for a request
   │  ├─ doctors/
   │  │  ├─ DoctorsPage.jsx
   │  │  ├─ DoctorFormPage.jsx            # create / edit
   │  │  └─ TimetableEditor.jsx           # weekly timings
   │  ├─ clinics/
   │  │  ├─ ClinicsPage.jsx
   │  │  └─ ClinicFormPage.jsx
   │  ├─ credits/
   │  │  └─ CreditsPage.jsx               # find a user by mobile, give / take credits
   │  └─ NotFoundPage.jsx
   │
   ├─ components/                # small reusable pieces (no API calls inside)
   │  ├─ DataTable.jsx
   │  ├─ StatusBadge.jsx
   │  ├─ ConfirmDialog.jsx
   │  ├─ PhotoUpload.jsx
   │  └─ EmptyState.jsx
   │
   ├─ hooks/
   │  ├─ useDebounce.js
   │  └─ usePagination.js
   │
   ├─ utils/
   │  ├─ date.js                 # Indian time (IST) helpers - same rules as the app
   │  └─ format.js               # rupees, phone numbers
   │
   └─ styles/
      └─ theme.js                # colours: primary #217843, accent #FF8D32
```

Suggested libraries (all common, none required): React 18, Vite (plain JavaScript, no TypeScript), React Router, TanStack Query (server
data and caching), a component kit such as Mantine or MUI (tables, dialogs, date pickers), React Hook Form + Zod
(forms).

### 2.2 Backend admin module (to build): `backend/src/admin/`

The backend already has one folder per module (`orders/`, `consultation/`, ...). Admin gets its own folder so that
every admin route is in one place and easy to review.

```
backend/src/admin/
├─ adminRoutes.js              # mounts everything under /api/v1/admin, requireAuth + requireRole once
├─ schemas.js                  # zod schemas for every admin request (all .strict())
├─ appointmentsAdmin.js        # list, get, confirm, complete, cancel, notes
├─ doctorsAdmin.js             # create, update, active on/off, timetable
├─ clinicsAdmin.js             # create, update, active on/off
├─ creditsAdmin.js             # find user, grant / take back credits
├─ dashboardAdmin.js           # counts for the dashboard
└─ uploads.js                  # signed upload for doctor photos

backend/test/
└─ admin.test.js               # role checks, every action, audit rows, clashes
```

What already exists and is reused: `auth/authMiddleware.js` (`requireAuth`, `requireRole`), `audit/` (every action
is recorded), `common/validate.js`, `common/errors.js`, `common/paging.js`, `consultation/consultationService.js`
(slot rules: `freeSlots`, `slotKey` uniqueness).

---

## 3. Roles and who can do what

Role ids are the designation ids of the view `VW_EmpDesignationMaster` (see `backend/src/auth/roles.js`).

| Role | id | In the panel |
|---|---|---|
| Admin | 1 | Everything |
| Doctor | 12 | Later: only their own appointments (needs `doctors.userId` linked to their login) |
| Customer, Distributor, Moderator, others | - | No access (403) |

Rule: the **server** checks the role on every admin route (`requireRole('admin')`). Hiding a menu item in the
panel is only for convenience, never for safety.

---

## 4. API conventions (the same as the rest of the backend)

- Base URL: `http://localhost:4100/api/v1` (development).
- Send `Authorization: Bearer <accessToken>` on every admin call. Access tokens live 15 minutes; use
  `POST /auth/refresh` to get a new one (section 5).
- Bodies are JSON. Unknown fields are rejected with 400 (schemas are strict).
- Lists answer `{items, total, page, pageSize}`; query `?page=1&pageSize=20` (max 50).
- Dates and times in answers are ISO strings in UTC (`2026-11-10T04:30:00.000Z`). Clinics work in Indian time
  (UTC+5:30): show times in IST. Plain days are `YYYY-MM-DD` (Indian date).
- Errors: `{statusCode, message, details?}`. `details` is a list of `{field, message}` for 400.

| Status | Meaning |
|---|---|
| 400 | Some field is not valid (`details` says which) |
| 401 | Not logged in or the token expired - refresh, or go to the login page |
| 403 | Logged in but not an admin |
| 404 | Not found |
| 409 | Clash: slot taken, wrong state (for example confirming a cancelled appointment) |
| 429 | Too many tries - wait |

---

## 5. Login (exists)

| Call | Body | Answer |
|---|---|---|
| `POST /auth/login` | `{identifier, password, deviceName?}` | `{accessToken, refreshToken, tokenType, expiresInSeconds, user: {id, mobile, name, email, roleId, role}}` |
| `POST /auth/refresh` | `{refreshToken}` | a new session (the refresh token rotates: save the new one) |
| `POST /auth/logout` | `{refreshToken}` | 204 |

`identifier` is an email or a 10-digit mobile number. After login the panel must check `user.role === 'admin'`;
otherwise show "This panel is for staff" and log out. Five wrong passwords lock the account for 15 minutes.

---

## 6. Admin API reference

Mounted under `/api/v1/admin`. All need an admin token. **To build** unless marked "Exists".

### 6.1 Appointments

Status values: `requested` (person asked, no time yet) -> `booked` (time fixed) -> `completed`; `cancelled` from
`requested` or `booked`.

**`GET /admin/appointments`**
Query: `status`, `doctorId`, `clinicId`, `date` (YYYY-MM-DD, matches the booked day or the preferred day),
`q` (patient name, mobile or booking number), `page`, `pageSize`.
Answer: `{items: [Appointment], total, page, pageSize}`, newest first.

`Appointment`:
```json
{
  "id": "…", "number": "AP261110A1B2C3",
  "status": "requested",
  "type": "clinic",
  "startsAt": null, "endsAt": null, "preferredDate": "2026-11-12",
  "patientName": "Asha Khan", "patientMobile": "9876543210", "forSelf": true, "city": "Lucknow",
  "concern": "Joint & back pain", "duration": "1-3 months", "reason": "Morning if possible",
  "fee": 300, "creditsUsed": 100, "toPay": 200, "paymentStatus": "pay_later",
  "doctor": {"id": "dr-zafar-siddiqui", "name": "Dr. Zafar Siddiqui"},
  "clinic": {"id": "lucknow", "name": "AIHM Lucknow Clinic"},
  "adminNote": null, "createdAt": "…"
}
```

**`GET /admin/appointments/:id`** - one appointment (same shape).

**`POST /admin/appointments/:id/confirm`** - give a `requested` appointment its time.
Body: `{"startsAt": "2026-11-12T05:00:00.000Z"}` (must be one of the doctor's free slots).
Does: sets `startsAt`/`endsAt`, `slotKey`, status -> `booked`. 409 if the slot is taken or the appointment is not
`requested`.

**`POST /admin/appointments/:id/complete`** - status `booked` -> `completed` (only after the start time).

**`POST /admin/appointments/:id/cancel`** - cancel a `requested` or `booked` appointment.
Body: `{"reason": "Doctor on leave"}` (optional). Frees the slot and **refunds the credits used**.

**`PATCH /admin/appointments/:id`** - Body: `{"adminNote": "Called, will come at 5"}` (staff note, never shown to
the patient).

### 6.2 Doctors

**`GET /admin/doctors`** - all doctors including inactive. Query: `q`, `active`, `clinicId`, page.

**`POST /admin/doctors`**
```json
{
  "id": "dr-name-surname",
  "name": "Dr. Name Surname",
  "clinicId": "lucknow",
  "system": "Unani",
  "specialization": "Digestive wellness",
  "qualifications": "BUMS, MD (Unani)",
  "experienceYears": 12,
  "languages": "Hindi, Urdu, English",
  "bio": "…",
  "fee": 300,
  "modes": ["text", "audio", "video", "clinic"],
  "concerns": ["Gut Health", "Acidity"],
  "photoUrl": "https://…",
  "userId": null
}
```
`id` is a lower-case slug and cannot be changed later. 409 if it already exists.

**`PATCH /admin/doctors/:id`** - any of the fields above except `id`; plus `active` (false hides the doctor from the
app; old appointments stay). A doctor with future appointments cannot be switched off (409) until they are
cancelled or completed.

**`PUT /admin/doctors/:id/schedule`** - replaces the weekly timetable.
```json
{"timings": [{"weekday": 1, "startTime": "10:00", "endTime": "13:00", "slotMinutes": 20}]}
```
`weekday` 0 = Sunday … 6 = Saturday; times are `HH:MM` in IST; `startTime < endTime`; no overlapping rows on the
same day; `slotMinutes` 5-120. Existing appointments are not changed.

**`POST /admin/doctors/photo-upload`** - answers a signed upload (Cloudinary), see section 7.

### 6.3 Clinics

**`GET /admin/clinics`** - all clinics including inactive.

**`POST /admin/clinics`**
```json
{
  "id": "lucknow", "name": "AIHM Lucknow Clinic", "area": "Lucknow", "city": "Lucknow", "state": "Uttar Pradesh",
  "pincode": "226023", "address": "1st Floor, 264, KBS Spaces, Vijay Nagar, Krishna Nagar",
  "phone": "+91…", "timings": "Mon-Sat 10 AM - 8 PM", "lat": 26.8467, "lng": 80.9462
}
```

**`PATCH /admin/clinics/:id`** - any field except `id`, plus `active`.

### 6.4 Credits and users

**`GET /admin/users?mobile=9876543210`** - finds a person: `{id, name, mobile, email, credits, status}` (search by
mobile or email only; there is no "list all users").

**`POST /admin/users/:id/credits`** - Body: `{"amount": 250, "reason": "Welcome bonus"}`. A negative amount takes
credits back (the balance can never go below 0). Answer: `{balance}`. Written to the credit ledger and the audit log.

**`GET /admin/users/:id/credits`** - `{balance, history: [{delta, reason, at}]}`.

### 6.5 Dashboard

**`GET /admin/dashboard`** ->
```json
{
  "requestedAppointments": 4,
  "todayAppointments": 9,
  "upcomingAppointments": 31,
  "cancelledLast7Days": 2,
  "doctorsActive": 3
}
```

### 6.6 Already there (Exists) - shop admin

These work today with an admin token, the panel can use them in a later "Shop" section:
`GET /admin/orders`, `PATCH /admin/orders/:id/status`, `GET /admin/products`, `POST|PATCH|DELETE /products`,
`/categories`, `/banners`, `/coupons`.

---

## 7. Doctor photos

The panel uploads a photo to Cloudinary directly, using a **signed upload** so no secret is in the panel:

1. Panel calls `POST /admin/doctors/photo-upload`.
2. Backend answers `{cloudName, apiKey, timestamp, signature, folder}` (signature made with the secret that stays
   in the backend `.env`).
3. Panel sends the image to Cloudinary with those values and gets back an `https://…` URL.
4. Panel saves that URL in the doctor's `photoUrl`.

Limits to set in the signature: images only, max 2 MB, folder `doctors/`.

---

## 8. Security rules (must hold before it goes live)

1. **Server-side roles only.** Every `/admin` route has `requireAuth` + `requireRole('admin')`. Test that a
   customer token gets 403 on every one.
2. **Audit log.** Each admin change (confirm, cancel, doctor edit, credits) writes an audit row with the admin's id
   and the target id. No passwords, tokens or full phone numbers in the log.
3. **CORS.** In production the backend allows only the admin site's own address (`ADMIN_ORIGIN` in `.env`), not `*`.
4. **Tokens in the browser.** Never put tokens in `localStorage` for production. Best: the backend sets the refresh
   token as an `httpOnly; Secure; SameSite=Strict` cookie (to build), and the access token stays only in memory.
   During local development, memory-only storage is fine (a page reload logs you in again with the cookie).
5. **Admin accounts.** Few, strong passwords, no shared logins. Plan a second step (OTP) for admins before launch.
6. **Rate limits** stay on: login is limited per address; add a limit to the credits route.
7. **No admin code in the mobile app.** Admin is a separate site, so phones never carry it.
8. **HTTPS only** in production, for the API and the panel.

---

## 9. Data the backend still needs (small changes)

| Change | Why |
|---|---|
| `appointments.adminNote` (text, null) | Staff notes (6.1 PATCH) |
| `appointments.cancelReason` (varchar 200, null) | Why a clinic cancelled |
| `appointments.completedAt` (datetime, null) | Reporting |
| Audit actions: `admin.appointment.confirm/cancel/complete`, `admin.doctor.create/update`, `admin.clinic.update`, `admin.credits.change` | Audit log |
| `ADMIN_ORIGIN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` in `.env` | CORS and photo upload |

The consultation tables (`clinics`, `doctors`, `doctor_schedules`, `appointments`, `credit_ledger`) already exist.

---

## 10. Build order (checklist)

**Backend (first, can be tested with Postman):**
- [ ] 1. Migration for section 9, `ADMIN_ORIGIN` in CORS
- [ ] 2. `adminRoutes.js` with the role guard, plus a test that a customer gets 403 everywhere
- [ ] 3. Appointments: list, get, confirm, complete, cancel, note
- [ ] 4. Doctors: list, create, update, schedule
- [ ] 5. Clinics: list, create, update
- [ ] 6. Credits and users
- [ ] 7. Dashboard
- [ ] 8. Photo upload signing
- [ ] 9. Refresh token as httpOnly cookie for the panel

**Panel (frontend):**
- [ ] 1. `admin/` project, login page, `api/client.js` with refresh
- [ ] 2. App shell, route guard, role menu
- [ ] 3. Appointments page (list, filters, confirm time, cancel, complete)
- [ ] 4. Doctors page and timetable editor
- [ ] 5. Clinics page
- [ ] 6. Credits page
- [ ] 7. Dashboard
- [ ] 8. Deploy (Netlify/Vercel) and set `ADMIN_ORIGIN`

**Later:** doctor login (own appointments, prescriptions), notifications to the patient when a time is confirmed
(SMS or push), reviews, reports.

---

## 11. Flow example: a request becomes a booking

1. In the app, Asha picks "Any day" and taps *Request appointment* -> appointment `requested`, `startsAt: null`.
2. The panel's Appointments page, filter `status=requested`, shows it at the top.
3. Staff phone Asha, agree on Thursday 5:00 PM.
4. Staff open the appointment -> *Confirm time* -> the dialog shows the doctor's free slots for that day (the same
   `GET /doctors/:id/slots?date=` the app uses) -> choose 5:00 PM.
5. Panel calls `POST /admin/appointments/:id/confirm {startsAt}` -> status `booked`; the slot is now taken.
6. After the visit: *Complete*. If the person never comes: *Cancel* (credits come back).

---

## 12. Doctor confirmation flow (built)

**Every booking is a request the doctor confirms.** This is true also when the patient picked a time.

| Status (API) | Patient sees | Meaning |
|---|---|---|
| `requested` | **Pending** | Waiting for the doctor. A time the patient chose stays held (nobody else can take it). |
| `booked` | **Confirmed** | The doctor (or an admin) confirmed it. |
| `cancelled` | **Cancelled** + reason | The doctor declined, an admin cancelled, or the patient cancelled. |
| `completed` | **Completed** | The visit is done. |

If the doctor does nothing, the appointment stays **Pending** (there is no automatic cancel yet). The patient's
app shows the latest status when the screen is opened or pulled to refresh. There is no push/SMS yet.

### 12.1 Doctor API (`/api/v1/doctor`, Doctor role)

The doctor is found from the login (`doctors.userId`), never from the request. Another doctor's appointment is
answered as 404. A login with the Doctor role but no linked active doctor gets 403.

| Call | Body | Notes |
|---|---|---|
| `GET /doctor/me` | - | `{id, name, specialization, clinicId}` |
| `GET /doctor/dashboard` | - | `{requestedAppointments, todayAppointments, upcomingAppointments, cancelledLast7Days}` (own numbers only) |
| `GET /doctor/appointments` | query: `status, clinicId, date, q, page, pageSize` | Same shape as the admin list, only this doctor's. `doctorId` in the query is rejected (400) |
| `GET /doctor/appointments/:id` | - | One appointment |
| `POST /doctor/appointments/:id/confirm` | `{startsAt?}` | Keeps the time the patient chose. `startsAt` is required when the patient gave no time, and must be a free slot (409 if not). 409 if the appointment is not `requested` |
| `POST /doctor/appointments/:id/decline` | `{reason?}` | Status -> `cancelled`, the reason is shown to the patient, the time is freed, credits are refunded |
| `POST /doctor/appointments/:id/complete` | - | Only a `booked` appointment whose time has started |

Audit actions: `doctor.appointment.confirm`, `doctor.appointment.cancel`, `doctor.appointment.complete`.

### 12.2 Changed admin API

- `POST /admin/appointments/:id/confirm` - `startsAt` is now **optional** (omit it to keep the patient's time).
- The appointment objects now have `cancelReason` (the patient sees it too).
- The dashboard "requested" number counts every pending request.

### 12.3 Giving a doctor a login (admin only)

| Call | Body | Does |
|---|---|---|
| `PUT /admin/doctors/:id/login` | `{"mobile": "9876543210"}` | The account with that mobile gets the **Doctor role** and is linked to this doctor. The doctor must sign up in the app first (404 otherwise). Only a **customer** account can become a doctor login (409 for admin or other staff). One account = one doctor (409) |
| `DELETE /admin/doctors/:id/login` | - | Unlinks, gives the account the Customer role again and **ends its sessions** |

Audit: `admin.doctor.login.link`, `admin.doctor.login.unlink`. The role is read from the token, so a new Doctor
role works after the next login (or token refresh, within 15 minutes).

### 12.4 What changes in the panel (frontend)

| File | Change |
|---|---|
| `AuthProvider.jsx`, `api/auth.js` | Let in both `admin` and `doctor` (now only `admin`) |
| `RequireRole.jsx`, `App.jsx` | `roles` list per route: Dashboard and Appointments for `['admin','doctor']`; Doctors, Clinics, Credits for `['admin']` |
| `Sidebar.jsx` | A doctor sees only Dashboard and Appointments |
| `api/appointments.js` | For a doctor use `/doctor/appointments...` (list, get, confirm, decline, complete) and `/doctor/dashboard`; admin keeps `/admin/...` |
| `AppointmentsPage.jsx` | Status tabs: **Pending** first. Doctors have no doctor filter. Admins get the doctor's name per row |
| `AppointmentDrawer.jsx` | Buttons by status: `requested` -> **Confirm**, **Decline** (with a reason); `booked` -> **Complete**. If the patient chose no time, Confirm opens `ConfirmTimeDialog` |
| `StatusBadge.jsx` | Pending (amber), Confirmed (green), Cancelled (red), Completed (blue) |
| `DashboardPage.jsx` | Same cards; a doctor's numbers are their own and there is no "Active doctors" card |
| `DoctorFormPage.jsx` | New box "Doctor login (mobile)" with **Link** and **Remove login** buttons (`PUT`/`DELETE /admin/doctors/:id/login`); show the linked state from `userId` |

### 12.5 Making the account of a doctor (admin only) - recommended way

`POST /admin/doctors/:id/login/create`

```json
{"mobile": "9811111111", "email": "dr.zafar@example.com", "password": "Temp-Pass-2026"}
```
`email` is optional. Answer `201` with the doctor (`userId` is now set); the password is **never** returned.

What it does: creates a new account (name = the doctor's name, role **Doctor**, password stored hashed) and links it
to the doctor in one step. The admin tells the doctor the mobile (or email) and the temporary password by phone, and
the doctor logs in on the normal login screen of the app, lands on the doctor side, and changes the password in the
app's change-password screen.

| Status | When |
|---|---|
| 400 | Weak password (min 8 characters, not the mobile or email, not too simple), invalid mobile or email, unknown field |
| 404 | Unknown doctor |
| 409 | The doctor already has a login; or the mobile / email already has an account (message says to use **Link** instead) |
| 429 | More than 20 calls a minute |

Audit: `admin.doctor.login.create` (the password is never written to the log).

Panel (`DoctorFormPage.jsx`, edit mode), a "Doctor login" box with two states:
- **No login yet:** inputs *Mobile*, *Email (optional)*, *Temporary password* and the button **Create login**
  (`POST .../login/create`). After success show "Login created. Tell the doctor to change the password after the
  first login." and do not keep the password in state.
- **Has a login (`userId` is set):** show "Login is linked" and the button **Remove login**
  (`DELETE .../login`, ask for confirmation).
- Also keep a small link "Use an existing account" for the Link call (`PUT .../login` with a mobile).

---

## 13. Visit videos (built)

The **doctor** records a video of the visit with the phone's own camera app, and uploads it from the app
(Appointment -> Upload video). The patient does nothing and cannot see it. By default (`VIDEO_STORAGE=database`) the video
file is kept **inside MySQL**: it is cut into pieces of 1 MiB, one row each in `video_chunks` (`fileKey`, `seq`, `size`,
`data`), so it is never held in memory whole and MySQL's `max_allowed_packet` is no problem. The details are in
`consult_videos` and the history in `video_audit`. Playing from the middle reads only the pieces that are needed.
`VIDEO_STORAGE=folder` keeps the files in a private server folder (`VIDEO_STORAGE_DIR`) instead.

### 13.1 Rules

- **No appointment is involved.** A video does not need a visit, and a doctor does not have to confirm anything first. The
  upload form has two required fields: the **Patient ID** (`P000123`) and the **Doctor ID** (the doctor's own, filled in
  and locked), then the video and the patient's agreement (`consent: true`).
- The patient ID must belong to an existing account that is not blocked (an unknown ID or a blocked account is refused with 404). The doctor
  ID must be the doctor's own (another doctor's id is refused with 403).
- The `consult_videos` table keeps the ids in readable columns: `videoCode` (`V000012`), `patientCode` (`P000123`),
  `doctorId` (`dr-zafar-siddiqui`) and `doctorName`, `url` and `location` (where the file is), `uploadIp` and `uploadDevice` (where the upload came from). The patient is tied to a video by the patient id only (`patientCode`); there is no long account id and no visit column in the table.
- The patient's name and mobile are taken from the patient account. There is no limit on how many videos a patient has.
- Types: mp4, mov, 3gp, webm, mkv. The first bytes of the file are checked, so a text or image file renamed to `.mp4`
  fails. Biggest file: `VIDEO_MAX_MB` (default 500). A file bigger than the size the app announced fails.
- A failed or half-finished upload leaves nothing on the disk and is shown as `failed`.

### 13.2 Doctor API (used by the mobile app)

| Call | Body | Answer |
|---|---|---|
| `POST /doctor/videos` | `{patientId: "P000123", doctorId: "dr-zafar-siddiqui", mimeType, consent: true, sizeBytes?, durationSec?}` | `201 {id, code: "V000012", status: "uploading", maxBytes}`. 404 for an unknown patient ID, 403 when `doctorId` is not the doctor's own, 400 without `consent: true` |
| `POST /doctor/videos/:id/file` | multipart, one field `file` | `201 {id, code, status: "uploaded", patientName, patientCode, sizeBytes, ...}` |
| `GET /doctor/videos` | query: `q` (smart search: video id `V000012`, patient id `P000123`, mobile or patient name), `status` (`uploaded`, `failed`, `uploading`) | the doctor's own latest 50 videos, each with `code`, `patientName`, `patientMobile`, `patientCode`, `status`, size and length |
| `POST /doctor/videos/:id/link` | `{"action": "play"}` | `{path, expiresAt}`: a 1-hour link to watch the doctor's **own** video (another doctor's video is 404; no download). The play is written to the audit log |

### 13.3 Admin API (for the panel)

| Call | Does |
|---|---|
| `GET /admin/videos` | Search. Query: `q` (patient name, mobile, a patient id `P000123` or a **video id `V000012`**), `doctor` (doctor name), `doctorId`, `patientCode`, `status` (`uploading`, `uploaded`, `failed`), `from`, `to` (YYYY-MM-DD, upload start day, Indian time), `page`, `pageSize`. Answer `{items, total, page, pageSize}`. Newest first |
| `GET /admin/videos/alerts` | `{failed, stuckUploading, missing, items: {failed: [...], stuckUploading: [...], missing: [...]}}`. `stuckUploading` = not finished after 60 minutes. `missing` = marked uploaded but the file is not on the disk |
| `GET /admin/videos/:id` | One video plus its **audit history** (`audit: [{action, by: {id, name, mobile}, ip, at}]`, newest first; `by` is `null` when the archive policy did it) |
| `POST /admin/videos/:id/link` | Body `{"action": "play"}` (videos can be played, **not downloaded**). Answer `{path, expiresAt}`. **Asking for the link is what is audited.** 404 if the file is missing, 410 if archived |
| `PATCH /admin/videos/:id` | Body `{"legalHold": true}`. A held video is never deleted by the archive policy |

A video in the list:
```json
{
  "id": "…", "code": "V000012",
  "patient": {"id": "…", "name": "Asha Khan", "mobile": "9876543210"},
  "doctor": {"id": "dr-zafar-siddiqui", "name": "Dr. Zafar Siddiqui"},
  "status": "uploaded",
  "failedReason": null,
  "storage": "database", "location": "mysql://atiyaherbs/video_chunks/<id>.mp4",
  "url": "https://api.atiyaherbs.com/api/v1/videos/stream/<id>",
  "source": {"ip": "203.0.113.7", "device": "Dalvik/2.1.0 (Linux; U; Android 12; CPH2095 ...)"},
  "mimeType": "video/mp4", "sizeBytes": 52428800, "durationSec": 95,
  "consentAt": "…", "uploadedAt": "…", "createdAt": "…", "legalHold": false
}
```
`storage` is where the file is kept (`database` or `folder`), `location` the exact place (written in the table so a person
can find it), and `url` the full address that serves the video (the server address from `PUBLIC_API_URL` in `.env`, then `/api/v1/videos/stream/<id>`; empty `PUBLIC_API_URL` gives `http://localhost:<PORT>`). `source` says where the upload came from: the network address (`ip`) and the phone / app (`device`, its user agent). The `url` alone plays nothing: it needs the signed,
1-hour link from `POST /admin/videos/:id/link`, so a copied address is useless to anyone else.

`status` can also be `missing` (file gone) or `archived` (removed by the archive policy; the row stays).
It is `deleted` when the doctor deleted it (long press in the app: `DELETE /doctor/videos/:id`; the file is removed for good, the row and its audit entry stay; not allowed on a legal hold or while uploading). 410 on play, like archived.

### 13.4 Playing in the panel

1. `POST /admin/videos/:id/link {action: "play"}` -> `{path: "/api/v1/videos/stream/<id>?a=play&e=<time>&t=<signature>", expiresAt}`.
2. Use the link as the source of a player. The path starts at the API's address, so build the full address as
   `new URL(path, API_ORIGIN)` where `API_ORIGIN` is the part of `VITE_API_BASE_URL` before `/api/v1`:
   `<video controls src={fullUrl} />`. The link needs no login header, works for **1 hour** for that one video and
   that one action, and supports jumping around in the video (Range).
3. Videos can only be played, not downloaded: there is no download action (a link with another action is refused).
4. A long video, or one that is paused for a while, asks the server for more of the file later, so the link must still be valid then (that is why it lives 1 hour). When the player gets an error (the link ran out), ask for a new link and carry on from the same second (`currentTime`): the `VideoDrawer` of the panel does this by itself.

### 13.5 Archive policy

Run `npm run videos:archive` once a day on the server (a scheduled job). It
- marks an upload that never finished (older than 60 minutes) as `failed` and removes the half file;
- removes the file of a video older than `VIDEO_RETENTION_DAYS` (default 365) unless it has a legal hold. The row stays
  as `archived`, with its audit history.

### 13.6 What changes in the panel (frontend)

| File | Change |
|---|---|
| `api/videos.js` (new) | `listVideos`, `getVideo`, `getVideoAlerts`, `getVideoLink(id, action)`, `setLegalHold(id, bool)` |
| `pages/videos/VideosPage.jsx` (new) | Filters: search box (`q`), doctor, status, date range. Table: appointment no., patient (name, mobile), doctor, date, duration, size, status badge. Red badge for `failed` and `missing` |
| `pages/videos/VideoDrawer.jsx` (new) | Details, `<video>` player (after asking for a play link), legal-hold switch, audit history table |
| `Sidebar.jsx`, `App.jsx` | New menu item "Videos" and route `/videos` (admin only) |
| `DashboardPage.jsx` | A card "Video alerts" = `failed + stuckUploading + missing` from `/admin/videos/alerts`, linking to `/videos?status=failed` |
| `StatusBadge.jsx` | New statuses: uploaded (green), uploading (amber), failed and missing (red), archived (grey) |

### 13.7 Before it goes live

- Videos are in MySQL, so the **database grows with every video** (a 500 MB video is about 500 MB of MySQL). Plan the
  disk of the database server and its backups for that, and use `VIDEO_RETENTION_DAYS` and `npm run videos:archive`.
- A cloud MySQL plan has a storage limit; if videos make it too big, set `VIDEO_STORAGE=folder` with a persistent disk, or
  move the four storage functions in `src/videos/storage.js` to cloud storage (S3). Nothing else needs to change.
- State the recording, who can see it and how long it is kept in the privacy policy (consent text, DPDP Act).
