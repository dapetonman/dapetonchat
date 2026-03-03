import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { WS_EVENTS, type WsMessage } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Map<WebSocket, { username: string; color: string }>();

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'identify') {
          clients.set(ws, { username: msg.username, color: msg.color });
          broadcastUserList();
        }
      } catch (e) {}
    });
    
    ws.on('close', () => {
      clients.delete(ws);
      broadcastUserList();
    });
  });

  function broadcastUserList() {
    const userList = Array.from(clients.values());
    const payload: WsMessage<any> = {
      type: WS_EVENTS.USER_LIST,
      payload: userList,
    };
    const data = JSON.stringify(payload);
    clients.forEach((_, client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  function broadcastMessage(message: any) {
    const payload: WsMessage<any> = {
      type: WS_EVENTS.CHAT_MESSAGE,
      payload: message,
    };
    const data = JSON.stringify(payload);
    
    clients.forEach((info, client) => {
      if (client.readyState === WebSocket.OPEN) {
        // Send if public OR if involved in private message
        if (!message.recipientId || message.recipientId === info.username || message.username === info.username) {
          client.send(data);
          
          // If it's a private message for someone else, send notification
          if (message.recipientId === info.username && message.username !== info.username) {
            client.send(JSON.stringify({
              type: WS_EVENTS.NOTIFICATION,
              payload: { from: message.username, content: message.content }
            }));
          }
        }
      }
    });
  }

  app.get(api.messages.list.path, async (req, res) => {
    const username = req.query.username as string;
    const messages = await storage.getMessages(username);
    res.json(messages);
  });

  app.post(api.messages.create.path, async (req, res) => {
    try {
      const input = api.messages.create.input.parse(req.body);
      const message = await storage.createMessage(input);
      broadcastMessage(message);
      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
