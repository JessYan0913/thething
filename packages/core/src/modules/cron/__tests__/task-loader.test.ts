import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { intervalMinutesToCron, TaskFrontmatterSchema } from '../task-loader';
import { InMemoryCronJobStore } from '../in-memory-store';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ============================================================
// intervalMinutesToCron
// ============================================================

describe('intervalMinutesToCron', () => {
  it('converts sub-hour intervals divisible by 60', () => {
    expect(intervalMinutesToCron(5)).toBe('*/5 * * * *');
    expect(intervalMinutesToCron(15)).toBe('*/15 * * * *');
    expect(intervalMinutesToCron(30)).toBe('*/30 * * * *');
  });

  it('converts exactly 1 hour', () => {
    expect(intervalMinutesToCron(60)).toBe('0 * * * *');
  });

  it('converts multi-hour intervals divisible by 24', () => {
    expect(intervalMinutesToCron(120)).toBe('0 */2 * * *');
    expect(intervalMinutesToCron(480)).toBe('0 */8 * * *');
    expect(intervalMinutesToCron(720)).toBe('0 */12 * * *');
  });

  it('converts exactly 24 hours', () => {
    expect(intervalMinutesToCron(1440)).toBe('0 0 * * *');
  });

  it('throws for non-convertible intervals', () => {
    expect(() => intervalMinutesToCron(90)).toThrow('Cannot convert');
    expect(() => intervalMinutesToCron(150)).toThrow('Cannot convert');
    expect(() => intervalMinutesToCron(0)).toThrow('Invalid');
    expect(() => intervalMinutesToCron(-1)).toThrow('Invalid');
  });
});

// ============================================================
// TaskFrontmatterSchema
// ============================================================

describe('TaskFrontmatterSchema', () => {
  it('parses minimal valid frontmatter', () => {
    const result = TaskFrontmatterSchema.parse({
      kind: 'task',
      id: 'my-task',
      name: 'My Task',
    });
    expect(result.id).toBe('my-task');
    expect(result.name).toBe('My Task');
    expect(result.enabled).toBe(true); // default
    expect(result.runOnStartup).toBe(false); // default
  });

  it('parses with intervalMinutes', () => {
    const result = TaskFrontmatterSchema.parse({
      id: 'interval-task',
      name: 'Interval Task',
      intervalMinutes: 60,
    });
    expect(result.intervalMinutes).toBe(60);
  });

  it('parses with schedule (cron)', () => {
    const result = TaskFrontmatterSchema.parse({
      id: 'cron-task',
      name: 'Cron Task',
      schedule: '0 9 * * *',
    });
    expect(result.schedule).toBe('0 9 * * *');
  });

  it('parses with enabled false', () => {
    const result = TaskFrontmatterSchema.parse({
      id: 'disabled-task',
      name: 'Disabled Task',
      enabled: false,
    });
    expect(result.enabled).toBe(false);
  });

  it('parses with profileId', () => {
    const result = TaskFrontmatterSchema.parse({
      id: 'hourly-task',
      name: 'Hourly Task',
      profileId: 'dev-agent',
    });
    expect(result.profileId).toBe('dev-agent');
  });

  it('rejects missing id', () => {
    expect(() => TaskFrontmatterSchema.parse({ name: 'No ID' })).toThrow();
  });

  it('rejects missing name', () => {
    expect(() => TaskFrontmatterSchema.parse({ id: 'no-name' })).toThrow();
  });

  it('accepts optional kind field', () => {
    const withKind = TaskFrontmatterSchema.parse({
      id: 'a', name: 'A', kind: 'task',
    });
    expect(withKind.kind).toBe('task');

    const withoutKind = TaskFrontmatterSchema.parse({
      id: 'b', name: 'B',
    });
    expect(withoutKind.kind).toBeUndefined();
  });
});

// ============================================================
// InMemoryCronJobStore
// ============================================================

