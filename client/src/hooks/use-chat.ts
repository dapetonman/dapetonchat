import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@shared/schema";
import { dispatchWsMessage, setActiveWs, setWsConnected } from "@/lib/ws-bus";

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

export function useEditMessage() {
  return useMutation({
    mutationFn: async (data: { id: number; username: string; content: string }) => {
      const res = await fetch(`/api/messages/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.username, content: data.content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Failed to edit message");
      }
      return res.json() as Promise<Message>;
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

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: number; username: string; chatId: string }) => {
      const res = await fetch(`/api/messages/${data.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.username }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Failed to delete message");
      }
      return res.json();
    },
    onSuccess: (_, { id, chatId }) => {
      queryClient.setQueryData<Message[]>(["/api/messages", chatId], (old) => {
        if (!old) return old;
        return old.filter((m) => m.id !== id);
      });
    },
  });
}

export type ReactionEntry = { messageId: number; emoji: string; usernames: string[] };

export function useReactions(chatId: string) {
  return useQuery<ReactionEntry[]>({
    queryKey: ["/api/reactions", chatId],
    queryFn: async () => {
      const res = await fetch(`/api/reactions?chatId=${encodeURIComponent(chatId)}`);
      if (!res.ok) throw new Error("Failed to fetch reactions");
      return res.json();
    },
    enabled: !!chatId,
  });
}

export function useToggleReaction() {
  return useMutation({
    mutationFn: async (data: { messageId: number; username: string; emoji: string }) => {
      const res = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to toggle reaction");
      return res.json();
    },
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
        setWsConnected(true);
        ws.send(JSON.stringify({ type: "identify", username }));
        ws.send(JSON.stringify({ type: "initial-presence", userId: username, username, online: true }));
        ws.send(JSON.stringify({ type: "presence", userId: username, username, online: true }));
        ws.send(JSON.stringify({ type: "request-presence-sync" }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "chat_message") {
            const msg: Message = data.payload;
            queryClient.setQueryData<Message[]>(["/api/messages", msg.chatId], (old) => {
              if (!old) return [msg];
              if (old.some((m) => m.id === msg.id)) return old;
              return [...old, msg];
            });
            window.dispatchEvent(new CustomEvent("chat-new-message", { detail: { senderUsername: msg.username, content: msg.content } }));
          }
          if (data.type === "message_update") {
            const msg: Message = data.payload;
            queryClient.setQueryData<Message[]>(["/api/messages", msg.chatId], (old) => {
              if (!old) return old;
              return old.map((m) => (m.id === msg.id ? { ...msg, createdAt: new Date(msg.createdAt), editedAt: msg.editedAt ? new Date(msg.editedAt) : null } : m));
            });
          }
          if (data.type === "message_delete") {
            const { messageId, chatId } = data.payload;
            queryClient.setQueryData<Message[]>(["/api/messages", chatId], (old) => {
              if (!old) return old;
              return old.filter((m) => m.id !== messageId);
            });
          }
          if (data.type === "reaction_update") {
            const { messageId, chatId, reactions } = data.payload;
            queryClient.setQueryData<ReactionEntry[]>(["/api/reactions", chatId], (old) => {
              const base = (old ?? []).filter((r) => r.messageId !== messageId);
              const newEntries = (reactions as { emoji: string; usernames: string[] }[]).map((r) => ({ messageId, emoji: r.emoji, usernames: r.usernames }));
              return [...base, ...newEntries];
            });
          }
          if (data.type === "presence") {
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
            queryClient.setQueryData<UserInfo[]>(["/api/users"], (old) => {
              if (!old) return old;
              const syncedOnline = new Set(data.users as string[]);
              return old.map((u) => ({
                ...u,
                isOnline: syncedOnline.has(u.username) ? true : u.isOnline,
              }));
            });
          }
          if (data.type === "identify_rejected") {
            localStorage.removeItem("chat_session");
            ws.close();
            window.location.reload();
          }
          if (data.type === "reload") {
            window.location.reload();
          }
          dispatchWsMessage(data);
        } catch {}
      };

      ws.onclose = () => {
        setWsConnected(false);
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
