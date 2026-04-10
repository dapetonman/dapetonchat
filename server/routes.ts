import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import multer from "multer";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { WS_EVENTS, type WsMessage } from "@shared/schema";

const ADMIN_USERNAME = "dapetonman";
const CLEANUP_MS = 60 * 60 * 1000;

const screenshotCache = new Map<string, { buffer: Buffer; contentType: string }>();
const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Map<WebSocket, { username: string }>();
  const voiceRoom = new Set<string>();

  function sendToUser(username: string, msg: object) {
    const data = JSON.stringify(msg);
    clients.forEach((info, ws) => {
      if (info.username === username && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  function broadcastVoiceUsers() {
    const users = [...voiceRoom];
    const data = JSON.stringify({ type: "voice_users", users });
    clients.forEach((_, ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  }

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "identify") {
          clients.set(ws, { username: msg.username });
          ws.send(JSON.stringify({ type: "voice_users", users: [...voiceRoom] }));
        }

        const username = clients.get(ws)?.username;
        if (!username) return;

        if (msg.type === "voice_join") {
          const existingUsers = [...voiceRoom];
          voiceRoom.add(username);
          broadcastVoiceUsers();
          existingUsers.forEach((existingUser) => {
            sendToUser(existingUser, { type: "voice_new_peer", username });
          });
        }

        if (msg.type === "voice_leave") {
          voiceRoom.delete(username);
          broadcastVoiceUsers();
          clients.forEach((_, clientWs) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "voice_peer_left", username }));
            }
          });
        }

        if (msg.type === "voice_signal") {
          sendToUser(msg.to, { type: "voice_signal", from: username, data: msg.data });
        }
      } catch {}
    });

    ws.on("close", () => {
      const info = clients.get(ws);
      if (info && voiceRoom.has(info.username)) {
        voiceRoom.delete(info.username);
        broadcastVoiceUsers();
        const leftMsg = JSON.stringify({ type: "voice_peer_left", username: info.username });
        clients.forEach((_, clientWs) => {
          if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(leftMsg);
          }
        });
      }
      clients.delete(ws);
    });
  });

  function broadcastToChat(message: any, chatId: string) {
    const payload: WsMessage<any> = { type: WS_EVENTS.CHAT_MESSAGE, payload: message };
    const data = JSON.stringify(payload);
    clients.forEach((info, client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (chatId === "general" || chatId.split("_").includes(info.username)) client.send(data);
    });
  }

  function broadcastReload() {
    const data = JSON.stringify({ type: "reload" });
    clients.forEach((_, client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) return res.status(400).json({ message: "Username and password required" });
      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(409).json({ message: "Username already taken" });
      const user = await storage.createUser({ username, password });
      res.status(201).json(user);
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) return res.status(400).json({ message: "Username and password required" });
      const stored = await storage.getUserByUsername(username);
      if (!stored || stored.password !== password) return res.status(401).json({ message: "Invalid username or password" });
      const { password: _password, ...user } = stored;
      res.json(user);
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/users", async (_req, res) => {
    try {
      res.json(await storage.getAllUsers());
    } catch (err) {
      console.error("Users error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/messages", async (req, res) => {
    try {
      const chatId = (req.query.chatId as string) || "general";
      res.json(await storage.getMessages(chatId));
    } catch (err) {
      console.error("Messages error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const { username, content, chatId, replyToId } = req.body ?? {};
      if (!username || !content || !chatId) return res.status(400).json({ message: "username, content, and chatId are required" });
      const message = await storage.createMessage({ username, content, chatId, replyToId: replyToId ?? null });
      broadcastToChat(message, chatId);
      res.status(201).json(message);
    } catch (err) {
      console.error("Send message error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/messages", async (req, res) => {
    try {
      const { username } = req.body ?? {};
      if (username !== ADMIN_USERNAME) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteAllMessages();
      broadcastReload();
      res.json({ ok: true });
    } catch (err) {
      console.error("Delete messages error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/users", async (req, res) => {
    try {
      const { username } = req.body ?? {};
      if (username !== ADMIN_USERNAME) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteAllUsers();
      broadcastReload();
      res.json({ ok: true });
    } catch (err) {
      console.error("Delete users error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/upload", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image provided" });
      const { username, chatId } = req.body ?? {};
      if (!username || !chatId) return res.status(400).json({ message: "username and chatId are required" });
      const id = randomBytes(16).toString("hex");
      screenshotCache.set(id, { buffer: req.file.buffer, contentType: req.file.mimetype || "image/png" });
      setTimeout(() => screenshotCache.delete(id), CLEANUP_MS);
      const imageUrl = `/view/${id}`;
      const message = await storage.createMessage({ username, content: imageUrl, chatId, replyToId: null });
      broadcastToChat(message, chatId);
      res.json({ url: imageUrl });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/view/:id", (req, res) => {
    const entry = screenshotCache.get(req.params.id);
    if (!entry) return res.status(404).send("Image not found or expired");
    res.setHeader("Content-Type", entry.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(entry.buffer);
  });

  return httpServer;
}
