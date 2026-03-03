import { messages, type Message, type InsertMessage } from "@shared/schema";
import { db } from "./db";
import { or, eq, isNull, and } from "drizzle-orm";

export interface IStorage {
  getMessages(username?: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
}

export class DatabaseStorage implements IStorage {
  async getMessages(username?: string): Promise<Message[]> {
    if (!username) {
      return await db.select().from(messages).where(isNull(messages.recipientId)).orderBy(messages.createdAt);
    }
    return await db.select().from(messages).where(
      or(
        isNull(messages.recipientId),
        eq(messages.recipientId, username),
        eq(messages.username, username)
      )
    ).orderBy(messages.createdAt);
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(insertMessage).returning();
    return message;
  }
}

export const storage = new DatabaseStorage();
