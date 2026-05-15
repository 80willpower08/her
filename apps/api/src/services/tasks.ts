import type { Prisma, Task, TaskPriority } from '@prisma/client';
import { prisma } from '../prisma.js';
import { recomputeProgressForTask } from './goals.js';
import { loadUserContext, type UserContext } from './context.js';
import {
  taskProgress,
  taskRank,
  type DerivedPriority,
  type RankBreakdown,
} from './progress.js';

export type TaskWithExtras = Task & {
  isBlocked: boolean;
  prerequisiteIds: string[];
  subtaskIds: string[];
  progress: number;
  importance: number;
  urgency: number;
  rank: number;
  rankBreakdown: RankBreakdown;
  derivedPriority: DerivedPriority;
  linkedCalendarEvent: { id: string; title: string; startsAt: string } | null;
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfTomorrow(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

/** Decorate tasks with derived fields. Pass in pre-loaded context. */
export function decorateTasks(tasks: Task[], ctx: UserContext): TaskWithExtras[] {
  if (tasks.length === 0) return [];
  const completedSet = new Set(ctx.tasks.filter((t) => t.completed).map((t) => t.id));

  const prereqMap = new Map<string, string[]>();
  for (const p of ctx.taskPrerequisites) {
    const arr = prereqMap.get(p.taskId) ?? [];
    arr.push(p.prerequisiteId);
    prereqMap.set(p.taskId, arr);
  }
  const subtaskMap = new Map<string, string[]>();
  for (const t of ctx.tasks) {
    if (!t.parentId) continue;
    const arr = subtaskMap.get(t.parentId) ?? [];
    arr.push(t.id);
    subtaskMap.set(t.parentId, arr);
  }

  return tasks.map((t) => {
    const prereqIds = prereqMap.get(t.id) ?? [];
    const isBlocked = !t.completed && prereqIds.some((id) => !completedSet.has(id));
    const breakdown = taskRank(t, ctx);
    const linkedEvent = t.linkedCalendarEventId
      ? ctx.events.find((e) => e.id === t.linkedCalendarEventId)
      : null;
    return {
      ...t,
      isBlocked,
      prerequisiteIds: prereqIds,
      subtaskIds: subtaskMap.get(t.id) ?? [],
      progress: taskProgress(t, ctx.tasks),
      importance: breakdown.importance,
      urgency: breakdown.urgency,
      rank: breakdown.rank,
      rankBreakdown: breakdown,
      derivedPriority: breakdown.derivedPriority,
      linkedCalendarEvent: linkedEvent
        ? {
            id: linkedEvent.id,
            title: linkedEvent.title,
            startsAt: linkedEvent.startsAt.toISOString(),
          }
        : null,
    };
  });
}

export async function listTasks(
  userId: string,
  opts: {
    view?: 'today' | 'all';
    categoryId?: string;
    goalId?: string;
    completed?: boolean;
    includeSubtasks?: boolean;
  } = {}
): Promise<TaskWithExtras[]> {
  const ctx = await loadUserContext(userId);

  let filtered = ctx.tasks;

  if (opts.completed !== undefined) filtered = filtered.filter((t) => t.completed === opts.completed);
  if (opts.categoryId) filtered = filtered.filter((t) => t.categoryId === opts.categoryId);

  if (opts.view === 'today') {
    const today = startOfToday();
    const tomorrow = startOfTomorrow();
    filtered = filtered.filter((t) => {
      if (t.completed) return false;
      const due = t.dueDate ? new Date(t.dueDate) : null;
      const sched = t.scheduledFor ? new Date(t.scheduledFor) : null;
      // Anything due before tomorrow (overdue + today) OR scheduled for today
      if (due && due < tomorrow) return true;
      if (sched && sched >= today && sched < tomorrow) return true;
      // Or linked to an event happening today
      if (t.linkedCalendarEventId) {
        const ev = ctx.events.find((e) => e.id === t.linkedCalendarEventId);
        if (ev && ev.startsAt >= today && ev.startsAt < tomorrow) return true;
      }
      return false;
    });
  }

  if (opts.goalId) {
    const taskIds = new Set(
      ctx.goalTasks.filter((gt) => gt.goalId === opts.goalId).map((gt) => gt.taskId)
    );
    filtered = filtered.filter((t) => taskIds.has(t.id));
  }

  if (!opts.includeSubtasks) filtered = filtered.filter((t) => !t.parentId);

  const decorated = decorateTasks(filtered, ctx);
  // Order by rank desc, then dueDate asc, then createdAt asc
  decorated.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (b.rank !== a.rank) return b.rank - a.rank;
    const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  return decorated;
}

export async function getTask(userId: string, id: string): Promise<TaskWithExtras | null> {
  const ctx = await loadUserContext(userId);
  const task = ctx.tasks.find((t) => t.id === id);
  if (!task) return null;
  const [decorated] = decorateTasks([task], ctx);
  return decorated;
}

export async function createTask(
  userId: string,
  input: {
    title: string;
    description?: string | null;
    categoryId?: string | null;
    priority?: TaskPriority;
    weight?: number;
    dueDate?: string | null;
    scheduledFor?: string | null;
    estimatedMinutes?: number | null;
    parentId?: string | null;
    tags?: string[];
    linkedCalendarEventId?: string | null;
  }
): Promise<TaskWithExtras> {
  if (input.parentId) {
    const parent = await prisma.task.findFirst({ where: { id: input.parentId, userId } });
    if (!parent) throw new Error('Parent task not found');
  }
  if (input.categoryId) {
    const cat = await prisma.category.findFirst({ where: { id: input.categoryId, userId } });
    if (!cat) throw new Error('Category not found');
  }
  // If linking to an event and the user didn't specify a category,
  // inherit the event's source-account default category.
  let resolvedCategoryId = input.categoryId ?? null;
  if (input.linkedCalendarEventId) {
    const ev = await prisma.calendarEvent.findFirst({
      where: { id: input.linkedCalendarEventId, userId },
      include: { externalAccount: { select: { defaultCategoryId: true } } },
    });
    if (!ev) throw new Error('Calendar event not found');
    if (!resolvedCategoryId && ev.externalAccount.defaultCategoryId) {
      resolvedCategoryId = ev.externalAccount.defaultCategoryId;
    }
  }

  const task = await prisma.task.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      categoryId: resolvedCategoryId,
      priority: input.priority ?? 'MEDIUM',
      weight: input.weight ?? 5,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      parentId: input.parentId ?? null,
      tags: input.tags ?? [],
      linkedCalendarEventId: input.linkedCalendarEventId ?? null,
    },
  });
  const ctx = await loadUserContext(userId);
  const [decorated] = decorateTasks([task], ctx);
  return decorated;
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    categoryId: string | null;
    priority: TaskPriority;
    weight: number;
    dueDate: string | null;
    scheduledFor: string | null;
    estimatedMinutes: number | null;
    tags: string[];
    notes: string | null;
    linkedCalendarEventId: string | null;
  }>
): Promise<TaskWithExtras | null> {
  const existing = await prisma.task.findFirst({ where: { id, userId } });
  if (!existing) return null;

  if (patch.categoryId !== undefined && patch.categoryId !== null) {
    const cat = await prisma.category.findFirst({ where: { id: patch.categoryId, userId } });
    if (!cat) throw new Error('Category not found');
  }
  if (patch.linkedCalendarEventId !== undefined && patch.linkedCalendarEventId !== null) {
    const ev = await prisma.calendarEvent.findFirst({
      where: { id: patch.linkedCalendarEventId, userId },
    });
    if (!ev) throw new Error('Calendar event not found');
  }

  const data: Prisma.TaskUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.categoryId !== undefined) {
    data.category = patch.categoryId
      ? { connect: { id: patch.categoryId } }
      : { disconnect: true };
  }
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.weight !== undefined) data.weight = patch.weight;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  if (patch.scheduledFor !== undefined)
    data.scheduledFor = patch.scheduledFor ? new Date(patch.scheduledFor) : null;
  if (patch.estimatedMinutes !== undefined) data.estimatedMinutes = patch.estimatedMinutes;
  if (patch.tags !== undefined) data.tags = patch.tags;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.linkedCalendarEventId !== undefined) {
    data.linkedCalendarEvent = patch.linkedCalendarEventId
      ? { connect: { id: patch.linkedCalendarEventId } }
      : { disconnect: true };
  }

  const updated = await prisma.task.update({ where: { id }, data });
  const ctx = await loadUserContext(userId);
  const [decorated] = decorateTasks([updated], ctx);
  return decorated;
}

