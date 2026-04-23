import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskLog } from '../task-log.js';
import { EventLog } from '../event-log.js';

describe('TaskLog', () => {
  let log: TaskLog;
  let events: EventLog;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'task-log-test-'));
    events = new EventLog(join(tmpDir, 'events.db'));
    log = new TaskLog(join(tmpDir, 'tasks.db'), events);
  });

  afterEach(() => {
    log.close();
    events.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a task with defaults and emits task.created', () => {
    const t = log.create({ subject: 'test task' });
    expect(t.subject).toBe('test task');
    expect(t.status).toBe('pending');
    expect(t.id).toBeDefined();
    const evs = events.query({ event: 'task.created' });
    expect(evs).toHaveLength(1);
    expect(evs[0]?.payload?.['task_id']).toBe(t.id);
  });

  it('gets a task by id', () => {
    const t = log.create({ subject: 'hello', stream: 's1' });
    const got = log.get(t.id);
    expect(got?.id).toBe(t.id);
    expect(got?.stream).toBe('s1');
    expect(log.get('nope')).toBeNull();
  });

  it('updates a task and emits status_changed', () => {
    const t = log.create({ subject: 'x' });
    const updated = log.update(t.id, { status: 'in_progress' });
    expect(updated.status).toBe('in_progress');
    const evs = events.query({ event: 'task.status_changed' });
    expect(evs).toHaveLength(1);
    expect(evs[0]?.payload?.['from']).toBe('pending');
    expect(evs[0]?.payload?.['to']).toBe('in_progress');
  });

  it('emits task.completed when status becomes completed', () => {
    const t = log.create({ subject: 'y' });
    log.update(t.id, { status: 'completed' });
    const evs = events.query({ event: 'task.completed' });
    expect(evs).toHaveLength(1);
  });

  it('lists tasks excluding deleted by default', () => {
    log.create({ subject: 'a' });
    const b = log.create({ subject: 'b' });
    log.update(b.id, { status: 'deleted' });
    const all = log.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.subject).toBe('a');
  });

  it('lists tasks filtered by status array', () => {
    const a = log.create({ subject: 'a' });
    log.create({ subject: 'b' });
    log.update(a.id, { status: 'completed' });
    const done = log.list({ status: ['completed'] });
    expect(done).toHaveLength(1);
    expect(done[0]?.subject).toBe('a');
  });

  it('filters by stream', () => {
    log.create({ subject: 'a', stream: 's1' });
    log.create({ subject: 'b', stream: 's2' });
    const s1 = log.list({ stream: 's1' });
    expect(s1).toHaveLength(1);
    expect(s1[0]?.subject).toBe('a');
  });

  it('counts tasks matching query', () => {
    log.create({ subject: 'a', stream: 's1' });
    log.create({ subject: 'b', stream: 's1' });
    log.create({ subject: 'c', stream: 's2' });
    expect(log.count({ stream: 's1' })).toBe(2);
    expect(log.count()).toBe(3);
  });

  it('update throws on missing task', () => {
    expect(() => log.update('nope', { status: 'completed' })).toThrow();
  });

  it('accepts user-provided id for idempotent creation', () => {
    const t = log.create({ id: 'my-id', subject: 'x' });
    expect(t.id).toBe('my-id');
    const got = log.get('my-id');
    expect(got?.subject).toBe('x');
  });

  it('preserves metadata round-trip', () => {
    const t = log.create({ subject: 'x', metadata: { foo: 1, bar: ['a', 'b'] } });
    const got = log.get(t.id);
    expect(got?.metadata).toEqual({ foo: 1, bar: ['a', 'b'] });
  });
});
