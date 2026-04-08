import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { storage } from "./storage";
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

  // Daily archive at midnight EST
  cron.schedule('0 0 * * *', async () => {
    const oldMessages = await storage.archiveOldMessages(new Date());
    if (oldMessages.length > 0) {
      const fileName = `archive_${new Date().toISOString().split('T')[0]}.json`;
      const filePath = path.join(process.cwd(), 'archives', fileName);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(oldMessages, null, 2));
      console.log(`Archived ${oldMessages.length} messages to ${fileName}`);
    }
  }, { timezone: "America/New_York" });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'identify') {
          clients.set(ws, { username: msg.username });
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  function broadcastToChat(message: any, chatId: string) {
    const payload: WsMessage<any> = {
      type: WS_EVENTS.CHAT_MESSAGE,
      payload: message,
    };
    const data = JSON.stringify(payload);

    clients.forEach((info, client) => {
      if (client.readyState !== WebSocket.OPEN) return;

      // General chat: send to everyone
      if (chatId === 'general') {
        client.send(data);
        return;
      }

      // DM chat: only send to the two participants
      const participants = chatId.split('_');
      if (participants.includes(info.username)) {
        client.send(data);
      }
    });
  }

  // Auth routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already taken" });
      }
      const user = await storage.createUser({ username, password });
      res.status(201).json({ id: user.id, username: user.username });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      res.json({ id: user.id, username: user.username });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Users list (all registered accounts)
  app.get('/api/users', async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers.map(u => ({ id: u.id, username: u.username })));
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Messages routes
  app.get('/api/messages', async (req, res) => {
    try {
      const chatId = (req.query.chatId as string) || 'general';
      const msgs = await storage.getMessages(chatId);
      res.json(msgs);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post('/api/messages', async (req, res) => {
    try {
      const { username, content, chatId, replyToId } = req.body;
      if (!username || !content || !chatId) {
        return res.status(400).json({ message: "username, content, and chatId are required" });
      }
      const message = await storage.createMessage({
        username,
        content,
        chatId,
        replyToId: replyToId ?? null,
      });
      broadcastToChat(message, chatId);
      res.status(201).json(message);
    } catch (err) {
      console.error('Send message error:', err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
