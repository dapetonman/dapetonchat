import { useState, useEffect } from "react";

export function useUsername() {
  const [username, setUsernameState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("chat_username");
    if (stored) {
      setUsernameState(stored);
    }
    setIsReady(true);
  }, []);

  const setUsername = (name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      localStorage.setItem("chat_username", trimmed);
      setUsernameState(trimmed);
    }
  };

  const clearUsername = () => {
    localStorage.removeItem("chat_username");
    setUsernameState(null);
  };

  return { username, setUsername, clearUsername, isReady };
}
