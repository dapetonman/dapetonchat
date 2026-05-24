import fs from "fs/promises";
import path from "path";
import { eq, and, inArray, asc, lt } from "drizzle-orm";
import type { InsertMessage, InsertUser, Message, User, Reaction, LinkPreview } from "@shared/schema";
import { usersTable, messagesTable, reactionsTable } from "@shared/schema";
import { db } from "./db";

const dataDir = path.join(process.cwd(), "data");
const usersFile = path.join(dataDir, "users.json");
const messagesFile = path.join(dataDir, "messages.json");
const reactionsFile = path.join(dataDir, "reactions.json");

let usersLoaded = false;
let messagesLoaded = false;
let reactionsLoaded = false;
let nextUserId = 1;
let nextMessageId = 1;

const users = new Map<string, User & { password: string }>();
const messages = new Map<number, Message>();
const reactions = new Map<number, Map<string, string[]>>();

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function loadUsers() {
  if (usersLoaded) return;
  usersLoaded = true;
  try {
    const raw = await fs.readFile(usersFile, "utf8");
    const list = JSON.parse(raw) as Array<User & { password: string }>;
    users.clear();
    for (const user of list) {
      users.set(user.username, { ...user, createdAt: new Date(user.createdAt) });
      nextUserId = Math.max(nextUserId, user.id + 1);
    }
  } catch {}
}

async function loadMessages() {
  if (messagesLoaded) return;
  messagesLoaded = true;
  try {
    const raw = await fs.readFile(messagesFile, "utf8");
    const list = JSON.parse(raw) as Array<Message>;
    messages.clear();
    for (const message of list) {
      messages.set(message.id, {
        ...message,
        createdAt: new Date(message.createdAt),
        editedAt: message.editedAt ? new Date(message.editedAt) : null,
      });
      nextMessageId = Math.max(nextMessageId, message.id + 1);
    }
  } catch {}
}

async function loadReactions() {
  if (reactionsLoaded) return;
  reactionsLoaded = true;
  try {
    const raw = await fs.readFile(reactionsFile, "utf8");
    const data = JSON.parse(raw) as Array<{ messageId: number; emoji: string; usernames: string[] }>;
    reactions.clear();
    for (const item of data) {
      if (!reactions.has(item.messageId)) reactions.set(item.messageId, new Map());
      reactions.get(item.messageId)!.set(item.emoji, item.usernames);
    }
  } catch {}
}

async function saveUsers() {
  await ensureDir();
  await fs.writeFile(usersFile, JSON.stringify(Array.from(users.values()), null, 2));
}

async function saveMessages() {
  await ensureDir();
  await fs.writeFile(messagesFile, JSON.stringify(Array.from(messages.values()), null, 2));
}

async function saveReactions() {
  await ensureDir();
  const data: Array<{ messageId: number; emoji: string; usernames: string[] }> = [];
  reactions.forEach((emojiMap, messageId) => {
    emojiMap.forEach((usernames, emoji) => {
      if (usernames.length > 0) data.push({ messageId, emoji, usernames });
    });
  });
  await fs.writeFile(reactionsFile, JSON.stringify(data, null, 2));
}

function groupReactionRows(rows: { messageId: number; emoji: string; username: string }[]): Map<number, Map<string, string[]>> {
  const grouped = new Map<number, Map<string, string[]>>();
  for (const row of rows) {
    if (!grouped.has(row.messageId)) grouped.set(row.messageId, new Map());
    const emojiMap = grouped.get(row.messageId)!;
    if (!emojiMap.has(row.emoji)) emojiMap.set(row.emoji, []);
    emojiMap.get(row.emoji)!.push(row.username);
  }
  return grouped;
}

export interface IStorage {
  getUserByUsername(username: string): Promise<(User & { password: string }) | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getMessages(chatId: string): Promise<Message[]>;
  getMessage(id: number): Promise<Message | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  updateMessage(id: number, content: string, linkPreview?: Message["linkPreview"]): Promise<Message | undefined>;
  deleteMessage(id: number): Promise<boolean>;
  deleteAllMessages(): Promise<void>;
  deleteAllUsers(): Promise<void>;
  archiveOldMessages(before: Date): Promise<Message[]>;
  getReactionsForMessages(messageIds: number[]): Promise<Array<{ messageId: number; emoji: string; usernames: string[] }>>;
  toggleReaction(messageId: number, username: string, emoji: string): Promise<Reaction[]>;
}

