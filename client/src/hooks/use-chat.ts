import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type Message, type MessageInput, type WsMessage } from "@shared/schema";

// Helper for parsing validation to catch silent JSON failures
function parseWithLogging<T>(schema: any, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    throw result.error;
  }
  return result.data;
}

// 1. Fetch initial message history
export function useMessages() {
  return useQuery({
    queryKey: [api.messages.list.path],
    queryFn: async () => {
      const res = await fetch(api.messages.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();
      return parseWithLogging<Message[]>(api.messages.list.responses[200], data, "messages.list");
    },
  });
}

// 2. Send a new message
export function useSendMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: MessageInput) => {
      const validated = api.messages.create.input.parse(data);
      const res = await fetch(api.messages.create.path, {
        method: api.messages.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error("Failed to send message");
      }
      
      const responseData = await res.json();
      return parseWithLogging<Message>(api.messages.create.responses[201], responseData, "messages.create");
    },
    // We do NOT invalidate queries here because the WebSocket will broadcast the message back to us
    // which handles the UI update optimistically and efficiently.
  });
}

// 3. Connect to WebSocket to receive real-time messages
export function useChatWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Construct WS URL relative to current host
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected to chat server");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsMessage<Message>;
          
          if (data.type === 'chat_message') {
            // Optimistically update the message list in the cache
            queryClient.setQueryData<Message[]>([api.messages.list.path], (old) => {
              if (!old) return [data.payload];
              // Avoid duplicates if we somehow receive it twice
              if (old.some(m => m.id === data.payload.id)) return old;
              return [...old, data.payload];
            });
          }
        } catch (err) {
          console.error("[WS] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        console.log("[WS] Disconnected, attempting reconnect in 3s...");
        setTimeout(connect, 3000);
      };
      
      ws.onerror = (error) => {
        console.error("[WS] Error:", error);
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [queryClient]);
}
