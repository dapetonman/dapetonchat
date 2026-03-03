import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type Message, type MessageInput, type WsMessage } from "@shared/schema";

export function useMessages(username: string) {
  return useQuery({
    queryKey: [api.messages.list.path, username],
    queryFn: async () => {
      const res = await fetch(`${api.messages.list.path}?username=${username}`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(api.messages.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
  });
}

export function useChatWebSocket(username: string, color: string, onNotification: (n: any) => void) {
  const queryClient = useQueryClient();
  const [users, setUsers] = useState<{ username: string; color: string }[]>([]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    let ws: WebSocket;
    
    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'identify', username, color }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'chat_message') {
          queryClient.setQueryData<Message[]>([api.messages.list.path, username], (old) => {
            if (!old) return [data.payload];
            if (old.some(m => m.id === data.payload.id)) return old;
            return [...old, data.payload];
          });
        } else if (data.type === 'user_list') {
          setUsers(data.payload);
        } else if (data.type === 'notification') {
          onNotification(data.payload);
        }
      };

      ws.onclose = () => setTimeout(connect, 3000);
    };

    connect();
    return () => ws?.close();
  }, [username, color, queryClient]);

  return { users };
}
