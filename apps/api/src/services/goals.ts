import type { Goal, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { loadUserContext, type UserContext } from './context.js';
import { goalProgress } from './progress.js';

export interface GoalCategoryMapping {
  categoryId: string;
  isPrimary: boolean;
  percentage: number;
}

export type GoalWithExtras = Goal & {
  linkedTaskIds: string[];
  totalTasks: number;
  completedTasks: number;
  /** Weighted progress (replaces simple ratio). */
  weightedProgress: number;
  categoryMappings: GoalCategoryMapping[];
  /** Other goals that must complete before this one can start. */
  prerequisiteIds: string[];
  /** True iff any prerequisite goal is incomplete (and not archived). */
  isBlocked: boolean;
};

function decorateGoals(goals: Goal[], ctx: UserContext): GoalWithExtras[] {
  const goalById = new Map(ctx.goals.map((g) => [g.id, g]));
  return goals.map((g) => {
    const links = ctx.goalTasks.filter((gt) => gt.goalId === g.id);
    const linked = ctx.tasks.filter((t) => links.some((l) => l.taskId === t.id));
    const completed = linked.filter((t) => t.completed).length;
    const mappings = ctx.goalCategories
      .filter((gc) => gc.goalId === g.id)
      .map((gc) => ({
        categoryId: gc.categoryId,
        isPrimary: gc.isPrimary,
        percentage: gc.percentage,
      }));
    // Prerequisites: GoalRelationship rows where this goal is "from" (the blocked one),
    // and "to" is the prerequisite, with type=PREREQUISITE.
    const prereqIds = ctx.goalRelationships
      .filter((r) => r.fromGoalId === g.id && r.type === 'PREREQUISITE')
      .map((r) => r.toGoalId);
    const isBlocked = !g.completed && prereqIds.some((id) => {
      const p = goalById.get(id);
      return p && !p.completed && !p.archived;
    });
    return {
      ...g,
      linkedTaskIds: links.map((l) => l.taskId),
      totalTasks: linked.length,
      completedTasks: completed,
      weightedProgress: goalProgress(g.id, ctx.tasks, ctx.goalTasks),
      categoryMappings: mappings,
      prerequisiteIds: prereqIds,
      isBlocked,
    };
  });
}

async function recomputeProgress(goalId: string): Promise<void> {
  const links = await prisma.goalTask.findMany({
    where: { goalId },
    include: { task: { select: { completed: true, weight: true } } },
  });
  if (links.length === 0) {
    await prisma.goal.update({ where: { id: goalId }, data: { progress: 0 } });
    return;
  }
  const totalW = links.reduce((s, l) => s + l.task.weight, 0);
  const weightedDone = links.reduce(
    (s, l) => s + (l.task.completed ? l.task.weight : 0),
    0
  );
  const progress = totalW === 0 ? 0 : (weightedDone / totalW) * 100;
  await prisma.goal.update({ where: { id: goalId }, data: { progress } });
}

export async function listGoals(userId: string, includeArchived = false): Promise<GoalWithExtras[]> {
  const ctx = await loadUserContext(userId);
  const goals = ctx.goals
    .filter((g) => includeArchived || !g.archived)
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const at = a.targetDate ? new Date(a.targetDate).getTime() : Number.POSITIVE_INFINITY;
      const bt = b.targetDate ? new Date(b.targetDate).getTime() : Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  return decorateGoals(goals, ctx);
}

export async function getGoal(userId: string, id: string): Promise<GoalWithExtras | null> {
  const ctx = await loadUserContext(userId);
  const goal = ctx.goals.find((g) => g.id === id);
  if (!goal) return null;
  const [decorated] = decorateGoals([goal], ctx);
  return decorated;
}

export async function createGoal(
  userId: string,
  input: {
    title: string;
    description?: string | null;
    primaryCategoryId?: string | null;
    targetDate?: string | null;
    targetValue?: number | null;
    weight?: number;
  }
): Promise<GoalWithExtras> {
  if (input.primaryCategoryId) {
    const cat = await prisma.category.findFirst({ where: { id: input.primaryCategoryId, userId } });
    if (!cat) throw new Error('Category not found');
  }
  const goal = await prisma.goal.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      primaryCategoryId: input.primaryCategoryId ?? null,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      targetValue: input.targetValue ?? null,
      weight: input.weight ?? 5,
    },
  });
  // Seed primary mapping in GoalCategory
  if (input.primaryCategoryId) {
    await prisma.goalCategory.create({
      data: {
        goalId: goal.id,
        categoryId: input.primaryCategoryId,
        isPrimary: true,
        percentage: 100,
      },
    });
  }
  const ctx = await loadUserContext(userId);
  const [decorated] = decorateGoals([goal], ctx);
  return decorated;
}

