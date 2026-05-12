import fs from "fs/promises";
import path from "path";
import type { InsertMessage, InsertUser, Message, User, Reaction } from "@shared/schema";

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
    const { password, ...publicUser } = created;
    return publicUser;
  }

  async getAllUsers(): Promise<User[]> {
    await loadUsers();
    return Array.from(users.values()).map(({ password, ...user }) => user);
  }

  async getMessages(chatId: string): Promise<Message[]> {
    await loadMessages();
    return Array.from(messages.values())
      .filter((message) => message.chatId === chatId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getMessage(id: number): Promise<Message | undefined> {
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
    return updated;
  }

  async deleteMessage(id: number): Promise<boolean> {
    await loadMessages();
    if (!messages.has(id)) return false;
    messages.delete(id);
    await saveMessages();
    return true;
  }

  async deleteAllMessages(): Promise<void> {
    await loadMessages();
    messages.clear();
    nextMessageId = 1;
    await saveMessages();
  }

  async deleteAllUsers(): Promise<void> {
    await loadUsers();
    users.clear();
    nextUserId = 1;
    await saveUsers();
  }

  async archiveOldMessages(before: Date): Promise<Message[]> {
    await loadMessages();
    const oldMessages = Array.from(messages.values()).filter((message) => message.createdAt < before);
    for (const message of oldMessages) messages.delete(message.id);
    await saveMessages();
    return oldMessages;
  }

  async getReactionsForMessages(messageIds: number[]): Promise<Array<{ messageId: number; emoji: string; usernames: string[] }>> {
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
    const result: Reaction[] = [];
    emojiMap.forEach((uns, em) => { if (uns.length > 0) result.push({ emoji: em, usernames: uns }); });
    return result;
  }
}

export const storage = new DatabaseStorage();
