// Address of the call backend (the call-backend/ folder in this repo): it rings the other phone
// and hands out the LiveKit tokens. The audio and video themselves go through LiveKit.
//
// Release builds (the APK you give to users) use CALLS_BACKEND_URL. It must be a public https://
// address, so calls work from any network. Host call-backend on any Node.js host with HTTPS.
const CALLS_BACKEND_URL = 'https://atiyaherbs-calls.onrender.com';

// Development (run-android): the backend running on your own PC
//  - Android emulator: http://10.0.2.2:4000
//  - Real phone on the same Wi-Fi as the PC: http://<PC's Wi-Fi IP>:4000 (the backend prints it)
const DEV_BACKEND_URL = 'http://10.0.2.2:4000';

export const CALL_BACKEND_URL = __DEV__ ? DEV_BACKEND_URL : CALLS_BACKEND_URL;