describe('InMemoryCronJobStore', () => {
  let store: InMemoryCronJobStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-test-'));
    store = new InMemoryCronJobStore({ historyDir: path.join(tmpDir, 'history') });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and retrieves a job', () => {
    const job = store.create({
      name: 'Test',
      schedule: '0 * * * *',
      prompt: 'Do something',
    });
    expect(job.id).toBeDefined();
    expect(job.name).toBe('Test');

    const retrieved = store.getById(job.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Test');
  });

  it('uses provided id when given', () => {
    const job = store.create({
      id: 'my-id',
      name: 'Fixed ID',
      schedule: '*/5 * * * *',
      prompt: 'Fixed ID task',
    });
    expect(job.id).toBe('my-id');
    expect(store.getById('my-id')).not.toBeNull();
  });

  it('lists due jobs', () => {
    store.create({
      id: 'past', name: 'Past', schedule: '* * * * *',
      prompt: '', nextRunAt: Date.now() - 1000, enabled: true,
    });
    store.create({
      id: 'future', name: 'Future', schedule: '* * * * *',
      prompt: '', nextRunAt: Date.now() + 99999, enabled: true,
    });
    store.create({
      id: 'disabled', name: 'Disabled', schedule: '* * * * *',
      prompt: '', nextRunAt: Date.now() - 1000, enabled: false,
    });

    const due = store.listDue(Date.now());
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('past');
  });

  it('marks run and updates nextRunAt', () => {
    const job = store.create({
      id: 'mark-test', name: 'Mark', schedule: '*/5 * * * *',
      prompt: '', enabled: true,
    });

    const now = Date.now();
    const next = now + 300000;
    store.markRun('mark-test', now, next);

    const updated = store.getById('mark-test')!;
    expect(updated.lastRunAt).toBe(now);
    expect(updated.nextRunAt).toBe(next);
  });

  it('deletes by metadata', () => {
    store.create({ id: 'a', name: 'A', schedule: '0 * * * *', prompt: '', metadata: { source: 'file' } });
    store.create({ id: 'b', name: 'B', schedule: '0 * * * *', prompt: '', metadata: { source: 'sqlite' } });
    store.create({ id: 'c', name: 'C', schedule: '0 * * * *', prompt: '', metadata: { source: 'file' } });

    expect(store.listAll()).toHaveLength(3);
    const removed = store.deleteByMetadata('source', 'file');
    expect(removed).toBe(2);
    expect(store.listAll()).toHaveLength(1);
    expect(store.getById('b')).not.toBeNull();
  });

  it('writes and reads execution history', () => {
    store.create({ id: 'hist-test', name: 'History', schedule: '* * * * *', prompt: '' });

    const exec1 = store.logExecution({
      jobId: 'hist-test', status: 'completed',
      triggeredAt: 1000, completedAt: 2000, duration: 1000,
      conversationId: 'conv-1', error: null, eventId: 'evt-1',
    });
    const exec2 = store.logExecution({
      jobId: 'hist-test', status: 'failed',
      triggeredAt: 3000, completedAt: 3500, duration: 500,
      conversationId: 'conv-2', error: 'timeout', eventId: 'evt-2',
    });

    const history = store.getExecutions('hist-test');
    expect(history).toHaveLength(2);
    expect(history[0].status).toBe('failed'); // newest first
    expect(history[0].error).toBe('timeout');
    expect(history[1].status).toBe('completed');
  });

  it('returns empty history for unknown job', () => {
    expect(store.getExecutions('nonexistent')).toEqual([]);
  });

  it('updates a job', () => {
    store.create({ id: 'upd', name: 'Original', schedule: '0 * * * *', prompt: 'original prompt' });
    store.update('upd', { name: 'Updated', prompt: 'new prompt' });

    const job = store.getById('upd')!;
    expect(job.name).toBe('Updated');
    expect(job.prompt).toBe('new prompt');
  });

  it('deletes a job', () => {
    store.create({ id: 'del', name: 'Delete Me', schedule: '0 * * * *', prompt: '' });
    expect(store.getById('del')).not.toBeNull();
    expect(store.delete('del')).toBe(true);
    expect(store.getById('del')).toBeNull();
    expect(store.delete('nonexistent')).toBe(false);
  });

  it('recalculates nextRunAt on schedule update', () => {
    store.create({ id: 'sched', name: 'Schedule', schedule: '0 0 * * *', prompt: '' });
    const before = store.getById('sched')!;
    const oldNextRun = before.nextRunAt;

    store.update('sched', { schedule: '*/5 * * * *' });
    const after = store.getById('sched')!;
    // */5 should give a different nextRun than 0 0
    expect(after.nextRunAt).not.toBe(oldNextRun);
  });
});
