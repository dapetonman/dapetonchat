export type User = { id: number; username: string; createdAt: Date };
export type InsertUser = { username: string; password: string };

export type Message = {
  id: number;
  username: string;
  content: string;
  chatId: string;
  replyToId: number | null;
  createdAt: Date;
};
export type InsertMessage = { username: string; content: string; chatId: string; replyToId?: number | null };

export const MAIN_CHANNELS = ["general", "memes", "school work"] as const;

export const WS_EVENTS = {
  CHAT_MESSAGE: "chat_message",
  USER_LIST: "user_list",
  NOTIFICATION: "notification",
  MESSAGE_UPDATE: "message_update",
} as const;

export interface WsMessage<T = unknown> {
  type: keyof typeof WS_EVENTS;
  payload: T;
}

export function getDmChatId(userA: string, userB: string): string {
  return [userA, userB].sort().join("_");
}