export class DatabaseStorage implements IStorage {
  async getUserByUsername(username: string): Promise<(User & { password: string }) | undefined> {
    if (db) {
      try {
        const rows = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
        if (rows.length > 0) {
          const row = rows[0];
          return { id: row.id, username: row.username, password: row.password, createdAt: row.createdAt };
        }
        return undefined;
      } catch (err) {
        console.warn("[DB] getUserByUsername failed, falling back to local:", err);
      }
    }
    await loadUsers();
    return users.get(username);
  }

  async createUser(user: InsertUser): Promise<User> {
    await loadUsers();
    const created = {
      id: nextUserId++,
      username: user.username,
      password: user.password,
      createdAt: new Date(),
    } as User & { password: string };
    users.set(user.username, created);
    await saveUsers();
    if (db) {
      try {
        await db.insert(usersTable).values({ id: created.id, username: created.username, password: created.password, createdAt: created.createdAt });
      } catch (err) {
        console.warn("[DB] createUser failed:", err);
      }
    }
    const { password, ...publicUser } = created;
    return publicUser;
  }

  async getAllUsers(): Promise<User[]> {
    if (db) {
      try {
        const rows = await db.select({ id: usersTable.id, username: usersTable.username, createdAt: usersTable.createdAt }).from(usersTable);
        return rows;
      } catch (err) {
        console.warn("[DB] getAllUsers failed, falling back to local:", err);
      }
    }
    await loadUsers();
    return Array.from(users.values()).map(({ password, ...user }) => user);
  }

