import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {signOutFromGoogle} from '../utils/googleAuth';
import {clearSession, loadSession, saveSession} from '../utils/sessionStorage';
import {
  changePassword as changePasswordRemote,
  deleteMe,
  fetchMe,
  logoutRemote,
  updateMe,
} from '../services/authApi';
import {
  endSession,
  hasSession,
  restoreSession,
  setSessionExpiredHandler,
} from '../services/session';

const AuthContext = createContext(null);

// An account that lives on the server (saved in the database): the person logged in with an email or mobile and a
// password. ('otp' is what the first test builds called them; those phones keep working.)
export const isServerAccount = user =>
  user?.provider === 'password' || user?.provider === 'otp';

// What the app keeps about the logged-in person, built from the backend's user ({id, mobile, name, email, role}).
// Photo and gender are only on this phone, so they are carried over from the old profile.
const profileFromServer = (me, previous) => ({
  name: me.name || '',
  email: me.email || '',
  mobile: me.mobile,
  role: me.role,
  provider: 'password',
  ...(previous?.photo && {photo: previous.photo}),
  ...(previous?.gender && {gender: previous.gender}),
});

// Holds the signed-in customer.
//  - Login is by email or mobile and a password against the backend. The tokens live in the Android Keystore (services/session.js);
//    only the profile is remembered here (AsyncStorage), so the app opens straight into the account.
//  - Google sign-in has no backend token yet: it stays a profile on this phone only (provider 'google').
export function AuthProvider({children}) {
  const [user, setUser] = useState(null); // {name, email, mobile?, photo?, gender?, role?, provider}
  const [ready, setReady] = useState(false); // false until the saved session has been read
  const userRef = useRef(null);
  userRef.current = user;

  const setAndSave = useCallback(next => {
    userRef.current = next;
    setUser(next);
    if (next) {
      saveSession(next);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    // The server ended the login (refresh refused): leave the account and show the login screen
    setSessionExpiredHandler(() => {
      if (alive) {
        userRef.current = null;
        setUser(null);
        clearSession();
      }
    });

    (async () => {
      const [saved, hasTokens] = await Promise.all([
        loadSession(),
        restoreSession(),
      ]);
      let current = saved;
      // The old fake email login had no backend session: those accounts log in again with their password
      if (current?.provider === 'email') {
        current = null;
        clearSession();
      }
      // A server account whose tokens are gone (Keystore wiped) cannot call the API
      if (isServerAccount(current) && !hasTokens) {
        current = null;
        clearSession();
      }
      // Tokens but no saved profile (the app was closed in the middle of sign-up): ask the server
      if (hasTokens && !current) {
        try {
          const me = await fetchMe();
          if (me?.name) {
            current = profileFromServer(me, null);
            saveSession(current);
          } else {
            await endSession(); // no name was ever given: start the login again
          }
        } catch {
          // offline or expired: stay signed out
        }
      }
      if (!alive) {
        return;
      }
      userRef.current = current;
      setUser(current);
      setReady(true);

      // Fresh name and email from the server; offline keeps what is saved
      if (isServerAccount(current)) {
        try {
          const me = await fetchMe();
          if (alive && isServerAccount(userRef.current)) {
            setAndSave(profileFromServer(me, userRef.current));
          }
        } catch {
          // keep the saved profile
        }
      }
    })();

    return () => {
      alive = false;
      setSessionExpiredHandler(null);
    };
  }, [setAndSave]);

  // Saves a profile on this phone (Google sign-in, a new profile photo)
  const signIn = useCallback(
    next => {
      setAndSave(next);
    },
    [setAndSave],
  );

  // After a successful login or sign-up: `me` is the backend's user. Call it once the tokens are saved
  // (services/session.js startSession).
  const completeLogin = useCallback(
    me => {
      const previous =
        userRef.current?.mobile === me.mobile ? userRef.current : null;
      setAndSave(profileFromServer(me, previous));
    },
    [setAndSave],
  );

  // Name and email go to the backend; the profile here follows its answer
  const updateProfile = useCallback(
    async changes => {
      const me = await updateMe(changes);
      setAndSave(profileFromServer(me, userRef.current));
      return me;
    },
    [setAndSave],
  );

  const leave = useCallback(async () => {
    if (userRef.current?.provider === 'google') {
      await signOutFromGoogle();
    }
    await endSession();
    userRef.current = null;
    setUser(null);
    await clearSession();
  }, []);

  const signOut = useCallback(async () => {
    if (hasSession()) {
      await logoutRemote(); // ends this login on the server too
    }
    await leave();
  }, [leave]);

  // New password for the logged-in account. The server ends every other login and the new session is stored by
  // authApi, so this phone stays logged in. Throws ApiError (fields.currentPassword / fields.newPassword).
  const changePassword = useCallback(
    (currentPassword, newPassword) =>
      changePasswordRemote(currentPassword, newPassword),
    [],
  );

  // "Delete my account": the backend removes the data, then this phone forgets everything.
  // Throws ApiError (e.g. kind 'conflict' while an order is on its way).
  const deleteAccount = useCallback(async () => {
    await deleteMe();
    await leave();
  }, [leave]);

  const value = useMemo(
    () => ({
      user,
      ready,
      signIn,
      signOut,
      completeLogin,
      updateProfile,
      changePassword,
      deleteAccount,
    }),
    [
      user,
      ready,
      signIn,
      signOut,
      completeLogin,
      updateProfile,
      changePassword,
      deleteAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
