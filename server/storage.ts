import { messages, users, type Message, type InsertMessage, type User, type InsertUser } from "@shared/schema";
import { db } from "./db";
import { eq, lt, asc } from "drizzle-orm";

export interface IStorage {
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getMessages(chatId: string): Promise<Message[]>;
  getMessage(id: number): Promise<Message | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  archiveOldMessages(before: Date): Promise<Message[]>;
}

const fallbackUsers = new Map<string, User & { password: string }>();

export class DatabaseStorage implements IStorage {
  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.username, username));
      return user;
    } catch {
      return fallbackUsers.get(username);
    }
  }

  async createUser(user: InsertUser): Promise<User> {
    try {
      const [created] = await db.insert(users).values(user).returning();
      return created;
    } catch {
      const created = {
        id: fallbackUsers.size + 1,
        username: user.username,
        password: user.password,
        createdAt: new Date(),
      } as User & { password: string };
      fallbackUsers.set(user.username, created);
      return created;
    }
  }

  async getAllUsers(): Promise<User[]> {
    try {
      return await db.select().from(users).orderBy(asc(users.createdAt));
    } catch {
      return Array.from(fallbackUsers.values()).map(({ password, ...user }) => user);
    }
  }

  async getMessages(chatId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt));
  }

  async getMessage(id: number): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message;
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(insertMessage).returning();
    return message;
  }

  async archiveOldMessages(before: Date): Promise<Message[]> {
    const oldMessages = await db.select().from(messages).where(lt(messages.createdAt, before));
    await db.delete(messages).where(lt(messages.createdAt, before));
    return oldMessages;
  }
}

export const storage = new DatabaseStorage();