export async function updateGoal(
  userId: string,
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    primaryCategoryId: string | null;
    targetDate: string | null;
    targetValue: number | null;
    archived: boolean;
    completed: boolean;
    weight: number;
  }>
): Promise<GoalWithExtras | null> {
  const existing = await prisma.goal.findFirst({ where: { id, userId } });
  if (!existing) return null;

  const data: Prisma.GoalUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.primaryCategoryId !== undefined) {
    data.primaryCategory = patch.primaryCategoryId
      ? { connect: { id: patch.primaryCategoryId } }
      : { disconnect: true };
  }
  if (patch.targetDate !== undefined) data.targetDate = patch.targetDate ? new Date(patch.targetDate) : null;
  if (patch.targetValue !== undefined) data.targetValue = patch.targetValue;
  if (patch.archived !== undefined) data.archived = patch.archived;
  if (patch.completed !== undefined) {
    data.completed = patch.completed;
    data.completedAt = patch.completed ? new Date() : null;
  }
  if (patch.weight !== undefined) data.weight = patch.weight;

  const updated = await prisma.goal.update({ where: { id }, data });

  // Keep GoalCategory.isPrimary in sync with primaryCategoryId
  if (patch.primaryCategoryId !== undefined) {
    await prisma.goalCategory.updateMany({
      where: { goalId: id, isPrimary: true },
      data: { isPrimary: false },
    });
    if (patch.primaryCategoryId) {
      await prisma.goalCategory.upsert({
        where: { goalId_categoryId: { goalId: id, categoryId: patch.primaryCategoryId } },
        update: { isPrimary: true, percentage: 100 },
        create: {
          goalId: id,
          categoryId: patch.primaryCategoryId,
          isPrimary: true,
          percentage: 100,
        },
      });
    }
  }

  const ctx = await loadUserContext(userId);
  const [decorated] = decorateGoals([updated], ctx);
  return decorated;
}

export async function setGoalCategories(
  userId: string,
  goalId: string,
  mappings: GoalCategoryMapping[]
): Promise<GoalWithExtras | null> {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!goal) return null;

  // Validate: at most one primary; primary is 100%; secondaries 0..100.
  const primaries = mappings.filter((m) => m.isPrimary);
  if (primaries.length > 1) throw new Error('Only one primary category allowed');
  for (const m of mappings) {
    if (m.isPrimary && m.percentage !== 100) m.percentage = 100;
    if (!m.isPrimary && (m.percentage < 0 || m.percentage > 100)) {
      throw new Error('Secondary percentages must be 0..100');
    }
    const cat = await prisma.category.findFirst({ where: { id: m.categoryId, userId } });
    if (!cat) throw new Error(`Category ${m.categoryId} not found`);
  }

  await prisma.$transaction([
    prisma.goalCategory.deleteMany({ where: { goalId } }),
    ...mappings.map((m) =>
      prisma.goalCategory.create({
        data: {
          goalId,
          categoryId: m.categoryId,
          isPrimary: m.isPrimary,
          percentage: m.percentage,
        },
      })
    ),
    prisma.goal.update({
      where: { id: goalId },
      data: { primaryCategoryId: primaries[0]?.categoryId ?? null },
    }),
  ]);

  const ctx = await loadUserContext(userId);
  const updated = ctx.goals.find((g) => g.id === goalId);
  if (!updated) return null;
  const [decorated] = decorateGoals([updated], ctx);
  return decorated;
}

export async function deleteGoal(userId: string, id: string): Promise<boolean> {
  const existing = await prisma.goal.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await prisma.goal.delete({ where: { id } });
  return true;
}

export async function linkTask(userId: string, goalId: string, taskId: string): Promise<boolean> {
  const [goal, task] = await Promise.all([
    prisma.goal.findFirst({ where: { id: goalId, userId } }),
    prisma.task.findFirst({ where: { id: taskId, userId } }),
  ]);
  if (!goal || !task) return false;
  await prisma.goalTask.upsert({
    where: { goalId_taskId: { goalId, taskId } },
    create: { goalId, taskId },
    update: {},
  });
  await recomputeProgress(goalId);
  return true;
}

export async function unlinkTask(userId: string, goalId: string, taskId: string): Promise<boolean> {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!goal) return false;
  await prisma.goalTask.deleteMany({ where: { goalId, taskId } });
  await recomputeProgress(goalId);
  return true;
}

/** Called by the task service when a task's completion state changes. */
export async function recomputeProgressForTask(taskId: string): Promise<void> {
  const links = await prisma.goalTask.findMany({ where: { taskId }, select: { goalId: true } });
  for (const { goalId } of links) await recomputeProgress(goalId);
}

// --- Goal-to-goal prerequisite relationships ---

export async function addGoalPrerequisite(
  userId: string,
  goalId: string,
  prerequisiteId: string
): Promise<{ ok: true } | { error: string }> {
  if (goalId === prerequisiteId) return { error: 'A goal cannot be its own prerequisite' };
  const [goal, prereq] = await Promise.all([
    prisma.goal.findFirst({ where: { id: goalId, userId } }),
    prisma.goal.findFirst({ where: { id: prerequisiteId, userId } }),
  ]);
  if (!goal || !prereq) return { error: 'Goal or prerequisite not found' };

  // Cycle check: walk prereq's transitive prerequisites; if goalId appears, cycle.
  const seen = new Set<string>();
  const stack = [prerequisiteId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === goalId) return { error: 'Adding this prerequisite would create a cycle' };
    if (seen.has(cur)) continue;
    seen.add(cur);
    const next = await prisma.goalRelationship.findMany({
      where: { fromGoalId: cur, type: 'PREREQUISITE' },
      select: { toGoalId: true },
    });
    for (const n of next) stack.push(n.toGoalId);
  }

  await prisma.goalRelationship.upsert({
    where: { fromGoalId_toGoalId: { fromGoalId: goalId, toGoalId: prerequisiteId } },
    update: { type: 'PREREQUISITE' },
    create: {
      fromGoalId: goalId,
      toGoalId: prerequisiteId,
      type: 'PREREQUISITE',
    },
  });
  return { ok: true };
}

export async function removeGoalPrerequisite(
  userId: string,
  goalId: string,
  prerequisiteId: string
): Promise<boolean> {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!goal) return false;
  await prisma.goalRelationship.deleteMany({
    where: { fromGoalId: goalId, toGoalId: prerequisiteId, type: 'PREREQUISITE' },
  });
  return true;
}
