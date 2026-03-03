import { useState, useEffect } from "react";

export function useUsername() {
  const [username, setUsernameState] = useState<string | null>(null);
  const [color, setColorState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const storedName = localStorage.getItem("chat_username");
    const storedColor = localStorage.getItem("chat_color");
    if (storedName) setUsernameState(storedName);
    if (storedColor) setColorState(storedColor);
    setIsReady(true);
  }, []);

  const setUsername = (name: string, color: string) => {
    localStorage.setItem("chat_username", name);
    localStorage.setItem("chat_color", color);
    setUsernameState(name);
    setColorState(color);
  };

  const clearUsername = () => {
    localStorage.removeItem("chat_username");
    localStorage.removeItem("chat_color");
    setUsernameState(null);
    setColorState(null);
  };

  return { username, color, setUsername, clearUsername, isReady };
}
