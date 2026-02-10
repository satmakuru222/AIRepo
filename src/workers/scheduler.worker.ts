import { Cron } from 'croner';
import { prisma } from '../shared/prisma.js';
import { createChildLogger } from '../shared/logger.js';
import { createQueue, QUEUE_NAMES } from '../shared/queue.js';
import { recordTaskEvent } from '../services/task-events.js';
import { config } from '../shared/config.js';
import type { ExecuteJobPayload } from '../shared/types.js';

const log = createChildLogger('scheduler');

const executeQueue = createQueue(QUEUE_NAMES.EXECUTE);

async function tick(): Promise<void> {
  const now = new Date();
  log.debug({ now: now.toISOString() }, 'Scheduler tick');

  // Atomically find and claim due tasks.
  // Uses a raw query for SELECT ... FOR UPDATE SKIP LOCKED to avoid
  // double-processing when multiple scheduler replicas run (belt-and-suspenders).
  const dueTasks = await prisma.$queryRaw<Array<{ task_id: string; user_id: string }>>`
    UPDATE tasks
    SET status = 'due', updated_at = NOW()
    WHERE task_id IN (
      SELECT task_id FROM tasks
      WHERE status = 'pending' AND due_at <= ${now}
      ORDER BY due_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    RETURNING task_id, user_id
  `;

  if (dueTasks.length === 0) {
    return;
  }

  log.info({ count: dueTasks.length }, 'Tasks marked as due');

  for (const row of dueTasks) {
    await recordTaskEvent(row.task_id, row.user_id, 'due');

    const jobPayload: ExecuteJobPayload = { taskId: row.task_id };
    await executeQueue.add('execute', jobPayload, {
      jobId: `exec:${row.task_id}`, // idempotent
    });

    log.info({ taskId: row.task_id }, 'Execute job enqueued');
  }
}

// ─── Schedule via cron ──────────────────────────────────────────────────────

const job = new Cron(config.SCHEDULER_CRON, { protect: true }, async () => {
  try {
    await tick();
  } catch (err) {
    log.error({ err }, 'Scheduler tick failed');
  }
});

log.info({ cron: config.SCHEDULER_CRON }, 'Scheduler worker running');

// ─── Graceful shutdown ──────────────────────────────────────────────────────

const shutdown = async () => {
  log.info('Shutting down scheduler…');
  job.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
