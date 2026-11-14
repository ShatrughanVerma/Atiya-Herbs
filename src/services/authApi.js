import { authFetch, getRefreshToken, startSession } from './session';
import { ApiError, request } from './http';

// The auth and profile endpoints of the backend (see backend/README.md)

const minutes = seconds => {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `${m} minute${m === 1 ? '' : 's'}`;
};

// A 429 from the login means too many wrong tries: say how long to wait
const waitMessage = error =>
  error instanceof ApiError && error.kind === 'rate-limited'
    ? new ApiError(
        'rate-limited',
        `Too many tries. Please try again in ${minutes(
          error.retryAfter || 900,
        )}.`,
        { status: error.status, retryAfter: error.retryAfter },
      )
    : error;

// -> {accessToken, refreshToken, user: {id, mobile, name, email, role}}
export async function registerAccount({
  name,
  email,
  mobile,
  password,
  code,
  deviceName,
}) {
  try {
    return await request('/auth/register', {
      method: 'POST',
      body: {
        name,
        email,
        mobile,
        password,
        ...(code && { code }),
        ...(deviceName && { deviceName }),
      },
    });
  } catch (error) {
    throw waitMessage(error);
  }
}

// Step 1 of a sign-up: the server checks the number and email are free and, when OTP is on, sends the code by SMS.
// -> {otpRequired: false} or {otpRequired: true, expiresInSeconds}
export async function requestSignupOtp({ mobile, email }) {
  try {
    return await request('/auth/register/otp', {
      method: 'POST',
      body: { mobile, email },
    });
  } catch (error) {
    throw waitMessage(error);
  }
}

// Step 2 of a login (after the password was right): the proof from loginWithPassword and the SMS code.
// -> the same session as registerAccount.
export async function verifyLoginOtp(challengeToken, code, deviceName) {
  try {
    return await request('/auth/login/verify', {
      method: 'POST',
      body: { challengeToken, code, ...(deviceName && { deviceName }) },
    });
  } catch (error) {
    throw waitMessage(error);
  }
}

// identifier = email or mobile. -> the same session as registerAccount, or when the server wants an SMS code as
// well: {otpRequired: true, challengeToken, mobile (masked), expiresInSeconds}
export async function loginWithPassword(identifier, password, deviceName) {
  try {
    return await request('/auth/login', {
      method: 'POST',
      body: {
        identifier: identifier.trim(),
        password,
        ...(deviceName && { deviceName }),
      },
    });
  } catch (error) {
    throw waitMessage(error);
  }
}

// Ends this login on the server. Best effort: the phone forgets the tokens either way.
export async function logoutRemote() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return;
  }
  try {
    await request('/auth/logout', { method: 'POST', body: { refreshToken } });
  } catch {
    // offline: the login on the server expires by itself
  }
}

export const fetchMe = () => authFetch('/users/me');
// Only name and email can be changed
export const updateMe = changes =>
  authFetch('/users/me', { method: 'PATCH', body: changes });
export const deleteMe = () => authFetch('/users/me', { method: 'DELETE' });

// Changes the password. Every other login of the account ends on the server and this phone gets a fresh
// session, which is stored here, so the person stays logged in.
export async function changePassword(currentPassword, newPassword) {
  try {
    const session = await authFetch('/users/me/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    await startSession(session);
    return session;
  } catch (error) {
    throw waitMessage(error);
  }
}
