import { useState, useEffect } from "react";

export interface AuthUser {
  id: number;
  username: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("chat_session");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {}
    }
    setIsReady(true);
  }, []);

  const login = async (username: string, password: string): Promise<string | null> => {
    const accounts = JSON.parse(localStorage.getItem("chat_accounts") || "[]") as Array<{ username: string; password: string; id: number }>;
    const account = accounts.find((item) => item.username === username && item.password === password);
    if (!account) return "Invalid username or password";
    const session = { id: account.id, username: account.username };
    localStorage.setItem("chat_session", JSON.stringify(session));
    setUser(session);
    return null;
  };

  const register = async (username: string, password: string): Promise<string | null> => {
    const accounts = JSON.parse(localStorage.getItem("chat_accounts") || "[]") as Array<{ username: string; password: string; id: number }>;
    if (accounts.some((item) => item.username === username)) return "Username already taken";
    const session = { id: accounts.length + 1, username };
    localStorage.setItem("chat_accounts", JSON.stringify([...accounts, { ...session, password }]));
    localStorage.setItem("chat_session", JSON.stringify(session));
    setUser(session);
    return null;
  };

  const logout = () => {
    localStorage.removeItem("chat_session");
    setUser(null);
  };

  return { user, isReady, login, register, logout };
}
