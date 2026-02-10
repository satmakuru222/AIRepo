import Fastify from 'fastify';
import { prisma } from '../shared/prisma.js';
import { createChildLogger } from '../shared/logger.js';
import { config } from '../shared/config.js';
import { createQueue, QUEUE_NAMES } from '../shared/queue.js';
import type { ExecuteJobPayload } from '../shared/types.js';

const log = createChildLogger('admin');

async function main() {
  const app = Fastify({ logger: false });
  const executeQueue = createQueue(QUEUE_NAMES.EXECUTE);

  // ─── Health ───────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok' }));

  // ─── List failed tasks ────────────────────────────────────────────
  app.get('/admin/tasks/failed', async (_req, reply) => {
    const tasks = await prisma.task.findMany({
      where: { status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { events: { orderBy: { createdAt: 'desc' }, take: 3 } },
    });
    return reply.send({ count: tasks.length, tasks });
  });

  // ─── List failed outbox messages ──────────────────────────────────
  app.get('/admin/outbox/failed', async (_req, reply) => {
    const messages = await prisma.outboxMessage.findMany({
      where: { status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return reply.send({ count: messages.length, messages });
  });

  // ─── Retry a failed task ──────────────────────────────────────────
  app.post<{ Params: { taskId: string } }>('/admin/tasks/:taskId/retry', async (req, reply) => {
    const { taskId } = req.params;
    const task = await prisma.task.findUnique({ where: { taskId } });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.status !== 'failed') {
      return reply.status(400).send({ error: 'Task is not in failed state' });
    }

    await prisma.task.update({
      where: { taskId },
      data: { status: 'due', attemptCount: 0 },
    });

    const jobPayload: ExecuteJobPayload = { taskId };
    await executeQueue.add('execute', jobPayload, {
      jobId: `retry:${taskId}:${Date.now()}`,
    });

    log.info({ taskId }, 'Task retried via admin');
    return reply.send({ status: 'retried', taskId });
  });

  // ─── Retry a failed outbox message ────────────────────────────────
  app.post<{ Params: { outboxId: string } }>(
    '/admin/outbox/:outboxId/retry',
    async (req, reply) => {
      const { outboxId } = req.params;
      const msg = await prisma.outboxMessage.findUnique({ where: { outboxId } });
      if (!msg) return reply.status(404).send({ error: 'Outbox message not found' });
      if (msg.status !== 'failed') {
        return reply.status(400).send({ error: 'Outbox message is not in failed state' });
      }

      await prisma.outboxMessage.update({
        where: { outboxId },
        data: { status: 'queued', attempts: 0, nextRetryAt: new Date() },
      });

      log.info({ outboxId }, 'Outbox message retried via admin');
      return reply.send({ status: 'retried', outboxId });
    },
  );

  // ─── View audit events for a task ─────────────────────────────────
  app.get<{ Params: { taskId: string } }>('/admin/tasks/:taskId/events', async (req, reply) => {
    const { taskId } = req.params;
    const events = await prisma.taskEvent.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send({ taskId, events });
  });

  // ─── Data retention: redact old inbound messages ──────────────────
  app.post('/admin/retention/redact', async (_req, reply) => {
    const cutoff = new Date(Date.now() - config.RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const result = await prisma.inboundMessage.updateMany({
      where: {
        receivedAt: { lt: cutoff },
        rawTextRedacted: { not: '[REDACTED_PER_RETENTION_POLICY]' },
      },
      data: { rawTextRedacted: '[REDACTED_PER_RETENTION_POLICY]' },
    });

    log.info({ redacted: result.count, cutoff: cutoff.toISOString() }, 'Retention redaction complete');
    return reply.send({ status: 'done', redacted: result.count });
  });

  // ─── Start ────────────────────────────────────────────────────────
  await app.listen({ port: config.ADMIN_PORT, host: '0.0.0.0' });
  log.info({ port: config.ADMIN_PORT }, 'Admin server started');

  const shutdown = async () => {
    log.info('Shutting down admin server…');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start admin server');
  process.exit(1);
});
