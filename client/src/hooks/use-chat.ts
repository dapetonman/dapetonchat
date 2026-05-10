import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@shared/schema";
import { dispatchWsMessage, setActiveWs } from "@/lib/ws-bus";

export function useMessages(chatId: string) {
  return useQuery<Message[]>({
    queryKey: ["/api/messages", chatId],
    queryFn: async () => {
      const res = await fetch(`/api/messages?chatId=${encodeURIComponent(chatId)}`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!chatId,
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async (data: { username: string; content: string; chatId: string; replyToId?: number | null }) => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
  });
}

export interface UserInfo {
  id: number;
  username: string;
  isOnline?: boolean;
}

export function useUsers() {
  return useQuery<UserInfo[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    refetchInterval: 30000,
  });
}

export function useChatWebSocket(username: string) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!username) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setActiveWs(ws);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "identify", username }));
        ws.send(JSON.stringify({ type: "initial-presence", userId: username, username, online: true }));
        ws.send(JSON.stringify({ type: "presence", userId: username, username, online: true }));
        ws.send(JSON.stringify({ type: "request-presence-sync" }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("DEBUG: Incoming WS", data.type, data);
          if (data.type === "typing") {
            console.log("RECEIVED TYPING:", data);
          }
          if (data.type === "chat_message") {
            const msg: Message = data.payload;
            queryClient.setQueryData<Message[]>(["/api/messages", msg.chatId], (old) => {
              if (!old) return [msg];
              if (old.some((m) => m.id === msg.id)) return old;
              return [...old, msg];
            });
          }
          if (data.type === "presence") {
            console.log("DEBUG: Presence update:", data);
            queryClient.setQueryData<UserInfo[]>(["/api/users"], (old) => {
              if (!old) return old;
              const userKey = data.userId || data.username;
              return old.map((u) =>
                (u.username === userKey || u.username === data.username)
                  ? { ...u, username: userKey || u.username, isOnline: data.online }
                  : u
              );
            });
          }
          if (data.type === "presence-sync") {
            console.log("DEBUG: Presence sync:", data);
            queryClient.setQueryData<UserInfo[]>(["/api/users"], (old) => {
              if (!old) return old;
              const syncedOnline = new Set(data.users as string[]);
              return old.map((u) => ({
                ...u,
                isOnline: syncedOnline.has(u.username) ? true : u.isOnline,
              }));
            });
          }
          if (data.type === "reload") {
            window.location.reload();
          }
          dispatchWsMessage(data);
        } catch {}
      };

      ws.onclose = () => {
        setActiveWs(null);
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      setActiveWs(null);
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, [username, queryClient]);

  return wsRef;
}
