import fs from "fs/promises";
import path from "path";
import type { InsertMessage, InsertUser, Message, User } from "@shared/schema";

const dataDir = path.join(process.cwd(), "data");
const usersFile = path.join(dataDir, "users.json");
const messagesFile = path.join(dataDir, "messages.json");

let usersLoaded = false;
let messagesLoaded = false;
let nextUserId = 1;
let nextMessageId = 1;

const users = new Map<string, User & { password: string }>();
const messages = new Map<number, Message>();

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
      messages.set(message.id, { ...message, createdAt: new Date(message.createdAt) });
      nextMessageId = Math.max(nextMessageId, message.id + 1);
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

export interface IStorage {
  getUserByUsername(username: string): Promise<(User & { password: string }) | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getMessages(chatId: string): Promise<Message[]>;
  getMessage(id: number): Promise<Message | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  archiveOldMessages(before: Date): Promise<Message[]>;
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
    };
    messages.set(message.id, message);
    await saveMessages();
    return message;
  }

  async archiveOldMessages(before: Date): Promise<Message[]> {
    await loadMessages();
    const oldMessages = Array.from(messages.values()).filter((message) => message.createdAt < before);
    for (const message of oldMessages) messages.delete(message.id);
    await saveMessages();
    return oldMessages;
  }
}

export const storage = new DatabaseStorage();
