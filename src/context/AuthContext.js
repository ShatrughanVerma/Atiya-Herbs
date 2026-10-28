import React, {createContext, useContext, useMemo, useState} from 'react';
import {signOutFromGoogle} from '../utils/googleAuth';

const AuthContext = createContext(null);

// Holds the signed-in customer for this app session.
// TODO: persist the session and exchange the Google idToken with the backend.
export function AuthProvider({children}) {
  const [user, setUser] = useState(null); // {name, email, photo?, provider}

  const value = useMemo(
    () => ({
      user,
      signIn: setUser,
      signOut: async () => {
        if (user?.provider === 'google') {
          await signOutFromGoogle();
        }
        setUser(null);
      },
    }),
    [user],
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
