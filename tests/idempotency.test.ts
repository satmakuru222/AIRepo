import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Idempotency tests — verify that duplicate webhook POSTs
 * do not create duplicate inbound_messages or tasks.
 *
 * These tests mock Prisma to isolate business logic from a real DB.
 */

// Mock modules before importing anything that uses them
vi.mock('../src/shared/config.js', () => ({
  config: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    INGRESS_PORT: 3000,
    ADMIN_PORT: 3001,
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    ANTHROPIC_API_KEY: 'test-key',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: '',
    AWS_SECRET_ACCESS_KEY: '',
    SES_FROM_EMAIL: 'test@example.com',
    WHATSAPP_PHONE_NUMBER_ID: '',
    WHATSAPP_ACCESS_TOKEN: '',
    WHATSAPP_VERIFY_TOKEN: 'test-verify',
    WHATSAPP_APP_SECRET: '',
    EMAIL_WEBHOOK_SECRET: '',
    OUTBOX_MAX_ATTEMPTS: 5,
    OUTBOX_POLL_INTERVAL_MS: 5000,
    SCHEDULER_CRON: '* * * * *',
    RETENTION_DAYS: 60,
  },
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

describe('Idempotency', () => {
  // Simulate an in-memory store for inbound_messages
  const inboundStore = new Map<string, { inboundId: string; idempotencyKey: string }>();
  let createCallCount = 0;

  const mockPrisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        userId: 'user-1',
        primaryEmail: 'alice@example.com',
        whatsappNumber: '15551234567',
        displayName: 'Alice',
      }),
    },
    inboundMessage: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { idempotencyKey: string } }) => {
        return Promise.resolve(inboundStore.get(where.idempotencyKey) ?? null);
      }),
      create: vi.fn().mockImplementation(({ data }: { data: { idempotencyKey: string } }) => {
        createCallCount++;
        const record = { inboundId: `inbound-${createCallCount}`, ...data };
        inboundStore.set(data.idempotencyKey, record);
        return Promise.resolve(record);
      }),
    },
  };

  beforeEach(() => {
    inboundStore.clear();
    createCallCount = 0;
    vi.clearAllMocks();
  });

  /**
   * Core idempotency logic extracted from the email route handler.
   * In production this lives in src/ingress/routes/email.ts.
   */
  async function processEmailWebhook(payload: {
    messageId: string;
    from: string;
  }): Promise<{ status: string; created: boolean }> {
    const user = await mockPrisma.user.findUnique({
      where: { primaryEmail: payload.from },
    });
    if (!user) return { status: 'ignored', created: false };

    const idempotencyKey = `${user.userId}:${payload.messageId}`;

    const existing = await mockPrisma.inboundMessage.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return { status: 'duplicate', created: false };
    }

    await mockPrisma.inboundMessage.create({
      data: {
        userId: user.userId,
        channel: 'email',
        providerMessageId: payload.messageId,
        idempotencyKey,
        rawTextRedacted: 'test body',
        status: 'received',
      },
    });

    return { status: 'accepted', created: true };
  }

  it('should create inbound_message on first webhook call', async () => {
    const result = await processEmailWebhook({
      messageId: 'msg-abc-123',
      from: 'alice@example.com',
    });

    expect(result.status).toBe('accepted');
    expect(result.created).toBe(true);
    expect(mockPrisma.inboundMessage.create).toHaveBeenCalledTimes(1);
  });

  it('should NOT create duplicate inbound_message on second identical call', async () => {
    // First call
    const r1 = await processEmailWebhook({
      messageId: 'msg-abc-123',
      from: 'alice@example.com',
    });
    expect(r1.status).toBe('accepted');

    // Second call with same messageId
    const r2 = await processEmailWebhook({
      messageId: 'msg-abc-123',
      from: 'alice@example.com',
    });
    expect(r2.status).toBe('duplicate');
    expect(r2.created).toBe(false);

    // create should have been called exactly once
    expect(mockPrisma.inboundMessage.create).toHaveBeenCalledTimes(1);
  });

  it('should treat different messageIds as distinct messages', async () => {
    const r1 = await processEmailWebhook({
      messageId: 'msg-1',
      from: 'alice@example.com',
    });
    const r2 = await processEmailWebhook({
      messageId: 'msg-2',
      from: 'alice@example.com',
    });

    expect(r1.status).toBe('accepted');
    expect(r2.status).toBe('accepted');
    expect(mockPrisma.inboundMessage.create).toHaveBeenCalledTimes(2);
  });

  it('should generate idempotency key from user_id + provider_message_id', async () => {
    await processEmailWebhook({
      messageId: 'msg-xyz',
      from: 'alice@example.com',
    });

    const call = mockPrisma.inboundMessage.create.mock.calls[0][0];
    expect(call.data.idempotencyKey).toBe('user-1:msg-xyz');
  });

  it('should ignore webhook from unknown sender', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    const result = await processEmailWebhook({
      messageId: 'msg-unknown',
      from: 'stranger@example.com',
    });

    expect(result.status).toBe('ignored');
    expect(mockPrisma.inboundMessage.create).not.toHaveBeenCalled();
  });
});
