/**
 * Standard §8.7 — task-augmented execution storage.
 *
 * The MCP SDK ships the task schemas (`TaskSchema`, `CreateTaskResultSchema`, …) but no storage or
 * lifecycle. This module supplies both: an {@link ITaskStore} abstraction and a process-memory
 * {@link InMemoryTaskStore} default. A task represents one long-running `tools/call` that returned
 * immediately with a `taskId`; the client then polls `tasks/get`, fetches `tasks/result` and may
 * `tasks/cancel`.
 *
 * The in-memory store is sufficient for a single server instance. It does NOT survive a process
 * restart — unfinished tasks are lost on restart, which is an accepted limitation of the default
 * implementation. A consumer needing durability or horizontal scale can implement {@link ITaskStore}
 * over Redis / PostgreSQL and swap it in.
 */
import { randomUUID } from 'node:crypto';

import type { Task } from '@modelcontextprotocol/sdk/types.js';

import { appConfig } from '../bootstrap/init-config.js';

export type TTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

const TERMINAL_STATUSES: ReadonlySet<TTaskStatus> = new Set(['completed', 'failed', 'cancelled']);

/** True when a task reached a final state and will not transition further on its own. */
export function isTerminalTaskStatus(status: TTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface ITaskRecord {
  /** Crypto-random task identifier returned to the client. */
  taskId: string;
  /** Originating MCP method — always 'tools/call' in this package. */
  method: string;
  /** Tool name the task executes (for tasks/list display and metrics). */
  toolName: string;
  status: TTaskStatus;
  /** Epoch ms of creation; used for ttl expiry and eviction order. */
  createdAt: number;
  /** Epoch ms of the last status transition. */
  lastUpdatedAt: number;
  /** Clamped retention duration in ms, surfaced to the client as `Task.ttl`. */
  ttlMs: number;
  /** Epoch ms after which a finished task may be evicted (`createdAt + ttlMs`). */
  expiresAt: number;
  /** Optional diagnostic message for `failed` tasks (already sanitized per §13.3). */
  statusMessage?: string;
  /** Correlation id (§15.1), copied from the creating request context. */
  requestId?: string;
  /** Stable opaque principal key for task ownership and per-subject concurrency accounting. */
  subjectKey: string;
  /** Final tool result once status is `completed` (the same shape tools/call returns). */
  result?: unknown;
  /** AbortController whose signal is passed to the tool handler; aborted on tasks/cancel. */
  abort: AbortController;
}

export interface ITaskCreateInput {
  method: string;
  toolName: string;
  subjectKey: string;
  requestId?: string;
  /** Client-requested retention in ms; clamped to `[minTtlMs, maxTtlMs]`. Falls back to default. */
  ttlMs?: number;
}

export type TTaskPatch = Partial<Pick<ITaskRecord, 'status' | 'statusMessage' | 'result'>>;

export interface ITaskStore {
  create(input: ITaskCreateInput): ITaskRecord;
  get(taskId: string): ITaskRecord | undefined;
  /** Lists retained tasks, optionally filtered by subject; insertion order (caller may re-sort). */
  list(subjectKey?: string): ITaskRecord[];
  /** Transitions status and stores result / message. Returns the updated record (or undefined). */
  update(taskId: string, patch: TTaskPatch): ITaskRecord | undefined;
  /** Requests cancellation: aborts the controller and sets `cancelled` if not already terminal. */
  cancel(taskId: string): ITaskRecord | undefined;
  /** Removes expired finished tasks; called on a timer and on create(). */
  sweep(now: number): void;
  /** Recommended client poll interval in ms (mirrored into every task object). */
  readonly pollIntervalMs: number;
}

export interface ITaskStoreOptions {
  defaultTtlMs: number;
  minTtlMs: number;
  maxTtlMs: number;
  maxTasks: number;
  pollIntervalMs: number;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** When > 0, runs a periodic unref'd sweep. Off (0) for direct construction in tests. */
  autoSweepMs?: number;
}

/**
 * Render an internal task record as the wire-format MCP {@link Task} object (ISO timestamps,
 * `ttl` as the retention duration). Used by every task method and the status notification.
 */
export function toTaskDto(record: ITaskRecord, pollIntervalMs: number): Task {
  return {
    taskId: record.taskId,
    status: record.status,
    ttl: record.ttlMs,
    createdAt: new Date(record.createdAt).toISOString(),
    lastUpdatedAt: new Date(record.lastUpdatedAt).toISOString(),
    pollInterval: pollIntervalMs,
    ...(record.statusMessage ? { statusMessage: record.statusMessage } : {}),
  } as Task;
}

export class InMemoryTaskStore implements ITaskStore {
  private readonly tasks = new Map<string, ITaskRecord>();
  private readonly opts: ITaskStoreOptions;
  private readonly now: () => number;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(opts: ITaskStoreOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    if (opts.autoSweepMs && opts.autoSweepMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(this.now()), opts.autoSweepMs);
      if (typeof this.sweepTimer.unref === 'function') {
        this.sweepTimer.unref();
      }
    }
  }

  get pollIntervalMs(): number {
    return this.opts.pollIntervalMs;
  }

  private clampTtl(requested?: number): number {
    const base = typeof requested === 'number' && Number.isFinite(requested) ? requested : this.opts.defaultTtlMs;
    return Math.min(this.opts.maxTtlMs, Math.max(this.opts.minTtlMs, base));
  }

  create(input: ITaskCreateInput): ITaskRecord {
    const now = this.now();
    this.sweep(now);
    this.evictIfNeeded();
    const ttlMs = this.clampTtl(input.ttlMs);
    const record: ITaskRecord = {
      taskId: randomUUID(),
      method: input.method,
      toolName: input.toolName,
      status: 'working',
      createdAt: now,
      lastUpdatedAt: now,
      ttlMs,
      expiresAt: now + ttlMs,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      subjectKey: input.subjectKey,
      abort: new AbortController(),
    };
    this.tasks.set(record.taskId, record);
    return record;
  }

  get(taskId: string): ITaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  list(subjectKey?: string): ITaskRecord[] {
    const all = [...this.tasks.values()];
    return subjectKey === undefined ? all : all.filter((r) => r.subjectKey === subjectKey);
  }

  update(taskId: string, patch: TTaskPatch): ITaskRecord | undefined {
    const record = this.tasks.get(taskId);
    if (!record) {
      return undefined;
    }
    if (patch.status !== undefined) {
      record.status = patch.status;
    }
    if (patch.statusMessage !== undefined) {
      record.statusMessage = patch.statusMessage;
    }
    if ('result' in patch) {
      record.result = patch.result;
    }
    record.lastUpdatedAt = this.now();
    return record;
  }

  cancel(taskId: string): ITaskRecord | undefined {
    const record = this.tasks.get(taskId);
    if (!record) {
      return undefined;
    }
    // Idempotent: cancelling a finished task returns its current state unchanged.
    if (isTerminalTaskStatus(record.status)) {
      return record;
    }
    record.abort.abort();
    record.status = 'cancelled';
    record.lastUpdatedAt = this.now();
    return record;
  }

  sweep(now: number): void {
    for (const [id, record] of this.tasks) {
      if (isTerminalTaskStatus(record.status) && now > record.expiresAt) {
        this.tasks.delete(id);
      }
    }
  }

  /** Evict the oldest finished tasks when the retention cap is reached. Active tasks are kept. */
  private evictIfNeeded(): void {
    if (this.tasks.size < this.opts.maxTasks) {
      return;
    }
    const finished = [...this.tasks.values()]
      .filter((r) => isTerminalTaskStatus(r.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    let toEvict = this.tasks.size - this.opts.maxTasks + 1;
    for (const record of finished) {
      if (toEvict <= 0) {
        break;
      }
      this.tasks.delete(record.taskId);
      toEvict -= 1;
    }
  }

  /** Stops the periodic sweeper (tests / shutdown). */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.tasks.clear();
  }
}

let singleton: InMemoryTaskStore | undefined;

/**
 * Process-wide task store, lazily built from `appConfig.mcp.tasks`. A singleton because tasks
 * outlive individual HTTP sessions and must be pollable from subsequent requests.
 */
export function getTaskStore(): InMemoryTaskStore {
  if (!singleton) {
    const cfg = appConfig.mcp.tasks ?? {};
    singleton = new InMemoryTaskStore({
      defaultTtlMs: cfg.defaultTtlMs ?? 3_600_000,
      minTtlMs: cfg.minTtlMs ?? 0,
      maxTtlMs: cfg.maxTtlMs ?? 86_400_000,
      maxTasks: cfg.maxTasks ?? 1000,
      pollIntervalMs: cfg.pollIntervalMs ?? 1000,
      autoSweepMs: 60_000,
    });
  }
  return singleton;
}

/** Reset the singleton (tests only). */
export function resetTaskStore(): void {
  singleton?.dispose();
  singleton = undefined;
}
