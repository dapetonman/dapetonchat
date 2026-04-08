import type { InsertMessage, InsertUser, Message, User } from "@shared/schema";

type KvStore = {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
};

const kv = globalThis as typeof globalThis & { __kvStore?: KvStore };

function getStore(): KvStore {
  if (!kv.__kvStore) {
    const users = new Map<string, User & { password: string }>();
    const messages = new Map<number, Message>();
    let messageId = 1;

    kv.__kvStore = {
      async get<T>(key: string) {
        if (key === "users") return Array.from(users.values()) as T;
        if (key === "messages") return Array.from(messages.values()) as T;
        return undefined;
      },
      async set<T>(key: string, value: T) {
        if (key === "users" && Array.isArray(value)) {
          users.clear();
          for (const user of value as (User & { password: string })[]) users.set(user.username, user);
        }
        if (key === "messages" && Array.isArray(value)) {
          messages.clear();
          for (const message of value as Message[]) messages.set(message.id, message);
          messageId = Math.max(1, ...Array.from(messages.keys()).map(Number)) + 1;
        }
      },
    };

    (globalThis as any).__chatKvState = { users, messages, get messageId() { return messageId; }, set messageId(value: number) { messageId = value; } };
  }

  return kv.__kvStore;
}

const state = () => (globalThis as any).__chatKvState as {
  users: Map<string, User & { password: string }>;
  messages: Map<number, Message>;
  messageId: number;
};

export interface IStorage {
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getMessages(chatId: string): Promise<Message[]>;
  getMessage(id: number): Promise<Message | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  archiveOldMessages(before: Date): Promise<Message[]>;
}

export class DatabaseStorage implements IStorage {
  async getUserByUsername(username: string): Promise<User | undefined> {
    return state().users.get(username);
  }

  async createUser(user: InsertUser): Promise<User> {
    const created = {
      id: state().users.size + 1,
      username: user.username,
      password: user.password,
      createdAt: new Date(),
    } as User & { password: string };
    state().users.set(user.username, created);
    return created;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(state().users.values()).map(({ password, ...user }) => user);
  }

  async getMessages(chatId: string): Promise<Message[]> {
    return Array.from(state().messages.values())
      .filter((message) => message.chatId === chatId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getMessage(id: number): Promise<Message | undefined> {
    return state().messages.get(id);
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const message = {
      id: state().messageId++,
      username: insertMessage.username,
      content: insertMessage.content,
      chatId: insertMessage.chatId ?? "general",
      replyToId: insertMessage.replyToId ?? null,
      createdAt: new Date(),
    } as Message;
    state().messages.set(message.id, message);
    return message;
  }

  async archiveOldMessages(before: Date): Promise<Message[]> {
    const oldMessages = Array.from(state().messages.values()).filter((message) => message.createdAt < before);
    for (const message of oldMessages) state().messages.delete(message.id);
    return oldMessages;
  }
}

export const storage = new DatabaseStorage();