export async function deleteTask(userId: string, id: string): Promise<boolean> {
  const existing = await prisma.task.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await prisma.task.delete({ where: { id } });
  return true;
}

export async function completeTask(
  userId: string,
  id: string
): Promise<{ task: TaskWithExtras } | { blockedBy: string[] }> {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw new Error('Task not found');
  if (task.completed) {
    const ctx = await loadUserContext(userId);
    const [decorated] = decorateTasks([task], ctx);
    return { task: decorated };
  }

  const prereqs = await prisma.taskPrerequisite.findMany({
    where: { taskId: id },
    include: { prerequisite: { select: { id: true, completed: true } } },
  });
  const blockingIds = prereqs.filter((p) => !p.prerequisite.completed).map((p) => p.prerequisiteId);
  if (blockingIds.length > 0) return { blockedBy: blockingIds };

  const now = new Date();
  const onTime = !task.dueDate || now <= task.dueDate;

  const [updated] = await prisma.$transaction([
    prisma.task.update({
      where: { id },
      data: { completed: true, completedAt: now },
    }),
    prisma.taskHistory.create({
      data: { userId, taskId: id, completedAt: now, onTime, timeSpent: task.timeSpent || null },
    }),
  ]);

  await recomputeProgressForTask(id);
  const ctx = await loadUserContext(userId);
  const [decorated] = decorateTasks([updated], ctx);
  return { task: decorated };
}

