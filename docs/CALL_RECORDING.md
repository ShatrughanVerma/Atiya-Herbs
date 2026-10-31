# Call recording (LiveKit Egress → Cloudflare R2 → optionally Cloudinary; details in Cloudflare D1)

Either person can ask to record a connected call. **Nothing is recorded unless the other person taps
Allow.** Both see a red "Recording" badge, and either can stop it. The recording file goes to a private
Cloudflare R2 bucket; the details (who, when, how long, which file, who agreed) go to Cloudflare D1.

```
Ask ──► Allow? ──► call-backend tells LiveKit to record the room ──► LiveKit uploads the file to R2
                                         └─► call-backend writes a row in D1 (who/when/consent), later size + length
```

## What is saved where

| What | Where | Notes |
|---|---|---|
| Recording file (audio `.ogg`, or video `.mp4`) | **R2 bucket**, `recordings/<year>/<month>/<callId>-<time>.ogg` | Private bucket |
| Details of each recording | **D1 table `call_recordings`** | caller, callee, who asked, who allowed, consent time, status, file path, size, length |
| This month's recorded seconds | Counted from D1 | Recording stops being offered near the limit |

There is **no way to list or download recordings from the app or the backend yet.** That needs verified
logins (OTP) and a permission check, which don't exist yet. Until then recordings stay in the private bucket.

## Free limits (check again before relying on them)

- **LiveKit Build plan:** about **60 recording/transcode minutes a month**. The backend stops offering recording
  at `RECORDING_MONTHLY_MINUTES` (default 50). Audio-only is the default (smaller and cheaper).
- **R2:** 10 GB storage, 1 million Class A and 10 million Class B operations free per month; downloads are free.
- **D1:** has a free plan too; check its current limits on the Cloudflare pricing page.

## Step 1: R2 bucket and keys (Cloudflare dashboard)

1. R2 Object Storage → **Add R2 subscription** (Cloudflare may ask for a payment method; you pay only above the free limits).
2. **Create bucket**: name `atiyaherbs-call-recordings`. Keep it **private** (no public access).
3. **Manage R2 API tokens → Create API token**: permission **Object Read & Write**, only this bucket.
   Copy the **Access Key ID**, **Secret Access Key** and the **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).

## Step 2: D1 database (Cloudflare dashboard)

1. Storage & databases → **D1 SQLite Database → Create database**, name `atiyaherbs-calls`.
2. Copy the **Database ID** (database page) and your **Account ID** (right side of the dashboard home).
3. My Profile → API Tokens → **Create Token → Create Custom Token**: permission **Account · D1 · Edit**,
   account = yours. Copy the token. (The backend creates the table by itself the first time it starts.)

## Step 3: Put the values in the backend

Local: `call-backend\.env` (see `.env.example`). Render: dashboard → atiyaherbs-calls → **Environment**:

```
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=atiyaherbs-call-recordings
CF_ACCOUNT_ID=...
D1_DATABASE_ID=...
CF_API_TOKEN=...
RECORDING_MODE=audio
```

Never put these in the app, in git or in chat. Then restart/redeploy. Check
`https://atiyaherbs-calls.onrender.com/health`: it should show `"recordingAvailable":true` and
`"recordingDetailsStore":"d1"`. If it shows `"memory"`, the three Cloudflare D1 values are missing.

## Step 3b (optional): Store the recordings in Cloudinary

LiveKit can only upload to S3-style buckets (R2, S3, Google Cloud, Azure), **not to Cloudinary**. So when
Cloudinary is set up, the flow is:

```
LiveKit ──► R2 (short staging copy) ──► call-backend copies it to Cloudinary ──► R2 copy is deleted
```

If the copy to Cloudinary fails, the file **stays in R2** and the D1 row says so, so nothing is lost.
R2 is still required, but it holds a file only for a moment, so its free 10 GB is barely touched.

1. Cloudinary dashboard (cloudinary.com) → **Settings → API Keys**. Copy the **Cloud name**, **API Key** and
   **API Secret**.
2. Add to `call-backend\.env` and to Render → Environment:

```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_DELIVERY_TYPE=authenticated
```

3. Redeploy. `/health` then shows `"recordingDestination":"cloudinary"`. Without these values it shows `"r2"`.

How it is stored:

- Audio is kept under Cloudinary's **"video" resource type** (that is how Cloudinary holds audio), in the folder
  `atiyaherbs/call-recordings`, as `<callId>-<time>`.
- Delivery type **`authenticated`**: the file cannot be opened without a signed link made by the backend.
  Cloudinary's docs didn't confirm that private delivery is included in the free plan, so test that opening
  a recording's plain URL fails. Do **not** switch to `upload` for patient recordings (that makes them public).
- The D1 row gets `destination = cloudinary`, `cloudinary_public_id`, `cloudinary_resource_type` and
  `cloudinary_delivery_type`.
- Cloudinary's free plan: about 25 credits a month (1 credit = 1 GB of storage or 1 GB of video bandwidth) and
  videos up to about 100 MB per file. Files larger than `CLOUDINARY_MAX_MB` stay in R2.

To check: Cloudinary dashboard → **Media Library** → folder `atiyaherbs/call-recordings`.

## Step 4: Try it (two phones)

1. Start a call and wait until it is connected. A **Record call** button appears (only if `recordingAvailable` is true).
2. One person taps it. The other sees "<name> wants to record this call" with **Allow / Not now**.
3. After Allow, both see the red **Recording** badge. Stop with **Stop recording**, or just end the call.
4. A minute later, look in the R2 bucket for the file and in D1 (Console tab) for the row:
   `SELECT * FROM call_recordings ORDER BY created_at DESC LIMIT 5;`

## Behaviour to know

- If LiveKit's quota is used up or the upload fails, the row is saved as `failed` with the reason.
- If the server restarts during a call, that recording's final size/length may stay `recording` or `unknown`.
- Recordings are only started by the server after the other person's Allow; the app cannot start one by itself.

## Before using this with real patients

1. **Consent and law.** Recording a doctor–patient consultation involves health data (India's DPDP Act 2023
   and telemedicine rules). Get legal advice on consent wording, how long to keep recordings, encryption and
   the patient's right to delete.
2. **Verified logins (OTP) and a permission check** before anyone can list or play recordings.
3. **A retention rule** (delete recordings after N days) and a way to delete on request.
4. Recording the app's calls with only LiveKit's 60 free minutes is for testing; plan a paid LiveKit plan for real use.
