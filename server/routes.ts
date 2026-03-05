import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { WS_EVENTS, type WsMessage } from "@shared/schema";
import fs from "fs/promises";
import path from "path";
import cron from "node-cron";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Map<WebSocket, { username: string }>();

  // Archiving logic
  cron.schedule('0 0 * * *', async () => {
    // This runs at 12:00 AM every day
    // For "EST", we'd usually adjust offset, but simple "daily" is often what's meant.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const oldMessages = await storage.archiveOldMessages(new Date());
    if (oldMessages.length > 0) {
      const fileName = `archive_${new Date().toISOString().split('T')[0]}.json`;
      const filePath = path.join(process.cwd(), 'archives', fileName);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(oldMessages, null, 2));
      console.log(`Archived ${oldMessages.length} messages to ${fileName}`);
    }
  }, {
    timezone: "America/New_York"
  });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'identify') {
          clients.set(ws, { username: msg.username });
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

  function broadcastMessage(message: any, type: string = WS_EVENTS.CHAT_MESSAGE) {
    const payload: WsMessage<any> = {
      type,
      payload: message,
    };
    const data = JSON.stringify(payload);
    
    clients.forEach((info, client) => {
      if (client.readyState === WebSocket.OPEN) {
        if (!message.recipientId || message.recipientId === info.username || message.username === info.username) {
          client.send(data);
          if (type === WS_EVENTS.CHAT_MESSAGE && message.recipientId === info.username && message.username !== info.username) {
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

  app.post('/api/messages/:id/react', async (req, res) => {
    const { id } = req.params;
    const { emoji, username } = req.body;
    const messages = await storage.getMessages(); // Simple for now
    const msg = messages.find(m => m.id === Number(id));
    if (!msg) return res.status(404).json({ message: "Not found" });
    
    const reactions: any = { ...(msg.reactions as object) };
    if (!reactions[emoji]) reactions[emoji] = [];
    if (reactions[emoji].includes(username)) {
      reactions[emoji] = reactions[emoji].filter((u: string) => u !== username);
    } else {
      reactions[emoji].push(username);
    }
    
    const updated = await storage.updateMessageReactions(Number(id), reactions);
    broadcastMessage(updated, WS_EVENTS.MESSAGE_UPDATE);
    res.json(updated);
  });

  app.post('/api/logout', async (req, res) => {
    const { username } = req.body;
    await storage.deleteUserMessages(username);
    res.json({ success: true });
  });

  return httpServer;
}
