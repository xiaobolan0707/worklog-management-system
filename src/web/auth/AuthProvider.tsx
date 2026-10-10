import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiRequest, setCsrfToken, type SessionUser } from "../api/client.js";

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  changeInitialPassword(currentPassword: string, newPassword: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiRequest<{ user: SessionUser; csrfToken?: string }>("/auth/me")
      .then((result) => {
        setUser(result.user);
        if (result.csrfToken) setCsrfToken(result.csrfToken);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    async login(username, password) {
      const result = await apiRequest<{ user: SessionUser; csrfToken: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      setCsrfToken(result.csrfToken);
      setUser(result.user);
    },
    async changeInitialPassword(currentPassword, newPassword) {
      await apiRequest("/auth/change-initial-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setUser((current) => current ? { ...current, mustChangePassword: false } : current);
    },
    async logout() {
      await apiRequest("/auth/logout", { method: "POST" });
      setCsrfToken(null);
      setUser(null);
    }
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
