import { z } from "zod";
import { pgTable, integer, text, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: integer("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messagesTable = pgTable("messages", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
  content: text("content").notNull(),
  chatId: text("chat_id").notNull(),
  replyToId: integer("reply_to_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  editedAt: timestamp("edited_at"),
  linkPreview: jsonb("link_preview"),
});

export const reactionsTable = pgTable("reactions", {
  messageId: integer("message_id").notNull(),
  emoji: text("emoji").notNull(),
  username: text("username").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.messageId, table.emoji, table.username] }),
}));

export type User = { id: number; username: string; createdAt: Date };
export type InsertUser = { username: string; password: string };
export const insertUserSchema = z.object({ username: z.string(), password: z.string() });

export type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
};

export type Message = {
  id: number;
  username: string;
  content: string;
  chatId: string;
  replyToId: number | null;
  createdAt: Date;
  editedAt?: Date | null;
  linkPreview?: LinkPreview | null;
};
export type InsertMessage = { username: string; content: string; chatId: string; replyToId?: number | null };
export const insertMessageSchema = z.object({ username: z.string(), content: z.string(), chatId: z.string(), replyToId: z.number().nullable().optional() });

export const MAIN_CHANNELS = ["general"] as const;
export const CHANNEL_MESSAGE_IDS = {
  general: "general",
} as const;

export const WS_EVENTS = {
  CHAT_MESSAGE: "chat_message",
  USER_LIST: "user_list",
  NOTIFICATION: "notification",
  MESSAGE_UPDATE: "message_update",
} as const;

export interface WsMessage<T = unknown> {
  type: (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
  payload: T;
}

export function getDmChatId(userA: string, userB: string): string {
  return [userA, userB].sort().join("_");
}

export type Reaction = { emoji: string; usernames: string[] };
