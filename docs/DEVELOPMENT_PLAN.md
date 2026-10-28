# Atiya Herbs App — Development Plan

The AI-assistant rules are in [SYSTEM_PROMPT.md](SYSTEM_PROMPT.md). This file covers the plan: what we build, in what order, and how we test and release it.

## 1. Decisions needed before coding

| # | Decision | Recommendation |
|---|---|---|
| 1 | The website runs on **Shopify**. Where do the products and orders live? | **Option A (recommended):** keep Shopify as the master for products, stock, and orders. The backend syncs them into SQL Server using the Shopify Admin API and webhooks. SQL Server holds everything else (users, consultations, social, network). Stock stays correct on both the website and the app. **Option B:** move the whole store to SQL Server and the custom backend. This gives full control but means rebuilding the website's checkout too. |
| 2 | Backend language | NestJS (TypeScript), the same language as the app, so one team can work on both. ASP.NET Core is a good alternative if the team knows C#. |
| 3 | Hosting | Azure (Azure SQL, App Service or Container Apps, Blob Storage, Front Door WAF). It pairs naturally with SQL Server. |
| 4 | Video provider | Agora. It has a strong React Native SDK, works well on Indian networks, and charges per minute. |
| 5 | Play developer account | An **organization** account (needs a D-U-N-S number). It avoids the 12-tester closed-test rule and looks more trustworthy for a health app. |
| 6 | Network-marketing rules | Have a lawyer approve the commission plan under the Direct Selling Rules 2021 **before** Module 4 is built. |

## 2. Architecture

```
React Native app ──HTTPS (pinned)──► WAF ──► NestJS API ──► SQL Server
      │                                   │  ├─► Redis (OTP, cache, jobs)
      │                                   │  ├─► Blob Storage + CDN (images, reels, PDFs)
      │                                   │  └─► Razorpay / Agora / Shiprocket / FCM / Shopify
      └──── Agora video (token from API)  └── Admin web panel (2FA)
```

## 3. Main database tables (SQL Server)

- **Core:** Users, UserRoles, OtpRequests, RefreshTokens, Addresses, FamilyMembers, Devices (FCM tokens), Notifications, AuditLogs, Consents
- **Shop:** Products, ProductImages, Categories, Concerns, ProductConcerns, Inventory, Carts, CartItems, Coupons, Orders, OrderItems, Payments, Reviews, Wishlist
- **Orders and tracking:** Shipments, ShipmentEvents, Returns
- **Consultation:** Doctors, DoctorSlots, Appointments, IntakeForms (encrypted), CallSessions, Prescriptions (encrypted), PrescriptionItems, Clinics
- **Social:** Posts, PostMedia, Comments, Likes, Follows, Hashtags, Reports, Blocks, ModerationActions
- **Network:** Distributors, SponsorTree (closure table), Ranks, CommissionRules, CommissionLedger, Wallets, WalletTransactions, Payouts, KycDocuments

## 4. Phases and timeline

The estimate assumes 2 mobile developers, 1 backend developer, 1 QA engineer, and a part-time designer. A larger team shortens it.

| Phase | Weeks | Output |
|---|---|---|
| 0. Setup | 1–2 | Repo structure, CI (lint, test, build), environments, Azure, database, design system from the Vaidban reference, final screen list |
| 1. Core | 3–5 | OTP login, profile, addresses, navigation, i18n, push notifications, account deletion, admin panel shell |
| 2. E-commerce | 6–10 | Catalog, Shopify sync, search, product detail, cart, coupons, Razorpay and COD checkout, invoices, reviews, wishlist |
| 3. Order tracking | 11–12 | Shiprocket integration, status timeline, push on each status change, cancel and return |
| 4. Consultation | 13–17 | Doctors, slots, booking and payment, intake form, Agora video, e-prescription, prescription-to-cart, clinic locator, doctor panel |
| 5. Social | 18–21 | Posts, reels upload and transcoding, feed, likes and comments, follow, product tags, report, block, and moderation queue |
| 6. Network | 22–25 | Referral, sponsor tree, commission engine (sales only), wallet, KYC, payouts, distributor dashboard |
| 7. Hardening | 26–28 | Full VAPT (internal scan and an external CERT-In empanelled auditor), performance work, accessibility, fixes |
| 8. Release | 29–30 | Play listing, closed test, staged rollout (10% → 50% → 100%) |

