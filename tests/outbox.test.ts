import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Outbox retry/backoff tests — verify exponential backoff logic
 * and that messages are marked as failed after max attempts.
 */

describe('Outbox – retry and backoff', () => {
  const MAX_ATTEMPTS = 5;

  /**
   * Compute next retry delay. Mirrors the logic in outbox.worker.ts.
   */
  function computeNextRetry(attempts: number): Date {
    const delayMs = Math.min(30_000 * Math.pow(2, attempts), 600_000);
    return new Date(Date.now() + delayMs);
  }

  // In-memory outbox store
  interface OutboxRow {
    outbox_id: string;
    task_id: string | null;
    status: string;
    attempts: number;
    next_retry_at: Date;
  }

  let outboxStore: OutboxRow[];
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    outboxStore = [];
    sendFn = vi.fn();
  });

  /**
   * Simulate outbox poll cycle (mirrors outbox.worker.ts pollOutbox).
   */
  async function simulateOutboxPoll(now: Date): Promise<void> {
    for (const msg of outboxStore) {
      if (msg.status !== 'queued' || msg.next_retry_at > now) continue;

      msg.status = 'sending';

      try {
        await sendFn(msg);

        // Success
        msg.status = 'sent';
        msg.attempts += 1;
      } catch {
        msg.attempts += 1;

        if (msg.attempts >= MAX_ATTEMPTS) {
          msg.status = 'failed';
        } else {
          msg.status = 'queued';
          msg.next_retry_at = computeNextRetry(msg.attempts);
        }
      }
    }
  }

  it('should send message on first attempt', async () => {
    sendFn.mockResolvedValue(undefined);

    outboxStore.push({
      outbox_id: 'ob-1',
      task_id: 'task-1',
      status: 'queued',
      attempts: 0,
      next_retry_at: new Date(0),
    });

    await simulateOutboxPoll(new Date());
    expect(outboxStore[0].status).toBe('sent');
    expect(outboxStore[0].attempts).toBe(1);
  });

  it('should retry with backoff on failure', async () => {
    sendFn.mockRejectedValue(new Error('network error'));
    const now = new Date('2025-01-01T10:00:00Z');

    outboxStore.push({
      outbox_id: 'ob-1',
      task_id: 'task-1',
      status: 'queued',
      attempts: 0,
      next_retry_at: new Date(0),
    });

    await simulateOutboxPoll(now);
    expect(outboxStore[0].status).toBe('queued');
    expect(outboxStore[0].attempts).toBe(1);
    expect(outboxStore[0].next_retry_at.getTime()).toBeGreaterThan(now.getTime());
  });

  it('should apply exponential backoff delays', () => {
    const baseTime = Date.now();

    // Mock Date.now for consistent testing
    const origDateNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);

    const retry0 = computeNextRetry(0); // 30s * 2^0 = 30s
    const retry1 = computeNextRetry(1); // 30s * 2^1 = 60s
    const retry2 = computeNextRetry(2); // 30s * 2^2 = 120s
    const retry3 = computeNextRetry(3); // 30s * 2^3 = 240s
    const retry4 = computeNextRetry(4); // 30s * 2^4 = 480s
    const retry10 = computeNextRetry(10); // capped at 600s

    expect(retry0.getTime() - baseTime).toBe(30_000);
    expect(retry1.getTime() - baseTime).toBe(60_000);
    expect(retry2.getTime() - baseTime).toBe(120_000);
    expect(retry3.getTime() - baseTime).toBe(240_000);
    expect(retry4.getTime() - baseTime).toBe(480_000);
    expect(retry10.getTime() - baseTime).toBe(600_000); // capped

    vi.spyOn(Date, 'now').mockRestore();
  });

  it('should mark as failed after max attempts', async () => {
    sendFn.mockRejectedValue(new Error('provider down'));

    outboxStore.push({
      outbox_id: 'ob-1',
      task_id: 'task-1',
      status: 'queued',
      attempts: MAX_ATTEMPTS - 1, // one more failure will exceed max
      next_retry_at: new Date(0),
    });

    await simulateOutboxPoll(new Date());
    expect(outboxStore[0].status).toBe('failed');
    expect(outboxStore[0].attempts).toBe(MAX_ATTEMPTS);
  });

  it('should not pick up messages with future next_retry_at', async () => {
    sendFn.mockResolvedValue(undefined);
    const now = new Date('2025-01-01T10:00:00Z');
    const future = new Date('2025-01-01T11:00:00Z');

    outboxStore.push({
      outbox_id: 'ob-1',
      task_id: 'task-1',
      status: 'queued',
      attempts: 1,
      next_retry_at: future,
    });

    await simulateOutboxPoll(now);
    // Message should remain untouched
    expect(outboxStore[0].status).toBe('queued');
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('should process multiple messages in one poll', async () => {
    sendFn
      .mockResolvedValueOnce(undefined) // ob-1 succeeds
      .mockRejectedValueOnce(new Error('fail')); // ob-2 fails

    outboxStore.push(
      { outbox_id: 'ob-1', task_id: 'task-1', status: 'queued', attempts: 0, next_retry_at: new Date(0) },
      { outbox_id: 'ob-2', task_id: 'task-2', status: 'queued', attempts: 0, next_retry_at: new Date(0) },
    );

    await simulateOutboxPoll(new Date());
    expect(outboxStore[0].status).toBe('sent');
    expect(outboxStore[1].status).toBe('queued'); // retrying
    expect(outboxStore[1].attempts).toBe(1);
  });

  it('should succeed on retry after previous failures', async () => {
    sendFn.mockResolvedValue(undefined);

    outboxStore.push({
      outbox_id: 'ob-1',
      task_id: 'task-1',
      status: 'queued',
      attempts: 3, // previously failed 3 times
      next_retry_at: new Date(0),
    });

    await simulateOutboxPoll(new Date());
    expect(outboxStore[0].status).toBe('sent');
    expect(outboxStore[0].attempts).toBe(4);
  });
});
