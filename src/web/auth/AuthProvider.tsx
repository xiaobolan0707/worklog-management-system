import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiRequest, setCsrfToken, type SessionUser } from "../api/client.js";

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  changeInitialPassword(currentPassword: string, newPassword: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
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
      const result = await apiRequest<{ csrfToken?: string }>("/auth/change-initial-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      // SEC-10：改密后服务端轮换 CSRF Token，前端必须同步。
      if (result?.csrfToken) setCsrfToken(result.csrfToken);
      setUser((current) => current ? { ...current, mustChangePassword: false } : current);
    },
    async changePassword(currentPassword, newPassword) {
      const result = await apiRequest<{ csrfToken?: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (result?.csrfToken) setCsrfToken(result.csrfToken);
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
