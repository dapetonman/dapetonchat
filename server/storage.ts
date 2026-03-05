import { messages, type Message, type InsertMessage } from "@shared/schema";
import { db } from "./db";
import { or, eq, isNull, and, lt } from "drizzle-orm";

export interface IStorage {
  getMessages(username?: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  updateMessageReactions(id: number, reactions: any): Promise<Message>;
  deleteUserMessages(username: string): Promise<void>;
  archiveOldMessages(before: Date): Promise<Message[]>;
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

  async updateMessageReactions(id: number, reactions: any): Promise<Message> {
    const [message] = await db.update(messages).set({ reactions }).where(eq(messages.id, id)).returning();
    return message;
  }

  async deleteUserMessages(username: string): Promise<void> {
    await db.delete(messages).where(eq(messages.username, username));
  }

  async archiveOldMessages(before: Date): Promise<Message[]> {
    const oldMessages = await db.select().from(messages).where(lt(messages.createdAt, before));
    await db.delete(messages).where(lt(messages.createdAt, before));
    return oldMessages;
  }
}

export const storage = new DatabaseStorage();
