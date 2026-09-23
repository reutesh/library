/*
 * client/src/auth/AuthContext.tsx — authentication state
 *
 * Restores the session from the httpOnly cookie on mount and exposes
 * login / logout.  The whole app shows the login screen until `me`
 * is known or the restore attempt finishes.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from '../api';

interface AuthContextValue {
  me: Me | null;
  /** True while the initial session restore is in flight. */
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  setMe(me: Me | null): void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.me()
      .then((user) => {
        if (!cancelled) setMe(user);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (username: string, password: string) => {
    const user = await api.login(username, password);
    setMe(user);
  };

  const logout = async () => {
    await api.logout();
    setMe(null);
  };

  return (
    <AuthContext.Provider value={{ me, loading, login, logout, setMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}