import { Cron } from 'croner';
import { prisma } from '../shared/prisma.js';
import { createChildLogger } from '../shared/logger.js';
import { config } from '../shared/config.js';
import { sendEmail } from '../services/email-sender.js';
import { sendWhatsApp } from '../services/whatsapp-sender.js';
import { recordTaskEvent } from '../services/task-events.js';
import type { OutboxPayload } from '../shared/types.js';

const log = createChildLogger('outbox-worker');

const MAX_ATTEMPTS = config.OUTBOX_MAX_ATTEMPTS;

function computeNextRetry(attempts: number): Date {
  // Exponential backoff: 30s, 60s, 120s, 240s, 480s
  const delayMs = Math.min(30_000 * Math.pow(2, attempts), 600_000);
  return new Date(Date.now() + delayMs);
}

async function pollOutbox(): Promise<void> {
  const now = new Date();

  // Claim a batch of queued messages atomically
  const messages = await prisma.$queryRaw<
    Array<{
      outbox_id: string;
      task_id: string | null;
      user_id: string;
      channel: string;
      payload: OutboxPayload;
      attempts: number;
    }>
  >`
    UPDATE outbox
    SET status = 'sending', updated_at = NOW()
    WHERE outbox_id IN (
      SELECT outbox_id FROM outbox
      WHERE status = 'queued' AND next_retry_at <= ${now}
      ORDER BY next_retry_at ASC
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    )
    RETURNING outbox_id, task_id, user_id, channel, payload, attempts
  `;

  if (messages.length === 0) return;

  log.info({ count: messages.length }, 'Processing outbox batch');

  for (const msg of messages) {
    try {
      if (msg.channel === 'email') {
        await sendEmail({
          to: msg.payload.to,
          subject: msg.payload.subject ?? 'Follow-Up Concierge',
          body: msg.payload.body,
        });
      } else if (msg.channel === 'whatsapp') {
        await sendWhatsApp({
          to: msg.payload.to,
          body: msg.payload.body,
        });
      }

      // ─── Success ────────────────────────────────────────────────
      await prisma.outboxMessage.update({
        where: { outboxId: msg.outbox_id },
        data: { status: 'sent', attempts: msg.attempts + 1 },
      });

      // Mark task as done if linked
      if (msg.task_id) {
        await prisma.task.update({
          where: { taskId: msg.task_id },
          data: { status: 'done' },
        });
        await recordTaskEvent(msg.task_id, msg.user_id, 'sent');
        await recordTaskEvent(msg.task_id, msg.user_id, 'done');
      }

      log.info({ outboxId: msg.outbox_id }, 'Message sent');
    } catch (err) {
      const newAttempts = msg.attempts + 1;

      if (newAttempts >= MAX_ATTEMPTS) {
        // ─── Failed permanently ────────────────────────────────
        await prisma.outboxMessage.update({
          where: { outboxId: msg.outbox_id },
          data: { status: 'failed', attempts: newAttempts },
        });

        if (msg.task_id) {
          await prisma.task.update({
            where: { taskId: msg.task_id },
            data: { status: 'failed' },
          });
          await recordTaskEvent(msg.task_id, msg.user_id, 'failed', {
            reason: (err as Error).message,
          });
        }

        log.error(
          { outboxId: msg.outbox_id, attempts: newAttempts, err: (err as Error).message },
          'Message permanently failed – alerting',
        );
        // TODO: integrate with PagerDuty / Slack alert webhook
      } else {
        // ─── Retry with backoff ─────────────────────────────────
        const nextRetry = computeNextRetry(newAttempts);
        await prisma.outboxMessage.update({
          where: { outboxId: msg.outbox_id },
          data: {
            status: 'queued',
            attempts: newAttempts,
            nextRetryAt: nextRetry,
          },
        });

        log.warn(
          { outboxId: msg.outbox_id, attempts: newAttempts, nextRetry: nextRetry.toISOString() },
          'Message send failed – will retry',
        );
      }
    }
  }
}

// ─── Poll loop via cron (every 5 seconds) ───────────────────────────────────

const cronExpr = '*/5 * * * * *'; // every 5 seconds (6-field cron)
const job = new Cron(cronExpr, { protect: true }, async () => {
  try {
    await pollOutbox();
  } catch (err) {
    log.error({ err }, 'Outbox poll failed');
  }
});

log.info('Outbox sender worker running');

// ─── Graceful shutdown ──────────────────────────────────────────────────────

const shutdown = async () => {
  log.info('Shutting down outbox worker…');
  job.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
