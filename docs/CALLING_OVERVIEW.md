# Atiya Herbs: Calling system, kya use hua hai aur kya kitna free hai

Limits ki jaankari 29 Oct 2026 ko official pages se li gayi hai (sources neeche hain). Plans badalte rehte
hain, isliye production se pehle ek baar pricing pages dobara dekh lena.

## 1. Calling kaise kaam karti hai

```
Phone A ◄── Socket.IO (ring, accept, reject, end) ──► Backend (Render) ──► LiveKit ka token banata hai
Phone A ◄══════ awaaz + video (WebRTC) ══════► LiveKit Cloud ◄══════► Phone B
```

- **Backend** sirf doosre phone ko ring karta hai aur dono ko ek token deta hai. Awaaz/video iske through nahi jaati.
- **LiveKit Cloud** awaaz aur video sambhalta hai. Ye TURN (mushkil network par raasta) bhi khud karta hai,
  isliye humein alag TURN server nahi chalana padta.
- **Phone app** (React Native) call screen dikhati hai aur LiveKit se judti hai.

## 2. Kya-kya use hua hai (ek nazar me)

| Cheez | Kis kaam ke liye | Free? | Kahan hai |
|---|---|---|---|
| **LiveKit Cloud** | Awaaz/video, TURN | Haan, "Build" plan (hard limit) | cloud.livekit.io |
| **Render** | Backend ko internet par chalana (HTTPS) | Haan, Free web service | render.com |
| **UptimeRobot** | Render ke server ko jagaye rakhna (ping) | Haan, Free plan | uptimerobot.com |
| **GitHub** | Code rakhna, Render yahin se deploy karta hai | Haan (repo public hai) | github.com/ShatrughanVerma/Atiya-Herbs |
| **Socket.IO** | Ring / accept / reject / end ke message | Haan, open source (MIT) | backend aur app me library |
| **Express (Node.js)** | Backend server | Haan, open source (MIT) | `call-backend/` |
| **livekit-server-sdk** | Backend me LiveKit token banana | Haan, open source (Apache-2.0) | `call-backend/` |
| **@livekit/react-native, @livekit/react-native-webrtc, livekit-client** | App me LiveKit se judna, mic/camera | Haan, open source (Apache-2.0) | app (`package.json`) |

Ye cheezein **abhi use nahi ho rahi** (aur aage lag sakti hain): Firebase push (band app par ring), SMS/OTP service.

## 3. Har service ki free limits

### LiveKit Cloud: "Build" (free, $0/mahina)

| Limit | Free me kitna |
|---|---|
| WebRTC participant minutes | **5,000 / mahina** |
| Downstream data transfer | **50 GB / mahina** |
| Ek saath connected log (poore project me) | **100** |
| Server API requests | 1,000 / minute |
| Zyada limit hone par | **Hard cap**: nayi connection fail ho jati hai, **koi bill nahi** aata |
| Naye projects banana | Limit badhti nahi, free quota sabhi free projects me shared hai |

- **Participant minute** ka matlab: jitni der ek user LiveKit se juda raha. Do log ki call ek minute chale to
  **2 participant minutes** lagte hain.
- **Andaza (pakka nahi, apna hisaab):** 5,000 participant minutes ≈ **2,500 minute ki 1-to-1 calls**
  (lagbhag 41 ghante) har mahine. 100 concurrent ≈ **50 calls ek saath**.
- **Bandwidth:** voice call bahut kam data leti hai, video zyada (kuch MB/minute). Shuru me minutes ki limit
  pehle khatam hogi, bandwidth ki nahi.
- Free quota khatam hone par calls **us mahine ke baaki din band** rehti hain, jab tak mahina badle ya aap
  paid plan na lo. Koi chupa hua kharcha nahi.

### Render: Free web service

| Limit | Free me kitna |
|---|---|
| Instance hours | **750 ghante / mahina, poore workspace ke liye** (sabhi free services milakar) |
| Zyada hone par | Workspace ki **saari free web services band (suspend)** ho jati hain agle mahine tak |
| Sleep | **15 minute** bina traffic ke server so jata hai (WebSocket ke message bhi traffic maane jaate hain) |
| Wapas jagna | Agli request par **lagbhag 1 minute** |
| Soya hua server | Ghante **nahi** khata |
| Restart | Render kabhi bhi restart kar sakta hai (memory me jo call state hai wo mit jati hai) |
| Bandwidth | Mahine ka kuch hissa included hai (kitna, page me nahi likha) |
| Card | Page me nahi likha ki chahiye ya nahi. Aapke case me card nahi maanga gaya |

