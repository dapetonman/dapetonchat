import { useState, useEffect } from "react";

export function useUsername() {
  const [username, setUsernameState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const storedName = localStorage.getItem("chat_username");
    if (storedName) setUsernameState(storedName);
    setIsReady(true);
  }, []);

  const setUsername = (name: string) => {
    localStorage.setItem("chat_username", name);
    setUsernameState(name);
  };

  const clearUsername = () => {
    localStorage.removeItem("chat_username");
    setUsernameState(null);
  };

  return { username, setUsername, clearUsername, isReady };
}