export async function uncompleteTask(userId: string, id: string): Promise<TaskWithExtras | null> {
  const existing = await prisma.task.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const updated = await prisma.task.update({
    where: { id },
    data: { completed: false, completedAt: null },
  });
  await recomputeProgressForTask(id);
  const ctx = await loadUserContext(userId);
  const [decorated] = decorateTasks([updated], ctx);
  return decorated;
}

export async function addPrerequisite(
  userId: string,
  taskId: string,
  prerequisiteId: string
): Promise<{ ok: true } | { error: string }> {
  if (taskId === prerequisiteId) return { error: 'A task cannot be its own prerequisite' };
  const [task, prereq] = await Promise.all([
    prisma.task.findFirst({ where: { id: taskId, userId } }),
    prisma.task.findFirst({ where: { id: prerequisiteId, userId } }),
  ]);
  if (!task || !prereq) return { error: 'Task or prerequisite not found' };

  // Cycle check: walk prereq's transitive prerequisites; if taskId appears, it's a cycle.
  const seen = new Set<string>();
  const stack = [prerequisiteId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return { error: 'Adding this prerequisite would create a cycle' };
    if (seen.has(cur)) continue;
    seen.add(cur);
    const next = await prisma.taskPrerequisite.findMany({
      where: { taskId: cur },
      select: { prerequisiteId: true },
    });
    for (const n of next) stack.push(n.prerequisiteId);
  }

  await prisma.taskPrerequisite.upsert({
    where: { taskId_prerequisiteId: { taskId, prerequisiteId } },
    update: {},
    create: { taskId, prerequisiteId },
  });
  return { ok: true };
}

export async function removePrerequisite(
  userId: string,
  taskId: string,
  prerequisiteId: string
): Promise<boolean> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) return false;
  await prisma.taskPrerequisite.deleteMany({ where: { taskId, prerequisiteId } });
  return true;
}
