import { z } from "zod";

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
