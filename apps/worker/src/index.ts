// Worker container — orchestrates scheduled work via BullMQ.
//
// Phase 2: 15-min calendar-sync poll
// Phase 3: 5-min reminder dispatch
// Phase 4.3: daily 08:00 PRIORITIZATION agent run + post-sync agent trigger
//           (when new calendar events ingest, nudge the agent — debounced 1hr)
//
// All heavy lifting happens in the api/agent containers; we just queue work.

import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';
const SECRET = process.env.INTERNAL_API_SECRET;

if (!REDIS_URL) throw new Error('REDIS_URL required');
if (!SECRET) {
  console.warn(
    JSON.stringify({
      service: 'worker',
      ts: new Date().toISOString(),
      msg: 'INTERNAL_API_SECRET not set — worker idle',
    })
  );
}

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const SHEET_TICK_INTERVAL_MS = 30 * 60 * 1000; // every 30 min check sheet schedule
const AGENT_POST_SYNC_DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour
const DAILY_AGENT_CRON = process.env.DAILY_AGENT_CRON ?? '0 8 * * *';
const DAILY_AGENT_TZ = process.env.DAILY_AGENT_TZ ?? 'UTC';
const SINGLE_USER_ID = 'default';

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ service: 'worker', ts: new Date().toISOString(), msg, ...extra }));
}

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const syncQueue = new Queue('calendar-sync', { connection });
const agentQueue = new Queue('agent-run', { connection });

// In-memory debounce — fine for single-instance worker.
const lastAgentEnqueueAt = new Map<string, number>();

function maybeEnqueueAgent(userId: string, trigger: string): void {
  const now = Date.now();
  const last = lastAgentEnqueueAt.get(userId) ?? 0;
  if (now - last < AGENT_POST_SYNC_DEBOUNCE_MS) {
    log('skip agent — debounced', { userId, trigger, ageMs: now - last });
    return;
  }
  lastAgentEnqueueAt.set(userId, now);
  agentQueue
    .add(
      'run',
      { userId, kind: 'PRIORITIZATION', trigger },
      { removeOnComplete: 20, removeOnFail: 20 }
    )
    .then(() => log('agent enqueued', { userId, trigger }))
    .catch((err) => log('agent enqueue failed', { error: err instanceof Error ? err.message : String(err) }));
}

const syncWorker = new Worker(
  'calendar-sync',
  async (job: Job<{ accountId: string }>) => {
    if (!SECRET) throw new Error('INTERNAL_API_SECRET missing');
    const url = `${API_URL}/internal/sync-account/${job.data.accountId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Internal-Secret': SECRET },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`sync HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as {
      result: { ok: boolean; created: number; updated: number; deleted: number; error?: string };
    };
    log('synced', { accountId: job.data.accountId, ...body.result });

    // Phase 4.3: if new events came in, nudge the agent (debounced 1hr).
    if (body.result.ok && body.result.created > 0) {
      maybeEnqueueAgent(SINGLE_USER_ID, 'post-sync:new-events');
    }

    return body.result;
  },
  { connection, concurrency: 2 }
);

syncWorker.on('failed', (job, err) => {
  log('sync job failed', { id: job?.id, accountId: job?.data?.accountId, error: err.message });
});

