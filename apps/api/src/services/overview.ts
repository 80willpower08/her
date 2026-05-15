// Overview: full hierarchical snapshot — categories → goals → tasks → subtasks
// with progress at every level. Used by the Overview UI; will be a top-level
// agent tool op in Phase 4.

import { loadUserContext } from './context.js';
import { decorateCategories, type CategoryWithProgress } from './categories.js';
import { decorateTasks, type TaskWithExtras } from './tasks.js';
import { goalProgress } from './progress.js';

export interface OverviewTaskNode extends TaskWithExtras {
  subtasks: OverviewTaskNode[];
}

export interface OverviewGoalNode {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  completed: boolean;
  archived: boolean;
  targetDate: string | null;
  contributionPercentage: number; // 100 for primary, secondary's percentage value
  isSecondary: boolean;
  tasks: OverviewTaskNode[];
}

export interface OverviewCategoryNode {
  category: CategoryWithProgress;
  primaryGoals: OverviewGoalNode[];
  secondaryGoals: OverviewGoalNode[];
  looseTasks: OverviewTaskNode[];
}

export interface Overview {
  categories: OverviewCategoryNode[];
  uncategorized: {
    looseTasks: OverviewTaskNode[];
    goals: OverviewGoalNode[];
  };
}

export async function buildOverview(userId: string): Promise<Overview> {
  const ctx = await loadUserContext(userId);
  const decoratedCategories = decorateCategories(ctx.categories, ctx);
  const decoratedTasks = decorateTasks(ctx.tasks, ctx);

  const taskById = new Map(decoratedTasks.map((t) => [t.id, t]));

  // Build subtask trees from top-level tasks
  function buildTree(taskId: string): OverviewTaskNode | null {
    const t = taskById.get(taskId);
    if (!t) return null;
    const childIds = ctx.tasks.filter((c) => c.parentId === t.id).map((c) => c.id);
    const subtasks = childIds
      .map((id) => buildTree(id))
      .filter((x): x is OverviewTaskNode => x !== null);
    return { ...t, subtasks };
  }

  const tasksLinkedToAnyGoal = new Set(ctx.goalTasks.map((gt) => gt.taskId));

  function buildGoalNode(
    goalId: string,
    contributionPercentage: number,
    isSecondary: boolean
  ): OverviewGoalNode | null {
    const goal = ctx.goals.find((g) => g.id === goalId);
    if (!goal || goal.archived) return null;
    const linkedTaskIds = ctx.goalTasks.filter((gt) => gt.goalId === goalId).map((gt) => gt.taskId);
    // Tree-build only top-level linked tasks (subtasks rolled in)
    const trees = linkedTaskIds
      .filter((id) => {
        const t = ctx.tasks.find((x) => x.id === id);
        return t && !t.parentId;
      })
      .map((id) => buildTree(id))
      .filter((x): x is OverviewTaskNode => x !== null);
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      weight: goal.weight,
      progress: goalProgress(goal.id, ctx.tasks, ctx.goalTasks),
      completed: goal.completed,
      archived: goal.archived,
      targetDate: goal.targetDate ? goal.targetDate.toISOString() : null,
      contributionPercentage,
      isSecondary,
      tasks: trees,
    };
  }

  const categoryNodes: OverviewCategoryNode[] = decoratedCategories.map((cat) => {
    // Primary goals: where Goal.primaryCategoryId === cat.id
    const primaryGoalIds = ctx.goals
      .filter((g) => g.primaryCategoryId === cat.id && !g.archived)
      .map((g) => g.id);
    const primaryGoals = primaryGoalIds
      .map((id) => buildGoalNode(id, 100, false))
      .filter((x): x is OverviewGoalNode => x !== null);

    // Secondary goals: from GoalCategory rows where !isPrimary
    const secondaryMappings = ctx.goalCategories.filter(
      (gc) => gc.categoryId === cat.id && !gc.isPrimary
    );
    const secondaryGoals = secondaryMappings
      .map((gc) => buildGoalNode(gc.goalId, gc.percentage, true))
      .filter((x): x is OverviewGoalNode => x !== null);

    // Loose tasks: this category, no goal link, top-level only
    const looseTaskIds = ctx.tasks
      .filter(
        (t) =>
          t.categoryId === cat.id &&
          !t.parentId &&
          !tasksLinkedToAnyGoal.has(t.id)
      )
      .map((t) => t.id);
    const looseTasks = looseTaskIds
      .map((id) => buildTree(id))
      .filter((x): x is OverviewTaskNode => x !== null);

    return { category: cat, primaryGoals, secondaryGoals, looseTasks };
  });

  // Uncategorized
  const uncategorizedGoalIds = ctx.goals
    .filter((g) => !g.archived && !g.primaryCategoryId)
    .map((g) => g.id);
  const uncategorizedGoals = uncategorizedGoalIds
    .map((id) => buildGoalNode(id, 100, false))
    .filter((x): x is OverviewGoalNode => x !== null);

  const uncategorizedLooseTaskIds = ctx.tasks
    .filter(
      (t) =>
        !t.categoryId &&
        !t.parentId &&
        !tasksLinkedToAnyGoal.has(t.id)
    )
    .map((t) => t.id);
  const uncategorizedLooseTasks = uncategorizedLooseTaskIds
    .map((id) => buildTree(id))
    .filter((x): x is OverviewTaskNode => x !== null);

  return {
    categories: categoryNodes,
    uncategorized: { looseTasks: uncategorizedLooseTasks, goals: uncategorizedGoals },
  };
}
