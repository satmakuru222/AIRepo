import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/prisma.js';
import { createChildLogger } from '../../shared/logger.js';
import { createQueue, QUEUE_NAMES } from '../../shared/queue.js';
import { validateWhatsAppWebhook } from '../validators/index.js';
import { config } from '../../shared/config.js';
import type { IngestJobPayload, WhatsAppWebhookPayload } from '../../shared/types.js';

const log = createChildLogger('route:whatsapp');

export async function whatsappRoutes(app: FastifyInstance) {
  const ingestQueue = createQueue(QUEUE_NAMES.INGEST);

  // ─── Verification endpoint (GET) for Meta webhook setup ──────────
  app.get('/webhook/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === config.WHATSAPP_VERIFY_TOKEN) {
      log.info('WhatsApp webhook verified');
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send({ error: 'Verification failed' });
  });

  // ─── Inbound message webhook (POST) ──────────────────────────────
  app.post('/webhook/whatsapp', async (request, reply) => {
    // 1. Validate signature
    validateWhatsAppWebhook(request);

    const body = request.body as WhatsAppWebhookPayload;
    if (body.object !== 'whatsapp_business_account') {
      return reply.status(200).send({ status: 'ignored' });
    }

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        const messages = change.value.messages;
        if (!messages) continue;

        for (const msg of messages) {
          if (msg.type !== 'text' || !msg.text?.body) continue;

          // 2. Resolve user by phone
          const user = await prisma.user.findUnique({
            where: { whatsappNumber: msg.from },
          });
          if (!user) {
            log.warn({ from: msg.from }, 'Unknown WhatsApp sender');
            continue;
          }

          // 3. Idempotency key
          const idempotencyKey = `${user.userId}:${msg.id}`;

          // 4. Check duplicate
          const existing = await prisma.inboundMessage.findUnique({
            where: { idempotencyKey },
          });
          if (existing) {
            log.info({ idempotencyKey }, 'Duplicate WhatsApp webhook – ignoring');
            continue;
          }

          // 5. Create inbound message
          const inbound = await prisma.inboundMessage.create({
            data: {
              userId: user.userId,
              channel: 'whatsapp',
              providerMessageId: msg.id,
              idempotencyKey,
              rawTextRedacted: msg.text.body,
              status: 'received',
            },
          });

          // 6. Enqueue ingest job
          const jobPayload: IngestJobPayload = {
            inboundId: inbound.inboundId,
            userId: user.userId,
          };
          await ingestQueue.add('ingest', jobPayload, {
            jobId: idempotencyKey,
          });

          log.info({ inboundId: inbound.inboundId, userId: user.userId }, 'WhatsApp message ingested');
        }
      }
    }

    // Always return 200 to Meta to avoid retries
    return reply.status(200).send({ status: 'accepted' });
  });
}
