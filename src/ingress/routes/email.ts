import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { createChildLogger } from '../../shared/logger.js';
import { createQueue, QUEUE_NAMES } from '../../shared/queue.js';
import { validateEmailWebhook } from '../validators/index.js';
import type { IngestJobPayload } from '../../shared/types.js';

const log = createChildLogger('route:email');

const emailBodySchema = z.object({
  messageId: z.string().min(1),
  from: z.string().email(),
  to: z.string(),
  subject: z.string(),
  textBody: z.string().min(1),
  timestamp: z.string(),
});

export async function emailRoutes(app: FastifyInstance) {
  const ingestQueue = createQueue(QUEUE_NAMES.INGEST);

  app.post('/webhook/email', async (request, reply) => {
    // 1. Validate signature
    validateEmailWebhook(request);

    // 2. Parse body
    const parsed = emailBodySchema.safeParse(request.body);
    if (!parsed.success) {
      log.warn({ errors: parsed.error.flatten() }, 'Invalid email webhook payload');
      return reply.status(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });
    }
    const payload = parsed.data;

    // 3. Resolve user by email
    const user = await prisma.user.findUnique({
      where: { primaryEmail: payload.from },
    });
    if (!user) {
      log.warn({ from: payload.from }, 'Unknown sender email');
      return reply.status(200).send({ status: 'ignored', reason: 'unknown_sender' });
    }

    // 4. Build idempotency key
    const idempotencyKey = `${user.userId}:${payload.messageId}`;

    // 5. Upsert inbound message (idempotent)
    const existing = await prisma.inboundMessage.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      log.info({ idempotencyKey }, 'Duplicate email webhook – ignoring');
      return reply.status(200).send({ status: 'duplicate' });
    }

    const inbound = await prisma.inboundMessage.create({
      data: {
        userId: user.userId,
        channel: 'email',
        providerMessageId: payload.messageId,
        idempotencyKey,
        rawTextRedacted: `${payload.subject}\n${payload.textBody}`,
        status: 'received',
      },
    });

    // 6. Enqueue ingest job
    const jobPayload: IngestJobPayload = {
      inboundId: inbound.inboundId,
      userId: user.userId,
    };
    await ingestQueue.add('ingest', jobPayload, {
      jobId: idempotencyKey, // BullMQ deduplication
    });

    log.info({ inboundId: inbound.inboundId, userId: user.userId }, 'Email ingested');
    return reply.status(200).send({ status: 'accepted', inboundId: inbound.inboundId });
  });
}
