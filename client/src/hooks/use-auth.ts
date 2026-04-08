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
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      return err.message || 'Login failed';
    }
    const data = await res.json();
    localStorage.setItem("chat_session", JSON.stringify(data));
    setUser(data);
    return null;
  };

  const register = async (username: string, password: string): Promise<string | null> => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      return err.message || 'Registration failed';
    }
    const data = await res.json();
    localStorage.setItem("chat_session", JSON.stringify(data));
    setUser(data);
    return null;
  };

  const logout = () => {
    localStorage.removeItem("chat_session");
    setUser(null);
  };

  return { user, isReady, login, register, logout };
}
