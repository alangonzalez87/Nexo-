import { z } from "zod";

export const envelope = z.object({
  event: z.string().max(80),
  sessionId: z.string().min(1).max(255),
  timestamp: z.string().optional(),
  idempotencyKey: z.string().max(500).optional(),
  data: z.unknown(),
});
export const messageSchema = z.object({
  id: z.string().min(1).max(500),
  chatId: z.string().min(1).max(255),
  from: z.string().max(255).optional(),
  senderPhone: z.unknown().optional(),
  contact: z
    .object({ name: z.unknown().optional(), pushName: z.unknown().optional() })
    .nullish(),
  body: z.string().max(20000).nullish(),
  type: z.string().max(50),
  fromMe: z.boolean(),
  isGroup: z.boolean(),
  isStatusBroadcast: z.boolean().optional(),
  kind: z.string().optional(),
  media: z
    .object({
      mimetype: z.string().max(200),
      filename: z.string().max(255).optional(),
      data: z
        .string()
        .max(12 * 1024 * 1024)
        .optional(),
      omitted: z.boolean().optional(),
      sizeBytes: z.number().optional(),
    })
    .optional(),
});

export type WebhookMessage = z.infer<typeof messageSchema>;
