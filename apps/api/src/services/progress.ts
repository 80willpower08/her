// Single source of truth for progress rollup and ranking.
// Pure functions over already-fetched data — no DB calls.
// Used by API endpoints today; will be invoked by the agent's tool layer in Phase 4.

import type { CalendarEvent, Category, Goal, GoalCategory, GoalTask, Task } from '@prisma/client';

export type DerivedPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RankBreakdown {
  importance: number;
  urgency: number;
  performance: number;
  rank: number;
  derivedPriority: DerivedPriority;
}

// User-tunable α weights for the importance blend. Default per design discussion.
const ALPHA = {
  self: 0.35,
  parent: 0.20,
  goal: 0.30,
  category: 0.15,
} as const;

// Outer weights between importance / urgency / performance in the final rank.
const W_IMP = 0.5;
const W_URG = 0.4;
const W_PERF = 0.1;

const norm = (weight: number) => Math.max(0, Math.min(1, (weight - 1) / 9));

export function bucketToPriority(score: number): DerivedPriority {
  if (score < 0.25) return 'LOW';
  if (score < 0.5) return 'MEDIUM';
  if (score < 0.75) return 'HIGH';
  return 'CRITICAL';
}

// ─────────────────────────────────────────────────────────────────
// Progress (upward rollup)
// ─────────────────────────────────────────────────────────────────

/**
 * Task progress 0..1.
 * - Completed task: 1.
 * - Has subtasks: weighted average of subtask progress (recursive).
 * - Otherwise: 0.
 */
export function taskProgress(task: Task, allTasks: Task[]): number {
  if (task.completed) return 1;
  const subtasks = allTasks.filter((t) => t.parentId === task.id);
  if (subtasks.length === 0) return 0;
  const totalW = subtasks.reduce((s, t) => s + t.weight, 0);
  if (totalW === 0) return 0;
  const num = subtasks.reduce((s, t) => s + t.weight * taskProgress(t, allTasks), 0);
  return num / totalW;
}

/** Goal progress 0..1: weighted average of linked task progress by task weight. */
export function goalProgress(goalId: string, allTasks: Task[], goalTasks: GoalTask[]): number {
  const linkedIds = goalTasks.filter((gt) => gt.goalId === goalId).map((gt) => gt.taskId);
  const linked = allTasks.filter((t) => linkedIds.includes(t.id));
  if (linked.length === 0) return 0;
  const totalW = linked.reduce((s, t) => s + t.weight, 0);
  if (totalW === 0) return 0;
  const num = linked.reduce((s, t) => s + t.weight * taskProgress(t, allTasks), 0);
  return num / totalW;
}

/**
 * Category progress 0..1.
 * Contributions:
 *   - Loose tasks (categoryId == C, not linked to any goal): T.weight × T.progress
 *   - Goals with primary category C: G.weight × G.progress
 *   - Goals with secondary mapping (C, P%): G.weight × (P/100) × G.progress
 * Secondaries are additive contributions, NOT slices of a fixed pie.
 */
export function categoryProgress(
  categoryId: string,
  ctx: {
    tasks: Task[];
    goals: Goal[];
    goalTasks: GoalTask[];
    goalCategories: GoalCategory[];
  }
): number {
  const { tasks, goals, goalTasks, goalCategories } = ctx;

  let num = 0;
  let den = 0;

  // Loose tasks (no goal link)
  const tasksLinkedToAnyGoal = new Set(goalTasks.map((gt) => gt.taskId));
  for (const t of tasks) {
    if (t.categoryId !== categoryId) continue;
    if (tasksLinkedToAnyGoal.has(t.id)) continue;
    if (t.parentId) continue; // top-level tasks only — subtasks roll up via parent
    den += t.weight;
    num += t.weight * taskProgress(t, tasks);
  }

  // Goals: primary or secondary mapping into this category
  for (const g of goals) {
    if (g.archived) continue;

    // Primary
    if (g.primaryCategoryId === categoryId) {
      const p = goalProgress(g.id, tasks, goalTasks);
      den += g.weight;
      num += g.weight * p;
    }

    // Explicit secondary mapping (GoalCategory rows where !isPrimary)
    const secondary = goalCategories.find(
      (gc) => gc.goalId === g.id && gc.categoryId === categoryId && !gc.isPrimary
    );
    if (secondary) {
      const p = goalProgress(g.id, tasks, goalTasks);
      const share = secondary.percentage / 100;
      den += g.weight * share;
      num += g.weight * share * p;
    }
  }

  return den === 0 ? 0 : num / den;
}

// ─────────────────────────────────────────────────────────────────
// Importance (downward — for ranking)
// ─────────────────────────────────────────────────────────────────

/**
 * Task importance 0..1, blending self/parent/goal/category weights.
 * Adaptive renormalization: missing inputs (no parent, no goal) drop out and
 * remaining α's renormalize so the formula collapses naturally.
 */
