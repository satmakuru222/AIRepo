import { Queue, Worker, type Job, type WorkerOptions, type QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('queue');

// Shared Redis connection for queues
export function createRedisConnection() {
  return new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
}

// ─── Queue names ────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  INGEST: 'ingest',
  EXECUTE: 'execute',
} as const;

// ─── Queue factory ──────────────────────────────────────────────────────────

const defaultQueueOpts: Partial<QueueOptions> = {
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
};

export function createQueue(name: string, opts?: Partial<QueueOptions>): Queue {
  const connection = createRedisConnection();
  const queue = new Queue(name, {
    connection,
    ...defaultQueueOpts,
    ...opts,
  });
  log.info({ queue: name }, 'Queue created');
  return queue;
}

// ─── Worker factory ─────────────────────────────────────────────────────────

export function createWorker<T>(
  name: string,
  processor: (job: Job<T>) => Promise<void>,
  opts?: Partial<WorkerOptions>,
): Worker<T> {
  const connection = createRedisConnection();
  const worker = new Worker<T>(name, processor, {
    connection,
    concurrency: 5,
    ...opts,
  });

  worker.on('completed', (job) => {
    log.info({ queue: name, jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ queue: name, jobId: job?.id, err: err.message }, 'Job failed');
  });

  worker.on('error', (err) => {
    log.error({ queue: name, err: err.message }, 'Worker error');
  });

  log.info({ queue: name }, 'Worker started');
  return worker;
}
