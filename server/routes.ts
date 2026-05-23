import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import multer from "multer";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { WS_EVENTS, type WsMessage } from "@shared/schema";
import type { LinkPreview } from "@shared/schema";

const ADMIN_USERNAME = "dapetonman";
const CLEANUP_MS = 60 * 60 * 1000;
const EDIT_WINDOW_MS = 5 * 60 * 1000;

const screenshotCache = new Map<string, { buffer: Buffer; contentType: string; originalName: string; size: number }>();
const upload = multer({ storage: multer.memoryStorage() });

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; dapetonchat/1.0; +https://dapetonchat.replit.app)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const getOg = (prop: string) => {
      const m =
        html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
      return m?.[1]?.trim() ?? undefined;
    };
    const getMeta = (name: string) => {
      const m =
        html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"));
      return m?.[1]?.trim() ?? undefined;
    };
    const title = getOg("title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const description = getOg("description") || getMeta("description");
    const image = getOg("image");
    if (!title && !description && !image) return null;
    return { url, title, description, image };
  } catch {
    return null;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Map<WebSocket, { username: string }>();
  const voiceRoom = new Set<string>();
  const voiceKicked = new Set<string>();

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
        console.log("[WS Server] Received:", msg.type, msg);

        if (msg.type === "identify") {
          clients.set(ws, { username: msg.username });
          ws.send(JSON.stringify({ type: "voice_users", users: [...voiceRoom] }));

          const allOnline = [...clients.entries()]
            .filter(([cws]) => cws !== ws && cws.readyState === WebSocket.OPEN)
            .map(([, info]) => info.username);
          ws.send(JSON.stringify({ type: "presence-sync", users: allOnline }));

          clients.forEach((info, clientWs) => {
            if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "presence", userId: msg.username, username: msg.username, online: true }));
            }
          });
          ws.send(JSON.stringify({ type: "presence", userId: msg.username, username: msg.username, online: true }));
        }

        const username = clients.get(ws)?.username;
        if (!username) return;

        if (msg.type === "typing" || msg.type === "presence" || msg.type === "initial-presence") {
          const payload = { ...msg, userId: msg.userId || username };
          const data = JSON.stringify(payload);
          wss.clients.forEach((clientWs) => {
            if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
              console.log(`[WS Server] Broadcasting ${msg.type} to ${clients.get(clientWs)?.username}:`, payload);
              clientWs.send(data);
            }
          });
          if (msg.status === "stopped") {
            const stoppedPayload = JSON.stringify({ type: "typing", chatId: msg.chatId, userId: msg.userId || username, username: msg.username || msg.userId, status: "stopped" });
            wss.clients.forEach((clientWs) => {
              if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(stoppedPayload);
              }
            });
          }
        }

        if (msg.type === "request-presence-sync") {
          const allOnline = [...clients.entries()]
            .filter(([cws]) => cws.readyState === WebSocket.OPEN)
            .map(([, info]) => info.username);
          ws.send(JSON.stringify({ type: "presence-sync", users: allOnline }));
        }

        if (msg.type === "voice_join") {
          if (voiceKicked.has(username)) return;
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
      const leftUsername = info?.username;
      if (leftUsername) {
        wss.clients.forEach((clientWs) => {
          if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "presence", userId: leftUsername, username: leftUsername, online: false }));
          }
        });
      }
      if (info && voiceRoom.has(info.username)) {
        voiceRoom.delete(info.username);
        broadcastVoiceUsers();
        clients.forEach((_, clientWs) => {
          if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "voice_peer_left", username: info.username }));
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

  function broadcastMessageUpdate(message: any, chatId: string) {
    const data = JSON.stringify({ type: "message_update", payload: message });
    clients.forEach((info, client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (chatId === "general" || chatId.split("_").includes(info.username)) client.send(data);
    });
  }

  function broadcastMessageDelete(messageId: number, chatId: string) {
    const data = JSON.stringify({ type: "message_delete", payload: { messageId, chatId } });
    clients.forEach((info, client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (chatId === "general" || chatId.split("_").includes(info.username)) client.send(data);
    });
  }

  function broadcastReactionUpdate(messageId: number, chatId: string, reactions: any[]) {
    const data = JSON.stringify({ type: "reaction_update", payload: { messageId, chatId, reactions } });
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

  function broadcastUserListUpdate() {
    console.log("[Broadcast] Sending REFRESH_USER_LIST to all clients");
    const data = JSON.stringify({ type: "REFRESH_USER_LIST" });
    clients.forEach((_, client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        console.log("[Broadcast] Sent to client");
      }
    });
  }

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) return res.status(400).json({ message: "Username and password required" });
      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(409).json({ message: "Username already taken" });
      const user = await storage.createUser({ username, password });
      console.log("[Register] User created:", user.username, "broadcasting refresh");
      broadcastUserListUpdate();
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

      // Fetch link preview asynchronously — broadcast updated message after fetch
      const urlMatch = content.match(URL_REGEX);
      if (urlMatch) {
        fetchLinkPreview(urlMatch[0]).then(async (preview) => {
          if (!preview) {
            broadcastToChat(message, chatId);
            return;
          }
          const updated = await storage.updateMessage(message.id, content, preview);
          broadcastToChat(updated ?? message, chatId);
        }).catch(() => {
          broadcastToChat(message, chatId);
        });
        res.status(201).json(message);
      } else {
        broadcastToChat(message, chatId);
        res.status(201).json(message);
      }
    } catch (err) {
      console.error("Send message error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/messages/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { username, content } = req.body ?? {};
      if (!username || !content) return res.status(400).json({ message: "username and content are required" });
      const existing = await storage.getMessage(id);
      if (!existing) return res.status(404).json({ message: "Message not found" });
      const isAdmin = username === ADMIN_USERNAME;
      const isOwner = existing.username === username;
      const withinWindow = Date.now() - new Date(existing.createdAt).getTime() < EDIT_WINDOW_MS;
      if (!isAdmin && (!isOwner || !withinWindow)) {
        return res.status(403).json({ message: "Cannot edit this message" });
      }

      // Fetch new link preview if URL present
      const urlMatch = content.match(URL_REGEX);
      const preview = urlMatch ? await fetchLinkPreview(urlMatch[0]).catch(() => null) : null;
      const updated = await storage.updateMessage(id, content, preview);
      if (!updated) return res.status(404).json({ message: "Message not found" });
      broadcastMessageUpdate(updated, updated.chatId);
      res.json(updated);
    } catch (err) {
      console.error("Edit message error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/messages/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { username } = req.body ?? {};
      if (!username) return res.status(400).json({ message: "username required" });
      const existing = await storage.getMessage(id);
      if (!existing) return res.status(404).json({ message: "Message not found" });
      const isAdmin = username === ADMIN_USERNAME;
      const isOwner = existing.username === username;
      if (!isAdmin && !isOwner) return res.status(403).json({ message: "Cannot delete this message" });
      const chatId = existing.chatId;
      await storage.deleteMessage(id);
      broadcastMessageDelete(id, chatId);
      res.json({ ok: true });
    } catch (err) {
      console.error("Delete single message error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/reactions", async (req, res) => {
    try {
      const chatId = (req.query.chatId as string) || "general";
      const msgs = await storage.getMessages(chatId);
      const messageIds = msgs.map((m) => m.id);
      const reactions = await storage.getReactionsForMessages(messageIds);
      res.json(reactions);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/reactions", async (req, res) => {
    try {
      const { messageId, username, emoji } = req.body ?? {};
      if (!messageId || !username || !emoji) return res.status(400).json({ message: "messageId, username, and emoji required" });
      const msg = await storage.getMessage(messageId);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      const updated = await storage.toggleReaction(messageId, username, emoji);
      broadcastReactionUpdate(messageId, msg.chatId, updated);
      res.json(updated);
    } catch (err) {
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

  app.post("/api/voice/kick-all", async (req, res) => {
    try {
      const { username } = req.body ?? {};
      if (username !== ADMIN_USERNAME) return res.status(403).json({ message: "Forbidden" });
      [...voiceRoom].forEach((user) => voiceKicked.add(user));
      voiceRoom.clear();
      broadcastVoiceUsers();
      clients.forEach((_, clientWs) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "voice_peer_left", username: "__all__" }));
        }
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("Kick voice users error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/upload", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      const { username, chatId } = req.body ?? {};
      if (!username || !chatId) return res.status(400).json({ message: "username and chatId are required" });
      const id = randomBytes(16).toString("hex");
      const originalName = req.file.originalname || "file";
      const fileSize = req.file.size;
      const contentType = req.file.mimetype || "application/octet-stream";
      screenshotCache.set(id, { buffer: req.file.buffer, contentType, originalName, size: fileSize });
      setTimeout(() => screenshotCache.delete(id), CLEANUP_MS);
      const fileUrl = `/view/${id}`;
      const isImage = contentType.startsWith("image/");
      const content = isImage
        ? fileUrl
        : `__file__:${JSON.stringify({ url: fileUrl, name: originalName, size: fileSize })}`;
      const message = await storage.createMessage({ username, content, chatId, replyToId: null });
      broadcastToChat(message, chatId);
      res.json({ url: fileUrl, name: originalName, size: fileSize });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

app.get("/view/:id", (req, res) => {
  const entry = screenshotCache.get(req.params.id);
  if (!entry) return res.status(404).send("Image not found or expired");

  const totalSize = entry.size;
  const range = req.headers.range;

  // 1. Support HTML5 multi-media timeline seeking / chunk streaming
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

    // Guard against malformed or out-of-bounds headers
    if (start >= totalSize || end >= totalSize || start > end) {
      res.setHeader("Content-Range", `bytes */${totalSize}`);
      return res.status(416).send("Requested Range Not Satisfiable");
    }

    const chunkSize = (end - start) + 1;
    // Slice only the requested chunk out of your memory buffer
    const chunk = entry.buffer.subarray(start, end + 1);

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": entry.contentType,
    });

    return res.end(chunk);
  } 
  
  // 2. Regular initial fallback delivery (Used for Images and regular file downloads)
  res.writeHead(200, {
    "Content-Length": totalSize,
    "Content-Type": entry.contentType, // CRITICAL: Tells the browser it's an image/audio/etc.
    "Accept-Ranges": "bytes",           // Tells the audio player it's allowed to seek next time
  });
  return res.end(entry.buffer);
});

  return httpServer;
}
