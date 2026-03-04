import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  content: text("content").notNull(),
  recipientId: text("recipient_id"), // null for public, username for private
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export type MessageResponse = Message;
export type MessagesListResponse = Message[];

export const WS_EVENTS = {
  CHAT_MESSAGE: 'chat_message',
  USER_LIST: 'user_list',
  NOTIFICATION: 'notification',
} as const;

export interface WsMessage<T = unknown> {
  type: keyof typeof WS_EVENTS;
  payload: T;
}