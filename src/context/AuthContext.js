import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {signOutFromGoogle} from '../utils/googleAuth';
import {clearSession, loadSession, saveSession} from '../utils/sessionStorage';

const AuthContext = createContext(null);

// Holds the signed-in customer. The profile is remembered on the phone (AsyncStorage) so the
// customer does not have to log in every time the app opens.
// TODO: exchange the Google idToken / OTP with the backend and keep the tokens in the Keystore.
export function AuthProvider({children}) {
  const [user, setUser] = useState(null); // {name, email, mobile?, photo?, provider}
  const [ready, setReady] = useState(false); // false until the saved session has been read

  useEffect(() => {
    let alive = true;
    loadSession().then(saved => {
      if (alive) {
        setUser(saved);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(next => {
    setUser(next);
    saveSession(next);
  }, []);

  const signOut = useCallback(async () => {
    if (user?.provider === 'google') {
      await signOutFromGoogle();
    }
    setUser(null);
    await clearSession();
  }, [user]);

  const value = useMemo(() => ({user, ready, signIn, signOut}), [user, ready, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
