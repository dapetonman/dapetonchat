import type { InsertMessage, InsertUser, Message, User } from "@shared/schema";

const users = new Map<string, User & { password: string }>();
const messages = new Map<number, Message>();
let nextMessageId = 1;

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
    const user = users.get(username);
    if (!user) return undefined;
    const { password, ...publicUser } = user;
    return publicUser;
  }

  async createUser(user: InsertUser): Promise<User> {
    const created = {
      id: users.size + 1,
      username: user.username,
      password: user.password,
      createdAt: new Date(),
    } as User & { password: string };
    users.set(user.username, created);
    const { password, ...publicUser } = created;
    return publicUser;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(users.values()).map(({ password, ...user }) => user);
  }

  async getMessages(chatId: string): Promise<Message[]> {
    return Array.from(messages.values())
      .filter((message) => message.chatId === chatId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getMessage(id: number): Promise<Message | undefined> {
    return messages.get(id);
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const message: Message = {
      id: nextMessageId++,
      username: insertMessage.username,
      content: insertMessage.content,
      chatId: insertMessage.chatId ?? "general",
      replyToId: insertMessage.replyToId ?? null,
      createdAt: new Date(),
    };
    messages.set(message.id, message);
    return message;
  }

  async archiveOldMessages(before: Date): Promise<Message[]> {
    const oldMessages = Array.from(messages.values()).filter((message) => message.createdAt < before);
    for (const message of oldMessages) messages.delete(message.id);
    return oldMessages;
  }
}

export const storage = new DatabaseStorage();