export function taskImportance(
  task: Task,
  ctx: {
    tasks: Task[];
    goals: Goal[];
    categories: Category[];
    goalTasks: GoalTask[];
  }
): number {
  const { tasks, goals, categories, goalTasks } = ctx;

  const parts: { alpha: number; value: number }[] = [];

  // self
  parts.push({ alpha: ALPHA.self, value: norm(task.weight) });

  // parent (if subtask)
  if (task.parentId) {
    const parent = tasks.find((t) => t.id === task.parentId);
    if (parent) parts.push({ alpha: ALPHA.parent, value: norm(parent.weight) });
  }

  // goal (if linked, directly or via parent)
  const lineageIds = [task.id, ...(task.parentId ? [task.parentId] : [])];
  const linkedGoals = goals.filter(
    (g) => goalTasks.some((gt) => gt.goalId === g.id && lineageIds.includes(gt.taskId))
  );
  if (linkedGoals.length > 0) {
    const maxGoalWeight = Math.max(...linkedGoals.map((g) => g.weight));
    parts.push({ alpha: ALPHA.goal, value: norm(maxGoalWeight) });
  }

  // category (resolve from task or via the highest-weight linked goal's primary)
  let categoryId = task.categoryId;
  if (!categoryId && linkedGoals.length > 0) {
    const top = linkedGoals.reduce((a, b) => (a.weight >= b.weight ? a : b));
    categoryId = top.primaryCategoryId;
  }
  if (categoryId) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) parts.push({ alpha: ALPHA.category, value: norm(cat.weight) });
  }

  if (parts.length === 0) return 0;
  const totalAlpha = parts.reduce((s, p) => s + p.alpha, 0);
  return parts.reduce((s, p) => s + (p.alpha / totalAlpha) * p.value, 0);
}

// ─────────────────────────────────────────────────────────────────
// Urgency
// ─────────────────────────────────────────────────────────────────

/**
 * Effective deadline for a task. If the task is linked to a calendar event,
 * that event's start time wins over dueDate/scheduledFor. (The whole point of
 * linking — the meeting starts at X, so prep is due by X.)
 */
export function effectiveDeadline(task: Task, events: CalendarEvent[]): Date | null {
  if (task.linkedCalendarEventId) {
    const ev = events.find((e) => e.id === task.linkedCalendarEventId);
    if (ev) return new Date(ev.startsAt);
  }
  if (task.dueDate) return new Date(task.dueDate);
  if (task.scheduledFor) return new Date(task.scheduledFor);
  return null;
}

/**
 * Urgency 0..1 from due/scheduled date proximity.
 * Overdue → 1.0, today → 0.9, week → 0.5, month → 0.2, none → 0.1.
 */
export function taskUrgency(task: Task, events: CalendarEvent[] = [], now: Date = new Date()): number {
  const target = effectiveDeadline(task, events);
  if (!target) return 0.1;
  const dt = target.getTime() - now.getTime();
  const day = 86_400_000;
  if (dt < 0) return 1.0;
  if (dt < day) return 0.9;
  if (dt < 3 * day) return 0.7;
  if (dt < 7 * day) return 0.5;
  if (dt < 30 * day) return 0.3;
  return 0.15;
}

// ─────────────────────────────────────────────────────────────────
// Performance — placeholder until enough TaskHistory accumulates
// ─────────────────────────────────────────────────────────────────

export interface PerformanceStats {
  /** Categories the user typically completes successfully (high completion rate) */
  byCategory: Map<string, { completionRate: number; onTimeRate: number; sampleSize: number }>;
}

/**
 * Performance factor 0..1. Default 0.5 (neutral) when no data.
 * Higher = strength category (slight rank reduction makes sense — user breezes through).
 * Lower = struggle category (slight rank boost — user defers and needs the nudge).
 *
 * For Phase 1.6 we surface stats in the Patterns view; the agent will use this in Phase 4
 * for scheduling. The ranker uses a small weight (W_PERF = 0.1) so it nudges, not dominates.
 */
export function taskPerformance(task: Task, stats?: PerformanceStats): number {
  if (!stats || !task.categoryId) return 0.5;
  const s = stats.byCategory.get(task.categoryId);
  if (!s || s.sampleSize < 3) return 0.5;
  // Higher rank score for things you struggle with (need more attention).
  // Invert: low completion rate → high score.
  const struggleSignal = 1 - s.completionRate;
  return 0.5 + 0.5 * struggleSignal; // 0.5..1.0
}

// ─────────────────────────────────────────────────────────────────
// Rank (composite)
// ─────────────────────────────────────────────────────────────────

export function taskRank(
  task: Task,
  ctx: {
    tasks: Task[];
    goals: Goal[];
    categories: Category[];
    goalTasks: GoalTask[];
    events?: CalendarEvent[];
    perfStats?: PerformanceStats;
    now?: Date;
  }
): RankBreakdown {
  if (task.completed) {
    return { importance: 0, urgency: 0, performance: 0, rank: 0, derivedPriority: 'LOW' };
  }
  const importance = taskImportance(task, ctx);
  const urgency = taskUrgency(task, ctx.events ?? [], ctx.now);
  const performance = taskPerformance(task, ctx.perfStats);
  const rank = W_IMP * importance + W_URG * urgency + W_PERF * performance;
  return {
    importance,
    urgency,
    performance,
    rank,
    derivedPriority: bucketToPriority(importance),
  };
}
