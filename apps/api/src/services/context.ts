// Per-request user context for ranking + rollup.
// Single-user means we can load the whole graph; for multi-user later we'd
// scope this differently or push to materialized views.

import type {
  CalendarEvent,
  Category,
  Goal,
  GoalCategory,
  GoalRelationship,
  GoalTask,
  Task,
  TaskHistory,
  TaskPrerequisite,
} from '@prisma/client';
import { prisma } from '../prisma.js';

export interface UserContext {
  tasks: Task[];
  goals: Goal[];
  categories: Category[];
  goalTasks: GoalTask[];
  goalCategories: GoalCategory[];
  goalRelationships: GoalRelationship[];
  taskPrerequisites: TaskPrerequisite[];
  taskHistory: TaskHistory[];
  // Calendar events in a window relevant for ranking — past 1 day to next 30
  // days. Linked tasks reference these for urgency anchoring.
  events: CalendarEvent[];
}

export async function loadUserContext(userId: string): Promise<UserContext> {
  const eventsWindowStart = new Date(Date.now() - 86_400_000);
  const eventsWindowEnd = new Date(Date.now() + 30 * 86_400_000);

  const [
    tasks,
    goals,
    categories,
    goalTasks,
    goalCategories,
    goalRelationships,
    taskPrerequisites,
    taskHistory,
    events,
  ] =
    await Promise.all([
      prisma.task.findMany({ where: { userId } }),
      prisma.goal.findMany({ where: { userId } }),
      prisma.category.findMany({ where: { userId, archived: false }, orderBy: { sortOrder: 'asc' } }),
      prisma.goalTask.findMany({ where: { goal: { userId } } }),
      prisma.goalCategory.findMany({ where: { goal: { userId } } }),
      prisma.goalRelationship.findMany({ where: { fromGoal: { userId } } }),
      prisma.taskPrerequisite.findMany({ where: { task: { userId } } }),
      prisma.taskHistory.findMany({ where: { userId } }),
      prisma.calendarEvent.findMany({
        where: {
          userId,
          startsAt: { lt: eventsWindowEnd },
          endsAt: { gt: eventsWindowStart },
          status: { not: 'CANCELLED' },
          userHidden: false,
        },
        select: {
          id: true,
          userId: true,
          externalAccountId: true,
          sourceEventId: true,
          sourceCalendarId: true,
          iCalUid: true,
          recurringEventId: true,
          title: true,
          description: true,
          location: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          isRecurring: true,
          htmlLink: true,
          attendees: true,
          status: true,
          transparency: true,
          userHidden: true,
          raw: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

  // Cross-calendar dedup: same iCalUid + same startsAt → keep one copy.
  // Prefer events under a CalendarSource the user has mapped; fall back to
  // earliest-created.
  const calSources = await prisma.calendarSource.findMany({
    where: { userId },
    select: { externalAccountId: true, sourceCalendarId: true },
  });
  const mappedKey = new Set(
    calSources.map((s) => `${s.externalAccountId}::${s.sourceCalendarId ?? ''}`)
  );
  const isMapped = (e: { externalAccountId: string; sourceCalendarId: string | null }) =>
    mappedKey.has(`${e.externalAccountId}::${e.sourceCalendarId ?? ''}`);

  const byDupKey = new Map<string, typeof events[number]>();
  for (const e of events) {
    if (!e.iCalUid) {
      byDupKey.set(`__nodupkey__${e.id}`, e);
      continue;
    }
    const k = `${e.iCalUid}::${e.startsAt.getTime()}`;
    const existing = byDupKey.get(k);
    if (!existing) {
      byDupKey.set(k, e);
      continue;
    }
    const existingMapped = isMapped(existing);
    const candidateMapped = isMapped(e);
    if (candidateMapped && !existingMapped) {
      byDupKey.set(k, e);
    } else if (candidateMapped === existingMapped && e.createdAt < existing.createdAt) {
      byDupKey.set(k, e);
    }
  }
  const dedupedEvents = [...byDupKey.values()];

  return {
    tasks,
    goals,
    categories,
    goalTasks,
    goalCategories,
    goalRelationships,
    taskPrerequisites,
    taskHistory,
    events: dedupedEvents,
  };
}
