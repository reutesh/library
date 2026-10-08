/*
 * src/auth/AuthContext.tsx — authentication state
 *
 * Restores the session from the httpOnly cookie on mount and exposes
 * login / logout. The app shows a loading screen until the restore
 * attempt finishes, then either the login screen or the app.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from '../api';

interface AuthContextValue {
  me: Me | null;
  /** True while the initial session restore is in flight. */
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Re-fetch the current user (e.g. after their room access changed). */
  reloadMe(): Promise<void>;
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

  const reloadMe = async () => {
    setMe(await api.me());
  };

  const logout = async () => {
    await api.logout();
    setMe(null);
  };

  return (
    <AuthContext.Provider value={{ me, loading, login, logout, reloadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}