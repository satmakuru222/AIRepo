import type { Job } from 'bullmq';
import { prisma } from '../shared/prisma.js';
import { createChildLogger } from '../shared/logger.js';
import { createWorker, QUEUE_NAMES } from '../shared/queue.js';
import { extractFollowUp } from '../services/claude.js';
import { recordTaskEvent } from '../services/task-events.js';
import { redactPii } from '../shared/pii.js';
import type { IngestJobPayload, OutboxPayload } from '../shared/types.js';

const log = createChildLogger('ingest-worker');

async function processIngest(job: Job<IngestJobPayload>): Promise<void> {
  const { inboundId, userId } = job.data;
  log.info({ inboundId, userId }, 'Processing ingest job');

  // 1. Load inbound message
  const inbound = await prisma.inboundMessage.findUnique({
    where: { inboundId },
  });
  if (!inbound) {
    log.error({ inboundId }, 'Inbound message not found');
    return;
  }

  // 2. Load user preferences
  const user = await prisma.user.findUnique({
    where: { userId },
    include: { preferences: true },
  });
  if (!user) {
    log.error({ userId }, 'User not found');
    return;
  }

  const prefs = user.preferences;
  const timezone = prefs?.timezone ?? 'America/New_York';
  const defaultAction = prefs?.defaultAction ?? 'remind_and_draft';

  // 3. Redact PII before sending to Claude
  const safeText = redactPii(inbound.rawTextRedacted ?? '');

  // 4. Call Claude for extraction
  const now = new Date().toISOString();
  const extraction = await extractFollowUp(safeText, timezone, now);

  // 5. Determine response channel
  const channel = inbound.channel as 'email' | 'whatsapp';
  const recipientAddress =
    channel === 'email' ? user.primaryEmail! : user.whatsappNumber!;

  if (extraction.needs_clarification) {
    // ─── Needs clarification ──────────────────────────────────────
    const task = await prisma.task.create({
      data: {
        userId,
        sourceInboundId: inboundId,
        actionType: extraction.action_type || defaultAction,
        contactHint: extraction.contact_hint || null,
        context: extraction.context || null,
        status: 'needs_clarification',
      },
    });

    await recordTaskEvent(task.taskId, userId, 'created', { source: 'ingest' });
    await recordTaskEvent(task.taskId, userId, 'clarification_sent', {
      question: extraction.clarifying_question,
    });

    // Create outbox for clarifying question
    const payload: OutboxPayload = {
      to: recipientAddress,
      subject: 'Quick question about your follow-up',
      body: extraction.clarifying_question,
    };

    await prisma.outboxMessage.create({
      data: {
        taskId: task.taskId,
        userId,
        channel,
        payload,
        status: 'queued',
      },
    });

    log.info({ taskId: task.taskId }, 'Clarification needed – outbox message created');
  } else {
    // ─── Task is clear, schedule it ───────────────────────────────
    const dueAt = extraction.due_at_iso ? new Date(extraction.due_at_iso) : null;

    const task = await prisma.task.create({
      data: {
        userId,
        sourceInboundId: inboundId,
        dueAt,
        actionType: extraction.action_type || defaultAction,
        contactHint: extraction.contact_hint || null,
        context: extraction.context || null,
        status: 'pending',
      },
    });

    await recordTaskEvent(task.taskId, userId, 'created', { source: 'ingest' });
    await recordTaskEvent(task.taskId, userId, 'scheduled', {
      dueAt: dueAt?.toISOString(),
    });

    // Create outbox confirmation
    const friendlyDate = dueAt
      ? dueAt.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: timezone,
        })
      : 'the scheduled time';

    const actionLabel =
      extraction.action_type === 'remind'
        ? "I'll remind you"
        : extraction.action_type === 'send'
          ? "I'll send it for you"
          : "I'll remind you and prepare a draft";

    const confirmBody = `Got it! ${actionLabel} on ${friendlyDate} about ${extraction.contact_hint || 'your follow-up'}.`;

    const payload: OutboxPayload = {
      to: recipientAddress,
      subject: 'Follow-up scheduled',
      body: confirmBody,
    };

    await prisma.outboxMessage.create({
      data: {
        taskId: task.taskId,
        userId,
        channel,
        payload,
        status: 'queued',
      },
    });

    log.info({ taskId: task.taskId, dueAt }, 'Task created and confirmation queued');
  }

  // 6. Mark inbound as processed
  await prisma.inboundMessage.update({
    where: { inboundId },
    data: { status: 'processed' },
  });
}

// ─── Start worker ───────────────────────────────────────────────────────────

const worker = createWorker<IngestJobPayload>(QUEUE_NAMES.INGEST, processIngest);

log.info('Ingest worker running');

// Graceful shutdown
const shutdown = async () => {
  log.info('Shutting down ingest worker…');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
