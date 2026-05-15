// Find tasks/events whose reminder time has arrived and dispatch notifications.
// Idempotent via Notification.sourceType + sourceId.

import { prisma } from '../prisma.js';
import { dispatchNotification } from './notifications.js';
import { env } from '../env.js';

const TASK_REMINDER_LOOKAHEAD_MIN = 60; // dispatch up to 60 min ahead of due time
const EVENT_REMINDER_LOOKAHEAD_MIN = 30; // 30 min ahead of event start

export interface DispatchSummary {
  taskRemindersDispatched: number;
  eventRemindersDispatched: number;
  ratingPromptsDispatched: number;
}

export async function dispatchDueReminders(): Promise<DispatchSummary> {
  const now = new Date();
  const taskHorizon = new Date(now.getTime() + TASK_REMINDER_LOOKAHEAD_MIN * 60_000);
  const eventHorizon = new Date(now.getTime() + EVENT_REMINDER_LOOKAHEAD_MIN * 60_000);

  let taskCount = 0;
  let eventCount = 0;

  // Tasks: due within the lookahead window, not completed, with a dueDate set
  const tasks = await prisma.task.findMany({
    where: {
      completed: false,
      dueDate: { gte: now, lte: taskHorizon },
    },
    include: {
      user: { include: { settings: true } },
      category: { select: { name: true } },
    },
  });

  for (const t of tasks) {
    const settings = t.user.settings;
    const reminderMin = settings?.reminderMinutesBefore ?? 30;
    const fireAt = new Date(t.dueDate!.getTime() - reminderMin * 60_000);
    // Fire only if we're within the reminder window (now >= fireAt)
    if (now < fireAt) continue;

    const dueStr = t.dueDate!.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
    const result = await dispatchNotification({
      userId: t.userId,
      kind: 'TASK_REMINDER',
      title: t.title,
      body: t.category
        ? `Due ${dueStr} · ${t.category.name}`
        : `Due ${dueStr}`,
      url: '/today',
      sourceType: 'task',
      sourceId: t.id,
    });
    // Idempotency check returns existing row(s) without dispatching; count only fresh.
    if (result.some((r) => r.status === 'SENT' || r.status === 'SUPPRESSED')) {
      // Was either freshly sent or freshly suppressed — count either way as "handled"
      // We want to count only the FIRST dispatch, which is what idempotency guarantees.
      taskCount += 1;
    }
  }

  // Calendar events: starting within the lookahead window
  const events = await prisma.calendarEvent.findMany({
    where: {
      status: { not: 'CANCELLED' },
      startsAt: { gte: now, lte: eventHorizon },
    },
    include: {
      user: { include: { settings: true } },
      externalAccount: { select: { label: true, accountEmail: true } },
    },
  });

  for (const ev of events) {
    const settings = ev.user.settings;
    const reminderMin = settings?.reminderMinutesBefore ?? 30;
    const fireAt = new Date(ev.startsAt.getTime() - reminderMin * 60_000);
    if (now < fireAt) continue;

    const startStr = ev.startsAt.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
    const sourceLabel =
      ev.externalAccount.label ?? ev.externalAccount.accountEmail ?? 'Calendar';

    const result = await dispatchNotification({
      userId: ev.userId,
      kind: 'EVENT_REMINDER',
      title: ev.title,
      body: ev.location ? `${startStr} · ${ev.location} · ${sourceLabel}` : `${startStr} · ${sourceLabel}`,
      url: '/today',
      sourceType: 'event',
      sourceId: ev.id,
    });
    if (result.some((r) => r.status === 'SENT' || r.status === 'SUPPRESSED')) {
      eventCount += 1;
    }
  }

  // Evening rating prompt — once per user per local day, after 8pm local,
  // when they haven't rated the day yet.
  const ratingPromptCount = await dispatchEveningRatingPrompts();

  return {
    taskRemindersDispatched: taskCount,
    eventRemindersDispatched: eventCount,
    ratingPromptsDispatched: ratingPromptCount,
  };
}

async function dispatchEveningRatingPrompts(): Promise<number> {
  const tz = env.userTimeZone;
  const now = new Date();
  // Local hour in user tz
  const hourParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const localHour = parseInt(hourParts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  // Only between 8pm and 1am local
  if (localHour < 20 && localHour > 1) return 0;

  // Local date key
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const users = await prisma.user.findMany({ select: { id: true } });
  let sent = 0;
  for (const u of users) {
    const existing = await prisma.dayRating.findUnique({
      where: { userId_dateKey: { userId: u.id, dateKey } },
    });
    if (existing) continue;
    const results = await dispatchNotification({
      userId: u.id,
      kind: 'AGENT_PROPOSAL',
      title: 'Rate today',
      body: 'Quick 1-5 — how was today? Tap to log it.',
      sourceType: 'rating-prompt',
      sourceId: dateKey,
      sourceVersion: 'v1',
      url: '/dashboard',
      priority: 'NORMAL',
    });
    if (results.some((r) => r.status === 'SENT' || r.status === 'SUPPRESSED')) sent += 1;
  }
  return sent;
}