### UptimeRobot: Free

| Limit | Free me kitna |
|---|---|
| Monitors | 50 |
| Check interval | **5 minute** |
| Commercial use | Allowed, card nahi chahiye |
| Alerts | Sirf 5 integrations; SMS/voice alert paid hain |
| Data | 3 mahine ka |

### GitHub, Socket.IO, Express aur LiveKit ki libraries
- GitHub par repo free hai. Abhi **public** hai, yaani code sabko dikhta hai (keys nahi, wo `.env` me hain).
- Baaki sab **open-source libraries** hain, inka koi kharcha ya limit nahi.

## 4. Ek zaroori dhyan: Render ke 750 ghante

UptimeRobot har 5 minute par ping karta hai, isliye hamara server **kabhi sota nahi**. Ek server
poore mahine jaagne par lagbhag **744 ghante** leta hai, yaani lagbhag **poora 750 ka quota**.

Aapke Render account me pehle se **4 aur free services** hain (`bookstore_APP-...`). Agar wo bhi jaagti
rehti hain, to **750 ghante khatam ho sakte hain aur Render sabhi free services (calling samet) suspend kar
dega.** Do raaste:

1. **Purani services Suspend karo** (service kholo → Settings → Suspend). Sabse safe.
2. Ya **UptimeRobot ka monitor band karo.** Tab server sirf tab jaagega jab koi app khole (pehli connection par
   ~1 minute lagegi) aur ghante bachenge.

## 5. Ye free setup kitna bada ho sakta hai

| Cheez | Pehle kaun si limit aayegi |
|---|---|
| Call ke minutes | LiveKit: ~2,500 minute (1-to-1) / mahina |
| Ek saath calls | LiveKit: ~50 calls ek saath |
| Server hamesha chalu | Render: 750 ghante (dhyan section 4) |

Chhote start, testing aur kuch sau users ke liye theek hai. Roz bahut zyada call hongi to pehle LiveKit ke
minutes khatam honge.

## 6. Aage badhne par kharcha

| Zaroorat | Kya lena padega | Kitna |
|---|---|---|
| Zyada call minutes / users | LiveKit **Ship** plan | **$50/mahina**, isme 150,000 WebRTC minutes aur 250 GB, 1,000 concurrent, uske baad $0.0005 per minute aur $0.12 per GB |
| Server hamesha chalu, bina sleep | Render paid plan | Render ke pricing page par dekho |
| Band app par ring | Firebase Cloud Messaging | Push ke liye free, par app me kaafi kaam |
| Mobile OTP login | SMS service | Aam taur par paid (per SMS) |
| Apna LiveKit server | Self-host | Server, bandwidth aur TLS ka kharcha aur sambhalna aapko padega |

## 7. Kahan kya rakha hai (secrets ka dhyan)

| Cheez | Jagah |
|---|---|
| LiveKit URL, API key, API secret | Local: `call-backend/.env` (git me nahi). Render: Dashboard → service → Environment |
| Backend ka address (app me) | `src/config/calls.js` → `CALLS_BACKEND_URL` |
| Backend health check | `https://atiyaherbs-calls.onrender.com/health` |
| Backend code | `call-backend/` |
| App ka call logic / screens | `src/context/CallContext.js`, `src/components/CallOverlay.js`, `src/screens/CallsScreen.js` |
| Render ki settings (file) | `render.yaml` |

- **API secret kabhi app me ya git me mat daalo.** Sirf backend (`.env` ya Render) me.
- Jin keys ko chat ya screenshot me share kiya gaya hai, unhe **LiveKit → Settings → Keys me delete karke nayi
  banao**, aur nayi key `.env` aur Render me daalo.

## 8. Abhi kya baaki hai

1. **Mobile number ka OTP verification.** Abhi koi bhi kisi ka number daalkar judh sakta hai.
2. **Band app par ring** (Firebase push). Abhi dono phones par app khuli honi chahiye.
3. **Login yaad rakhna.** App band karke kholne par dobara login karna padta hai.
4. **Release signing.** APK abhi debug key se sign hai; Play Store ke liye apni keystore chahiye.
5. **Ringtone.** Abhi sirf vibration hai.

## Sources

- LiveKit pricing: https://livekit.com/pricing
- LiveKit quotas aur limits: https://docs.livekit.io/home/cloud/quotas-and-limits/
- LiveKit billing: https://docs.livekit.io/home/cloud/billing/
- Render free plan: https://render.com/docs/free
- UptimeRobot pricing: https://uptimerobot.com/pricing/
