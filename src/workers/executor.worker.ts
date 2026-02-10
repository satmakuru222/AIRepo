import type { Job } from 'bullmq';
import { prisma } from '../shared/prisma.js';
import { createChildLogger } from '../shared/logger.js';
import { createWorker, QUEUE_NAMES } from '../shared/queue.js';
import { draftFollowUp } from '../services/claude.js';
import { recordTaskEvent } from '../services/task-events.js';
import type { ExecuteJobPayload, OutboxPayload } from '../shared/types.js';

const log = createChildLogger('executor-worker');

async function processExecute(job: Job<ExecuteJobPayload>): Promise<void> {
  const { taskId } = job.data;
  log.info({ taskId }, 'Processing execute job');

  // 1. Load task + user
  const task = await prisma.task.findUnique({
    where: { taskId },
    include: {
      user: { include: { preferences: true } },
    },
  });

  if (!task) {
    log.error({ taskId }, 'Task not found');
    return;
  }

  if (task.status !== 'due') {
    log.warn({ taskId, status: task.status }, 'Task not in due state – skipping');
    return;
  }

  // 2. Update status to executing
  await prisma.task.update({
    where: { taskId },
    data: { status: 'executing', lastAttemptAt: new Date(), attemptCount: { increment: 1 } },
  });
  await recordTaskEvent(taskId, task.userId, 'executing');

  const prefs = task.user.preferences;
  const tone = prefs?.tone ?? 'friendly';
  const fallbackChannel = (prefs?.fallbackChannel ?? 'email') as 'email' | 'whatsapp';

  // 3. Determine channel – use the inbound channel, fallback to preference
  const inbound = await prisma.inboundMessage.findUnique({
    where: { inboundId: task.sourceInboundId },
  });
  const channel = (inbound?.channel ?? fallbackChannel) as 'email' | 'whatsapp';
  const recipientAddress =
    channel === 'email' ? task.user.primaryEmail! : task.user.whatsappNumber!;

  let body: string;
  let subject: string;

  if (task.actionType === 'remind') {
    // ─── Reminder only ──────────────────────────────────────────
    subject = `Reminder: Follow up with ${task.contactHint || 'your contact'}`;
    body = `Hi ${task.user.displayName}, this is your reminder to follow up${task.contactHint ? ` with ${task.contactHint}` : ''}${task.context ? ` about ${task.context}` : ''}.`;
  } else {
    // ─── Remind + draft (or send) ───────────────────────────────
    const draft = await draftFollowUp(
      task.contactHint || 'the contact',
      task.context || 'a follow-up',
      tone,
    );
    await recordTaskEvent(taskId, task.userId, 'draft_generated', { draft });

    subject = draft.subject;
    body =
      task.actionType === 'send'
        ? draft.body
        : `Hi ${task.user.displayName}, it's time to follow up${task.contactHint ? ` with ${task.contactHint}` : ''}. Here's a draft you can use:\n\n---\nSubject: ${draft.subject}\n\n${draft.body}\n---\n\nFeel free to edit and send!`;
  }

  // 4. Create outbox entry
  const payload: OutboxPayload = { to: recipientAddress, subject, body };

  await prisma.outboxMessage.create({
    data: {
      taskId,
      userId: task.userId,
      channel,
      payload,
      status: 'queued',
    },
  });

  // 5. Update task status to sending
  await prisma.task.update({
    where: { taskId },
    data: { status: 'sending' },
  });
  await recordTaskEvent(taskId, task.userId, 'sending');

  log.info({ taskId }, 'Execute job completed – outbox entry created');
}

// ─── Start worker ───────────────────────────────────────────────────────────

const worker = createWorker<ExecuteJobPayload>(QUEUE_NAMES.EXECUTE, processExecute);

log.info('Executor worker running');

const shutdown = async () => {
  log.info('Shutting down executor worker…');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