  async getMessages(chatId: string): Promise<Message[]> {
    if (db) {
      try {
        const rows = await db.select().from(messagesTable).where(eq(messagesTable.chatId, chatId)).orderBy(asc(messagesTable.createdAt));
        return rows.map((row) => ({
          id: row.id,
          username: row.username,
          content: row.content,
          chatId: row.chatId,
          replyToId: row.replyToId,
          createdAt: row.createdAt,
          editedAt: row.editedAt ?? null,
          linkPreview: row.linkPreview as LinkPreview | null | undefined,
        }));
      } catch (err) {
        console.warn("[DB] getMessages failed, falling back to local:", err);
      }
    }
    await loadMessages();
    return Array.from(messages.values())
      .filter((message) => message.chatId === chatId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getMessage(id: number): Promise<Message | undefined> {
    if (db) {
      try {
        const rows = await db.select().from(messagesTable).where(eq(messagesTable.id, id)).limit(1);
        if (rows.length > 0) {
          const row = rows[0];
          return {
            id: row.id,
            username: row.username,
            content: row.content,
            chatId: row.chatId,
            replyToId: row.replyToId,
            createdAt: row.createdAt,
            editedAt: row.editedAt ?? null,
            linkPreview: row.linkPreview as LinkPreview | null | undefined,
          };
        }
        return undefined;
      } catch (err) {
        console.warn("[DB] getMessage failed, falling back to local:", err);
      }
    }
    await loadMessages();
    return messages.get(id);
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    await loadMessages();
    const message: Message = {
      id: nextMessageId++,
      username: insertMessage.username,
      content: insertMessage.content,
      chatId: insertMessage.chatId ?? "general",
      replyToId: insertMessage.replyToId ?? null,
      createdAt: new Date(),
      editedAt: null,
      linkPreview: null,
    };
    messages.set(message.id, message);
    await saveMessages();
    if (db) {
      try {
        await db.insert(messagesTable).values({
          id: message.id,
          username: message.username,
          content: message.content,
          chatId: message.chatId,
          replyToId: message.replyToId,
          createdAt: message.createdAt,
          editedAt: null,
          linkPreview: null,
        });
      } catch (err) {
        console.warn("[DB] createMessage failed:", err);
      }
    }
    return message;
  }

  async updateMessage(id: number, content: string, linkPreview?: Message["linkPreview"]): Promise<Message | undefined> {
    await loadMessages();
    const message = messages.get(id);
    if (!message) return undefined;
    const updated: Message = {
      ...message,
      content,
      editedAt: new Date(),
      linkPreview: linkPreview !== undefined ? linkPreview : message.linkPreview,
    };
    messages.set(id, updated);
    await saveMessages();
    if (db) {
      try {
        const setData: Record<string, unknown> = { content: updated.content, editedAt: updated.editedAt };
        if (linkPreview !== undefined) {
          setData.linkPreview = linkPreview;
        }
        await db.update(messagesTable).set(setData).where(eq(messagesTable.id, id));
      } catch (err) {
        console.warn("[DB] updateMessage failed:", err);
      }
    }
    return updated;
  }

  async deleteMessage(id: number): Promise<boolean> {
    await loadMessages();
    if (!messages.has(id)) return false;
    messages.delete(id);
    await saveMessages();
    if (db) {
      try {
        await db.delete(messagesTable).where(eq(messagesTable.id, id));
        await db.delete(reactionsTable).where(eq(reactionsTable.messageId, id));
      } catch (err) {
        console.warn("[DB] deleteMessage failed:", err);
      }
    }
    return true;
  }

  async deleteAllMessages(): Promise<void> {
    await loadMessages();
    messages.clear();
    nextMessageId = 1;
    await saveMessages();
    if (db) {
      try {
        await db.delete(reactionsTable);
        await db.delete(messagesTable);
      } catch (err) {
        console.warn("[DB] deleteAllMessages failed:", err);
      }
    }
  }

  async deleteAllUsers(): Promise<void> {
    await loadUsers();
    users.clear();
    nextUserId = 1;
    await saveUsers();
    if (db) {
      try {
        await db.delete(usersTable);
      } catch (err) {
        console.warn("[DB] deleteAllUsers failed:", err);
      }
    }
  }

  async archiveOldMessages(before: Date): Promise<Message[]> {
    await loadMessages();
    const oldMessages = Array.from(messages.values()).filter((message) => message.createdAt < before);
    for (const message of oldMessages) messages.delete(message.id);
    await saveMessages();
    if (db) {
      try {
        await db.delete(messagesTable).where(lt(messagesTable.createdAt, before));
        const ids = oldMessages.map((m) => m.id);
        if (ids.length > 0) {
          await db.delete(reactionsTable).where(inArray(reactionsTable.messageId, ids));
        }
      } catch (err) {
        console.warn("[DB] archiveOldMessages failed:", err);
      }
    }
    return oldMessages;
  }

  async getReactionsForMessages(messageIds: number[]): Promise<Array<{ messageId: number; emoji: string; usernames: string[] }>> {
    if (db && messageIds.length > 0) {
      try {
        const rows = await db.select().from(reactionsTable).where(inArray(reactionsTable.messageId, messageIds));
        const grouped = groupReactionRows(rows);
        const result: Array<{ messageId: number; emoji: string; usernames: string[] }> = [];
        grouped.forEach((emojiMap, messageId) => {
          emojiMap.forEach((usernames, emoji) => {
            if (usernames.length > 0) result.push({ messageId, emoji, usernames });
          });
        });
        return result;
      } catch (err) {
        console.warn("[DB] getReactionsForMessages failed, falling back to local:", err);
      }
    }
    await loadReactions();
    const result: Array<{ messageId: number; emoji: string; usernames: string[] }> = [];
    for (const mid of messageIds) {
      const emojiMap = reactions.get(mid);
      if (emojiMap) {
        emojiMap.forEach((usernames, emoji) => {
          if (usernames.length > 0) result.push({ messageId: mid, emoji, usernames });
        });
      }
    }
    return result;
  }

  async toggleReaction(messageId: number, username: string, emoji: string): Promise<Reaction[]> {
    await loadReactions();
    if (!reactions.has(messageId)) reactions.set(messageId, new Map());
    const emojiMap = reactions.get(messageId)!;
    if (!emojiMap.has(emoji)) emojiMap.set(emoji, []);
    const usernames = emojiMap.get(emoji)!;
    const idx = usernames.indexOf(username);
    if (idx >= 0) {
      usernames.splice(idx, 1);
      if (usernames.length === 0) emojiMap.delete(emoji);
    } else {
      usernames.push(username);
    }
    await saveReactions();
    if (db) {
      try {
        const existing = await db.select().from(reactionsTable)
          .where(and(
            eq(reactionsTable.messageId, messageId),
            eq(reactionsTable.emoji, emoji),
            eq(reactionsTable.username, username),
          ))
          .limit(1);
        if (existing.length > 0) {
          await db.delete(reactionsTable)
            .where(and(
              eq(reactionsTable.messageId, messageId),
              eq(reactionsTable.emoji, emoji),
              eq(reactionsTable.username, username),
            ));
        } else {
          await db.insert(reactionsTable).values({ messageId, emoji, username });
        }
      } catch (err) {
        console.warn("[DB] toggleReaction failed:", err);
      }
    }
    const result: Reaction[] = [];
    emojiMap.forEach((uns, em) => { if (uns.length > 0) result.push({ emoji: em, usernames: uns }); });
    return result;
  }
}

export const storage = new DatabaseStorage();