async function enqueueAll() {
  if (!SECRET) return;
  try {
    const res = await fetch(`${API_URL}/internal/syncable-accounts`, {
      headers: { 'X-Internal-Secret': SECRET },
    });
    if (!res.ok) {
      log('skip enqueue — list failed', { status: res.status });
      return;
    }
    const body = (await res.json()) as { accounts: { id: string }[] };
    for (const acc of body.accounts) {
      await syncQueue.add(
        'sync',
        { accountId: acc.id },
        { jobId: `sync:${acc.id}:${Date.now()}`, removeOnComplete: 50, removeOnFail: 50 }
      );
    }
    log('enqueued', { count: body.accounts.length });
  } catch (err) {
    log('enqueue error', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function tickSheetSync() {
  if (!SECRET) return;
  try {
    const res = await fetch(`${API_URL}/internal/tick-sheet-sync`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': SECRET },
    });
    if (!res.ok) {
      log('sheet tick failed', { status: res.status });
      return;
    }
    const body = (await res.json()) as {
      remindersSent: number;
      syncedOk: number;
      syncedErr: number;
    };
    if (body.remindersSent + body.syncedOk + body.syncedErr > 0) {
      log('sheet tick', body);
    }
  } catch (err) {
    log('sheet tick error', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function tickDataSourceSync() {
  if (!SECRET) return;
  try {
    const res = await fetch(`${API_URL}/internal/tick-data-source-sync`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': SECRET },
    });
    if (!res.ok) {
      log('data source tick failed', { status: res.status });
      return;
    }
    const body = (await res.json()) as {
      syncedOk: number;
      syncedErr: number;
      considered: number;
    };
    if (body.syncedOk + body.syncedErr > 0) {
      log('data source tick', body);
    }
  } catch (err) {
    log('data source tick error', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function dispatchReminders() {
  if (!SECRET) return;
  try {
    const res = await fetch(`${API_URL}/internal/dispatch-due-reminders`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': SECRET },
    });
    if (!res.ok) {
      log('reminder dispatch failed', { status: res.status });
      return;
    }
    const body = (await res.json()) as {
      summary: {
        taskRemindersDispatched: number;
        eventRemindersDispatched: number;
        ratingPromptsDispatched: number;
      };
    };
    const total =
      body.summary.taskRemindersDispatched +
      body.summary.eventRemindersDispatched +
      body.summary.ratingPromptsDispatched;
    if (total > 0) {
      log('reminders dispatched', body.summary);
    }
  } catch (err) {
    log('reminder error', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Register the daily PRIORITIZATION run as a BullMQ repeatable job.
 * BullMQ stores repeatables persistently in Redis keyed by jobId — calling
 * this on every worker start is idempotent. Server-time cron until we have
 * per-user timezone settings.
 */
async function registerDailyAgentJob(): Promise<void> {
  await agentQueue.add(
    'daily-prioritization',
    { userId: SINGLE_USER_ID, kind: 'PRIORITIZATION', trigger: 'scheduled-daily' },
    {
      repeat: { pattern: DAILY_AGENT_CRON, tz: DAILY_AGENT_TZ },
      jobId: `daily-prioritization-${SINGLE_USER_ID}`,
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  log('daily agent cron registered', {
    cron: DAILY_AGENT_CRON,
    tz: DAILY_AGENT_TZ,
    userId: SINGLE_USER_ID,
  });
}

let running = true;
let syncTimer: NodeJS.Timeout | null = null;
let reminderTimer: NodeJS.Timeout | null = null;
let sheetTimer: NodeJS.Timeout | null = null;

async function syncLoop() {
  while (running) {
    await enqueueAll();
    await new Promise<void>((resolve) => {
      syncTimer = setTimeout(resolve, SYNC_INTERVAL_MS);
    });
  }
}

async function reminderLoop() {
  while (running) {
    await dispatchReminders();
    await new Promise<void>((resolve) => {
      reminderTimer = setTimeout(resolve, REMINDER_INTERVAL_MS);
    });
  }
}

async function sheetLoop() {
  while (running) {
    await tickSheetSync();
    // Run the DataSource tick in the same loop — same cadence is fine, and
    // it keeps the worker process count down.
    await tickDataSourceSync();
    await new Promise<void>((resolve) => {
      sheetTimer = setTimeout(resolve, SHEET_TICK_INTERVAL_MS);
    });
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    log(`received ${sig}`);
    running = false;
    if (syncTimer) clearTimeout(syncTimer);
    if (reminderTimer) clearTimeout(reminderTimer);
    if (sheetTimer) clearTimeout(sheetTimer);
    await syncWorker.close();
    await syncQueue.close();
    await agentQueue.close();
    await connection.quit();
    process.exit(0);
  });
}

await registerDailyAgentJob();
log('worker started');
await Promise.all([syncLoop(), reminderLoop(), sheetLoop()]);
