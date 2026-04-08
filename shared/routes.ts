import { z } from 'zod';
import { insertMessageSchema, insertUserSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    register: {
      method: 'POST' as const,
      path: '/api/auth/register' as const,
      input: insertUserSchema,
    },
    login: {
      method: 'POST' as const,
      path: '/api/auth/login' as const,
      input: z.object({ username: z.string(), password: z.string() }),
    },
  },
  users: {
    list: {
      method: 'GET' as const,
      path: '/api/users' as const,
    },
  },
  messages: {
    list: {
      method: 'GET' as const,
      path: '/api/messages' as const,
    },
    create: {
      method: 'POST' as const,
      path: '/api/messages' as const,
      input: insertMessageSchema,
    },
  },
};