**Recommended MVP to launch first (about 12 weeks):** Core, E-commerce, and Order tracking. Add Consultation, Social, and Network in later updates. This gets the store earning sooner and makes Play review simpler.

## 5. Security and VAPT checklist

- [ ] All database access goes through the ORM or parameterized queries. CI blocks a build if `queryRawUnsafe` or string-built SQL appears.
- [ ] DTO validation on every endpoint, with a whitelist that rejects unknown fields.
- [ ] Object-level authorization tests for every resource (IDOR).
- [ ] OTP and login rate limits, account lockout, and token rotation.
- [ ] Prices, coupons, and commissions are calculated only on the server. Webhook signatures are verified.
- [ ] SSL pinning, Keychain storage, R8 obfuscation, no secrets in the APK, `allowBackup=false`, and FLAG_SECURE on sensitive screens.
- [ ] Health data is encrypted at rest. Audit logs record access to prescriptions.
- [ ] WAF, Helmet headers, strict CORS, upload scanning, and admin 2FA.
- [ ] OWASP ZAP run on staging, MobSF run on the release build, dependency audit, and secret scan.
- [ ] External VAPT report with all high and critical issues fixed and retested before launch.

## 6. Sample test cases

The full list belongs in `docs/test-cases/`, one file per module.

| ID | Module | Scenario | Expected result | Type |
|---|---|---|---|---|
| AUTH-01 | Core | Correct OTP within 5 minutes | Logged in, tokens stored in Keychain | Functional |
| AUTH-02 | Core | Wrong OTP 5 times | Locked for 15 minutes, no sixth attempt allowed | Security |
| AUTH-03 | Core | Delete account | Data removed or anonymised, logged out, cannot log in | Functional |
| SHOP-01 | Shop | Add an item, apply a valid coupon | Total recalculated by the server | Functional |
| SHOP-02 | Shop | Tamper with the price in the request | Server ignores it and charges the real price | Security |
| SHOP-03 | Shop | Search box input `' OR 1=1--` | Treated as text, no SQL error, no data leak | Security |
| SHOP-04 | Shop | Razorpay webhook with a bad signature | Rejected with 401, order not marked paid | Security |
| ORD-01 | Orders | Courier marks the order "Shipped" | Timeline updates and a push notification arrives | Functional |
| ORD-02 | Orders | User A opens user B's order ID | 403 or 404, nothing returned | Security |
| CON-01 | Consult | Book a slot that someone else just booked | "Slot taken" message, no double booking | Functional |
| CON-02 | Consult | Join a call after the token expires | Join refused, new token required | Security |
| CON-03 | Consult | Screenshot on the prescription screen | Blocked | Security |
| SOC-01 | Social | 5 users report a post | Post hidden and sent to the moderation queue | Functional |
| SOC-02 | Social | Upload a `.exe` renamed to `.jpg` | Rejected by the server-side MIME check | Security |
| NET-01 | Network | A referred user buys a product | Commission entered in the sponsor's ledger, based on the sale | Functional |
| NET-02 | Network | A referred user signs up but buys nothing | **No commission** | Functional and legal |
| NET-03 | Network | Payout request above the wallet balance | Rejected | Security |

## 7. Google Play release checklist

- [ ] Organization developer account, Play App Signing enabled, upload key backed up safely
- [ ] Signed release **AAB**, target API at Google's current requirement, version code increased
- [ ] Privacy policy URL, account deletion (in the app and on a web page), Data safety form
- [ ] Health apps declaration, content rating questionnaire, target audience 18+
- [ ] UGC policy: in-app report and block, moderation, terms accepted at sign-up
- [ ] Store listing without medical cure claims, plus a medical disclaimer in the app
- [ ] Permissions only when needed: camera and mic for calls, location for the clinic locator, notifications on Android 13+
- [ ] Internal test → closed test → production staged rollout. Watch Android vitals (crash and ANR rates).

## 8. Where the current code stands

The repo already has the React Native CLI app with Splash, Login, Sign Up, and bottom tabs (Home, Reels, Explore, Clinic, Cart, Profile), and a styled Home screen. Login does not check credentials yet. Next steps, in order:

1. Make decisions 1–6 above.
2. Phase 0: create `backend/`, the SQL Server schema, and CI.
3. Phase 1: real OTP login connected to the new API.
