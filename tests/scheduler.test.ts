import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Scheduler tests — verify that the scheduler correctly selects
 * tasks where status='pending' AND due_at <= now(), and marks them 'due'.
 */

describe('Scheduler – due task selection', () => {
  // Simulate an in-memory tasks table
  let taskStore: Array<{
    task_id: string;
    user_id: string;
    status: string;
    due_at: Date | null;
  }>;

  beforeEach(() => {
    taskStore = [];
  });

  /**
   * Pure logic extracted from scheduler.worker.ts tick().
   * In production the atomic update is done via SQL FOR UPDATE SKIP LOCKED.
   * Here we simulate the same semantics.
   */
  function simulateSchedulerTick(now: Date): Array<{ task_id: string; user_id: string }> {
    const dueTasks: Array<{ task_id: string; user_id: string }> = [];

    for (const task of taskStore) {
      if (task.status === 'pending' && task.due_at && task.due_at <= now) {
        task.status = 'due'; // atomic update
        dueTasks.push({ task_id: task.task_id, user_id: task.user_id });
      }
    }

    return dueTasks;
  }

  it('should pick up tasks with due_at in the past', () => {
    const pastDate = new Date('2025-01-01T10:00:00Z');
    const now = new Date('2025-01-01T10:05:00Z');

    taskStore.push({
      task_id: 'task-1',
      user_id: 'user-1',
      status: 'pending',
      due_at: pastDate,
    });

    const due = simulateSchedulerTick(now);
    expect(due).toHaveLength(1);
    expect(due[0].task_id).toBe('task-1');
    expect(taskStore[0].status).toBe('due');
  });

  it('should pick up tasks with due_at exactly equal to now', () => {
    const now = new Date('2025-01-01T10:00:00Z');

    taskStore.push({
      task_id: 'task-1',
      user_id: 'user-1',
      status: 'pending',
      due_at: now,
    });

    const due = simulateSchedulerTick(now);
    expect(due).toHaveLength(1);
  });

  it('should NOT pick up tasks with due_at in the future', () => {
    const now = new Date('2025-01-01T10:00:00Z');
    const future = new Date('2025-01-01T11:00:00Z');

    taskStore.push({
      task_id: 'task-1',
      user_id: 'user-1',
      status: 'pending',
      due_at: future,
    });

    const due = simulateSchedulerTick(now);
    expect(due).toHaveLength(0);
    expect(taskStore[0].status).toBe('pending');
  });

  it('should NOT pick up tasks that are not in pending status', () => {
    const pastDate = new Date('2025-01-01T09:00:00Z');
    const now = new Date('2025-01-01T10:00:00Z');

    taskStore.push(
      { task_id: 'task-done', user_id: 'user-1', status: 'done', due_at: pastDate },
      { task_id: 'task-failed', user_id: 'user-1', status: 'failed', due_at: pastDate },
      { task_id: 'task-due', user_id: 'user-1', status: 'due', due_at: pastDate },
      { task_id: 'task-clarify', user_id: 'user-1', status: 'needs_clarification', due_at: pastDate },
    );

    const due = simulateSchedulerTick(now);
    expect(due).toHaveLength(0);
  });

  it('should NOT pick up tasks with null due_at', () => {
    const now = new Date('2025-01-01T10:00:00Z');

    taskStore.push({
      task_id: 'task-1',
      user_id: 'user-1',
      status: 'pending',
      due_at: null,
    });

    const due = simulateSchedulerTick(now);
    expect(due).toHaveLength(0);
  });

  it('should handle multiple due tasks in one tick', () => {
    const now = new Date('2025-01-01T10:00:00Z');

    taskStore.push(
      { task_id: 'task-1', user_id: 'user-1', status: 'pending', due_at: new Date('2025-01-01T09:00:00Z') },
      { task_id: 'task-2', user_id: 'user-2', status: 'pending', due_at: new Date('2025-01-01T09:30:00Z') },
      { task_id: 'task-3', user_id: 'user-1', status: 'pending', due_at: new Date('2025-01-01T10:00:00Z') },
      { task_id: 'task-4', user_id: 'user-3', status: 'pending', due_at: new Date('2025-01-01T11:00:00Z') }, // future
    );

    const due = simulateSchedulerTick(now);
    expect(due).toHaveLength(3);
    expect(due.map((t) => t.task_id)).toEqual(['task-1', 'task-2', 'task-3']);
  });

  it('should not double-process tasks on second tick', () => {
    const now = new Date('2025-01-01T10:00:00Z');

    taskStore.push({
      task_id: 'task-1',
      user_id: 'user-1',
      status: 'pending',
      due_at: new Date('2025-01-01T09:00:00Z'),
    });

    // First tick
    const due1 = simulateSchedulerTick(now);
    expect(due1).toHaveLength(1);

    // Second tick — task is now 'due', should not be picked again
    const due2 = simulateSchedulerTick(now);
    expect(due2).toHaveLength(0);
  });
});
