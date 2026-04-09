import { useState, useEffect } from "react";

export interface AuthUser {
  id: number;
  username: string;
}

async function postAuth(path: string, username: string, password: string) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return data?.message || "Request failed";
  }
  return res.json();
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
    const result = await postAuth("/api/auth/login", username, password);
    if (typeof result === "string") return result;
    const session = { id: result.id, username: result.username };
    localStorage.setItem("chat_session", JSON.stringify(session));
    setUser(session);
    return null;
  };

  const register = async (username: string, password: string): Promise<string | null> => {
    const result = await postAuth("/api/auth/register", username, password);
    if (typeof result === "string") return result;
    const session = { id: result.id, username: result.username };
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
