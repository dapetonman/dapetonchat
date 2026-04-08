# dapetonchat

A real-time chat application built with Express, PostgreSQL, WebSockets, and React.

## Architecture

### Backend
- **Express** server serving both API and frontend
- **PostgreSQL** database via Drizzle ORM
- **WebSockets** for real-time message delivery

### Frontend
- **React** with **Vite** (via Wouter routing)
- **TanStack Query** for data fetching and caching
- **shadcn/ui** components with Tailwind CSS
- Dark/light mode toggle

## Features
- Username + password account system (plain text, no encryption)
- General chat channel
- Private DM chats with a unique deterministic chatId per user pair
- Reply to messages (shift+click or hover button)
- Each chat is an isolated window showing only its own messages
- Users sidebar shows all registered accounts
- Dark/light theme toggle
- Daily message archiving via cron job

## Database Schema

### `users`
- `id` (serial PK)
- `username` (unique text)
- `password` (plain text)
- `created_at`

### `messages`
- `id` (serial PK)
- `username` (sender)
- `content`
- `chat_id` — "general" for public chat, or sorted pair like "alice_bob" for DMs
- `reply_to_id` (optional, self-referential)
- `created_at`

## Key Files
- `shared/schema.ts` — Drizzle schema + types
- `shared/routes.ts` — API route definitions
- `server/storage.ts` — Database access layer
- `server/routes.ts` — Express + WebSocket handlers
- `client/src/pages/chat.tsx` — Main chat UI
- `client/src/hooks/use-auth.ts` — Auth state (localStorage session)
- `client/src/hooks/use-chat.ts` — Message fetching, sending, WebSocket
