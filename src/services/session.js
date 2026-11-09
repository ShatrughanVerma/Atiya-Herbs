import { ApiError, request, upload } from './http';
import { clearTokens, loadTokens, saveTokens } from './tokenStore';

// The login session: the two tokens (kept in memory and in the Keystore) and authFetch, which every
// logged-in API call goes through.
//  - It adds the access token.
//  - When the server says 401 it swaps the refresh token for a new pair ONCE and repeats the call.
//  - Calls that need a refresh at the same moment share one refresh (the server accepts a refresh token only
//    once; a second use would look like theft and cancel the whole login).
//  - When the refresh is refused the session is over: tokens are wiped and the app is told to sign out.
//    A refresh that fails only because of the network keeps the session, so being offline never logs anyone out.

let tokens = null;
let refreshing = null;
let onExpired = () => {};

export const setSessionExpiredHandler = handler => {
  onExpired = typeof handler === 'function' ? handler : () => {};
};

export const hasSession = () => !!tokens;
export const getRefreshToken = () => tokens?.refreshToken || null;

export async function restoreSession() {
  tokens = await loadTokens();
  return !!tokens;
}

export async function startSession(next) {
  tokens = { accessToken: next.accessToken, refreshToken: next.refreshToken };
  await saveTokens(tokens);
}

// Forget the tokens on this phone (does not tell the server; see logoutRemote in authApi.js)
export async function endSession() {
  tokens = null;
  refreshing = null;
  await clearTokens();
}

function refreshTokens() {
  if (!refreshing) {
    const used = tokens;
    refreshing = (async () => {
      try {
        const pair = await request('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: used.refreshToken },
        });
        await startSession(pair);
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.kind === 'unauthorized' || error.kind === 'forbidden')
        ) {
          await endSession();
          onExpired();
        }
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function authFetch(path, options = {}) {
  if (!tokens) {
    throw new ApiError('unauthorized', 'Please log in first.', { status: 401 });
  }
  const usedToken = tokens.accessToken;
  try {
    return await request(path, { ...options, token: usedToken });
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== 'unauthorized') {
      throw error;
    }
  }
  // Another call may already have refreshed while this one was in flight: then just repeat with the new token
  if (tokens && tokens.accessToken === usedToken) {
    await refreshTokens();
  } else if (refreshing) {
    await refreshing;
  }
  if (!tokens) {
    throw new ApiError(
      'unauthorized',
      'Your session has expired. Please log in again.',
      { status: 401 },
    );
  }
  return request(path, { ...options, token: tokens.accessToken });
}

// A file upload by the logged-in person, with progress. Like authFetch it swaps an expired token once.
export async function authUpload(path, formData, onProgress) {
  if (!tokens) {
    throw new ApiError('unauthorized', 'Please log in first.', { status: 401 });
  }
  const usedToken = tokens.accessToken;
  try {
    return await upload(path, { formData, token: usedToken, onProgress });
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== 'unauthorized') {
      throw error;
    }
  }
  if (tokens && tokens.accessToken === usedToken) {
    await refreshTokens();
  } else if (refreshing) {
    await refreshing;
  }
  if (!tokens) {
    throw new ApiError('unauthorized', 'Your session has expired. Please log in again.', { status: 401 });
  }
  return upload(path, { formData, token: tokens.accessToken, onProgress });
}

