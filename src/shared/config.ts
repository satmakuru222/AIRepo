import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // ─── Core ──────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ─── Ingress ───────────────────────────────────────────────────────
  INGRESS_PORT: z.coerce.number().default(3000),
  ADMIN_PORT: z.coerce.number().default(3001),

  // ─── Database ──────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1),

  // ─── Redis ─────────────────────────────────────────────────────────
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // ─── Claude API ────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().min(1),

  // ─── Email (AWS SES) ──────────────────────────────────────────────
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  SES_FROM_EMAIL: z.string().default('concierge@example.com'),

  // ─── WhatsApp (Meta Cloud API) ─────────────────────────────────────
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default('concierge-verify-token'),
  WHATSAPP_APP_SECRET: z.string().default(''),

  // ─── Email webhook validation ──────────────────────────────────────
  EMAIL_WEBHOOK_SECRET: z.string().default(''),

  // ─── Outbox ────────────────────────────────────────────────────────
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(5),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(5000),

  // ─── Scheduler ─────────────────────────────────────────────────────
  SCHEDULER_CRON: z.string().default('* * * * *'), // every minute

  // ─── Data retention ────────────────────────────────────────────────
  RETENTION_DAYS: z.coerce.number().default(60),
});

export type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
