import type { Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('task-events');

export type EventType =
  | 'created'
  | 'clarification_sent'
  | 'scheduled'
  | 'due'
  | 'executing'
  | 'draft_generated'
  | 'sending'
  | 'sent'
  | 'done'
  | 'failed'
  | 'retried';

export async function recordTaskEvent(
  taskId: string,
  userId: string,
  eventType: EventType,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.taskEvent.create({
      data: {
        taskId,
        userId,
        eventType,
        payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    log.debug({ taskId, eventType }, 'Task event recorded');
  } catch (err) {
    log.error({ taskId, eventType, err }, 'Failed to record task event');
    // Non-critical: don't throw, just log
  }
}
