// Dashboard metrics aggregator. One shot, returns everything Phase 1 needs.
//
// Reads:
//   - Tasks (with categoryId, completedAt, createdAt, dueDate)
//   - TaskHistory (the audit log of completions)
//   - Goals (with progress + targetDate)
//   - ProposedActions (approval rate)
//
// All windows are user-tz aware. Default window = 30 days.

import { prisma } from '../prisma.js';
import { env } from '../env.js';

export interface DashboardMetrics {
  windowDays: number;
  generatedAt: string;
  timezone: string;

  // Hero KPIs (current window vs prior window for trend arrows)
  kpis: {
    tasksCompleted: { current: number; prior: number };
    goalMomentum: { current: number; prior: number }; // tasks completed that are linked to a non-archived goal
    approvalRate: { current: number; prior: number }; // 0..1 over decided proposals (APPROVED+EXECUTED / total decided)
    procrastinationIndex: { current: number; prior: number }; // 0..1 — share of completed tasks that finished AFTER their dueDate
  };

  // Per-category breakdown for bubbles + sparklines
  categories: Array<{
    id: string;
    name: string;
    color: string;
    weight: number;
    completedInWindow: number;
    activeTaskCount: number; // not completed, not archived
    staleTaskCount: number; // not completed and not touched in 30+ days
    medianLeadTimeHours: number | null; // create → complete median in this window
    onTimeRate: number | null; // share with completedAt <= dueDate (where dueDate present)
    sparkline: number[]; // last 14 daily completion counts, oldest first
  }>;

  // Goal progress
  goals: Array<{
    id: string;
    title: string;
    primaryCategoryId: string | null;
    weight: number;
    progress: number; // 0..1
    completed: boolean;
    targetDate: string | null;
    paceState: 'no-target' | 'on-pace' | 'ahead' | 'behind' | 'overdue' | 'done';
    pctTimeElapsed: number | null; // 0..1 if targetDate
    paceDeltaDays: number | null; // positive = ahead, negative = behind
    linkedTaskTotal: number;
    linkedTaskComplete: number;
  }>;

  // Approval rate breakdown
  approvalByKind: Array<{
    kind: string;
    decided: number;
    approved: number;
    rate: number;
  }>;

  // Daily completion grid: { dateKey: 'YYYY-MM-DD', count, categoryCounts: {id: count} }
  // Last 371 days (53 weeks × 7), oldest first.
  streakGrid: Array<{
    date: string; // YYYY-MM-DD in user tz
    count: number;
    byCategory: Record<string, number>; // categoryId → count
  }>;

  // Time-of-day histogram (24 buckets) — when in the day tasks get completed
  timeOfDay: number[]; // length 24, oldest = 0:00
  // Day-of-week histogram (7 buckets, 0=Sun..6=Sat)
  dayOfWeek: number[];

  // Auto-generated growth feed entries (last 90d), newest first, max 15.
  growthFeed: Array<{
    date: string;
    kind: 'goal-complete' | 'project-complete' | 'goal-milestone' | 'streak' | 'sheet-update';
    title: string;
    detail: string;
    goalId?: string;
    projectId?: string;
    categoryId?: string;
  }>;

  // Finance snapshot from the user's registered finance sheet (best effort).
  finance: {
    available: boolean;
    totalDebt: number | null;
    totalCurrentValue: number | null;
    monthlyDebtPayments: number | null;
    lastSyncedAt: string | null;
    sourceLabel: string | null;
    note: string | null;
  };

  // Self-rated daily energy/satisfaction. Most-recent first.
  dayRatings: {
    average: number | null;
    count: number;
    today: string; // dateKey for current local day
    todaysRating: number | null;
    series: Array<{ date: string; rating: number; note: string | null }>; // last 30 days, oldest first
    // Quick correlation hints — non-statistical, just "on days you rated 4+
    // you completed X tasks on average vs Y tasks on lower-rated days".
    correlation: {
      highDayAvgCompletions: number | null;
      lowDayAvgCompletions: number | null;
      strongestCategoryName: string | null;
      strongestCategoryEffect: number | null; // delta in % share between high and low days
    };
  };
}

const DAY_MS = 86_400_000;

function localDateKey(date: Date, tz: string): string {
  // YYYY-MM-DD in user tz. en-CA gives ISO-ish format reliably.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function localHour(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '0';
  return parseInt(h, 10) % 24;
}

function localDayOfWeek(date: Date, tz: string): number {
  // Sunday=0..Saturday=6
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).formatToParts(date);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function buildDashboardMetrics(
  userId: string,
  windowDays = 30
): Promise<DashboardMetrics> {
  const tz = env.userTimeZone;
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);
  const priorStart = new Date(windowStart.getTime() - windowDays * DAY_MS);

  // === Tasks + history ===
  const [categories, tasks, historyAll, goals, goalTasks, decidedActions, dayRatingRows] =
    await Promise.all([
      prisma.category.findMany({
        where: { userId, archived: false },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.task.findMany({
        where: { userId },
        select: {
          id: true,
          categoryId: true,
          createdAt: true,
          completedAt: true,
          completed: true,
          dueDate: true,
          updatedAt: true,
        },
      }),
      prisma.taskHistory.findMany({
        where: { userId, completedAt: { gte: priorStart } },
        select: { taskId: true, completedAt: true, onTime: true },
      }),
      prisma.goal.findMany({
        where: { userId, archived: false },
        select: {
          id: true,
          title: true,
          primaryCategoryId: true,
          weight: true,
          progress: true,
          completed: true,
          targetDate: true,
          createdAt: true,
        },
      }),
      prisma.goalTask.findMany({
        where: { goal: { userId } },
        select: { goalId: true, taskId: true },
      }),
      prisma.proposedAction.findMany({
        where: {
          userId,
          createdAt: { gte: priorStart },
          status: { in: ['EXECUTED', 'DENIED'] },
          decidedAt: { not: null },
        },
        select: {
          kind: true,
          status: true,
          decidedAt: true,
          createdAt: true,
        },
      }),
      prisma.dayRating.findMany({
        where: { userId },
        orderBy: { dateKey: 'desc' },
        take: 90,
      }),
    ]);

  // Map: taskId → categoryId  (some history rows may point to tasks whose
  // category changed; use the task's current categoryId).
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // === Window splitting ===
  const inCurrent = (d: Date) => d >= windowStart && d <= now;
  const inPrior = (d: Date) => d >= priorStart && d < windowStart;

  const historyCurrent = historyAll.filter((h) => inCurrent(h.completedAt));
  const historyPrior = historyAll.filter((h) => inPrior(h.completedAt));

  // === KPIs ===
  const tasksCompletedCurrent = historyCurrent.length;
  const tasksCompletedPrior = historyPrior.length;

  // Goal momentum: completions that belong to a task linked to a non-archived goal
  const goalLinkedTaskIds = new Set(goalTasks.map((gt) => gt.taskId));
  const goalMomentumCurrent = historyCurrent.filter((h) => goalLinkedTaskIds.has(h.taskId)).length;
  const goalMomentumPrior = historyPrior.filter((h) => goalLinkedTaskIds.has(h.taskId)).length;

  // Approval rate
  const decidedCurrent = decidedActions.filter(
    (a) => a.decidedAt && inCurrent(a.decidedAt)
  );
  const decidedPrior = decidedActions.filter((a) => a.decidedAt && inPrior(a.decidedAt));
  const approvedCurrent = decidedCurrent.filter((a) => a.status === 'EXECUTED').length;
  const approvedPrior = decidedPrior.filter((a) => a.status === 'EXECUTED').length;
  const approvalRateCurrent = decidedCurrent.length
    ? approvedCurrent / decidedCurrent.length
    : 0;
  const approvalRatePrior = decidedPrior.length ? approvedPrior / decidedPrior.length : 0;

  // Procrastination — share of completed tasks (in window) whose completedAt > dueDate
  function procRate(hist: typeof historyAll): number {
    let counted = 0;
    let late = 0;
    for (const h of hist) {
      const t = taskById.get(h.taskId);
      if (!t?.dueDate) continue;
      counted += 1;
      if (h.completedAt > t.dueDate) late += 1;
    }
    return counted ? late / counted : 0;
  }
  const procCurrent = procRate(historyCurrent);
  const procPrior = procRate(historyPrior);

  // === Approval breakdown by kind ===
  const kindBuckets = new Map<string, { decided: number; approved: number }>();
  for (const a of decidedCurrent) {
    const b = kindBuckets.get(a.kind) ?? { decided: 0, approved: 0 };
    b.decided += 1;
    if (a.status === 'EXECUTED') b.approved += 1;
    kindBuckets.set(a.kind, b);
  }
  const approvalByKind = [...kindBuckets.entries()]
    .map(([kind, v]) => ({
      kind,
      decided: v.decided,
      approved: v.approved,
      rate: v.decided ? v.approved / v.decided : 0,
    }))
    .sort((a, b) => b.decided - a.decided);

  // === Per-category breakdown ===
  const completionsByCatThisWindow = new Map<string, Date[]>();
  for (const h of historyCurrent) {
    const t = taskById.get(h.taskId);
    if (!t) continue;
    const catId = t.categoryId ?? '__uncategorized__';
    const arr = completionsByCatThisWindow.get(catId) ?? [];
    arr.push(h.completedAt);
    completionsByCatThisWindow.set(catId, arr);
  }

  const staleThreshold = new Date(now.getTime() - 30 * DAY_MS);
  const sparklineDays = 14;
  const sparklineStart = new Date(now.getTime() - sparklineDays * DAY_MS);

  const cats = categories.map((c) => {
    const tasksInCat = tasks.filter((t) => t.categoryId === c.id);
    const active = tasksInCat.filter((t) => !t.completed);
    const stale = active.filter((t) => t.updatedAt < staleThreshold);
    const completionTimes = completionsByCatThisWindow.get(c.id) ?? [];

    // Median lead time (createdAt → completedAt) in hours
    const leadTimes: number[] = [];
    for (const t of tasksInCat) {
      if (!t.completed || !t.completedAt) continue;
      if (t.completedAt < windowStart) continue;
      const hours = (t.completedAt.getTime() - t.createdAt.getTime()) / 3_600_000;
      leadTimes.push(hours);
    }
    const medianLT = median(leadTimes);

    // On-time rate
    let onTimeCounted = 0;
    let onTimeWins = 0;
    for (const t of tasksInCat) {
      if (!t.completed || !t.completedAt || !t.dueDate) continue;
      if (t.completedAt < windowStart) continue;
      onTimeCounted += 1;
      if (t.completedAt <= t.dueDate) onTimeWins += 1;
    }

    // Sparkline: 14 daily counts
    const sparkBuckets = new Map<string, number>();
    for (const d of completionTimes) {
      if (d < sparklineStart) continue;
      const k = localDateKey(d, tz);
      sparkBuckets.set(k, (sparkBuckets.get(k) ?? 0) + 1);
    }
    const sparkline: number[] = [];
    for (let i = sparklineDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * DAY_MS);
      sparkline.push(sparkBuckets.get(localDateKey(d, tz)) ?? 0);
    }

    return {
      id: c.id,
      name: c.name,
      color: c.color,
      weight: c.weight,
      completedInWindow: completionTimes.length,
      activeTaskCount: active.length,
      staleTaskCount: stale.length,
      medianLeadTimeHours: medianLT,
      onTimeRate: onTimeCounted ? onTimeWins / onTimeCounted : null,
      sparkline,
    };
  });

  // === Goal pace ===
  const taskCompleteMap = new Map(tasks.map((t) => [t.id, t.completed]));
  const goalCompletionByGoal = new Map<string, { total: number; complete: number }>();
  for (const gt of goalTasks) {
    const b = goalCompletionByGoal.get(gt.goalId) ?? { total: 0, complete: 0 };
    b.total += 1;
    if (taskCompleteMap.get(gt.taskId)) b.complete += 1;
    goalCompletionByGoal.set(gt.goalId, b);
  }
  const goalsOut = goals.map((g) => {
    const tasksAgg = goalCompletionByGoal.get(g.id) ?? { total: 0, complete: 0 };
    // Use linked-task ratio if available; otherwise fall back to g.progress.
    const ratio = tasksAgg.total > 0 ? tasksAgg.complete / tasksAgg.total : g.progress;
    let paceState: 'no-target' | 'on-pace' | 'ahead' | 'behind' | 'overdue' | 'done' =
      'no-target';
    let pctTimeElapsed: number | null = null;
    let paceDeltaDays: number | null = null;
    if (g.completed) {
      paceState = 'done';
    } else if (g.targetDate) {
      const total = g.targetDate.getTime() - g.createdAt.getTime();
      const elapsed = now.getTime() - g.createdAt.getTime();
      pctTimeElapsed = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 1;
      if (now > g.targetDate) {
        paceState = 'overdue';
      } else if (ratio >= pctTimeElapsed + 0.05) {
        paceState = 'ahead';
      } else if (ratio < pctTimeElapsed - 0.05) {
        paceState = 'behind';
      } else {
        paceState = 'on-pace';
      }
      // Translate progress gap to days
      if (total > 0) {
        paceDeltaDays = Math.round(((ratio - pctTimeElapsed) * total) / DAY_MS);
      }
    }
    return {
      id: g.id,
      title: g.title,
      primaryCategoryId: g.primaryCategoryId,
      weight: g.weight,
      progress: ratio,
      completed: g.completed,
      targetDate: g.targetDate?.toISOString() ?? null,
      paceState,
      pctTimeElapsed,
      paceDeltaDays,
      linkedTaskTotal: tasksAgg.total,
      linkedTaskComplete: tasksAgg.complete,
    };
  });

  // === 53-week streak grid ===
  const gridDays = 53 * 7; // 371
  const dateKeyToCounts = new Map<string, { count: number; byCategory: Record<string, number> }>();
  for (const h of historyAll) {
    const t = taskById.get(h.taskId);
    if (!t) continue;
    const k = localDateKey(h.completedAt, tz);
    const bucket = dateKeyToCounts.get(k) ?? { count: 0, byCategory: {} };
    bucket.count += 1;
    const catId = t.categoryId ?? '__uncategorized__';
    bucket.byCategory[catId] = (bucket.byCategory[catId] ?? 0) + 1;
    dateKeyToCounts.set(k, bucket);
  }
  // Sweep last 371 days, oldest first.
  const streakGrid: DashboardMetrics['streakGrid'] = [];
  for (let i = gridDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const k = localDateKey(d, tz);
    const b = dateKeyToCounts.get(k) ?? { count: 0, byCategory: {} };
    streakGrid.push({ date: k, count: b.count, byCategory: b.byCategory });
  }

  // === Time-of-day / day-of-week (only within current window) ===
  const todBuckets = new Array(24).fill(0);
  const dowBuckets = new Array(7).fill(0);
  for (const h of historyCurrent) {
    todBuckets[localHour(h.completedAt, tz)] += 1;
    dowBuckets[localDayOfWeek(h.completedAt, tz)] += 1;
  }

  // === Day ratings: series + correlation ===
  const todayKey = localDateKey(now, tz);
  const ratingByDate = new Map<string, { rating: number; note: string | null }>();
  for (const r of dayRatingRows) {
    ratingByDate.set(r.dateKey, { rating: r.rating, note: r.note });
  }

  // Series: last 30 days, oldest first, only rated days
  const last30Series: Array<{ date: string; rating: number; note: string | null }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const k = localDateKey(d, tz);
    const r = ratingByDate.get(k);
    if (r) last30Series.push({ date: k, rating: r.rating, note: r.note });
  }

  const ratedKeysAll = [...ratingByDate.keys()];
  const allRatingValues = ratedKeysAll
    .map((k) => ratingByDate.get(k)?.rating)
    .filter((v): v is number => typeof v === 'number');
  const averageRating = allRatingValues.length
    ? allRatingValues.reduce((s, v) => s + v, 0) / allRatingValues.length
    : null;

  // Correlation: completions on high-rated (4-5) vs low-rated (1-2) days.
  // Build dateKey → completions array
  const completionsByDate = new Map<string, { total: number; byCat: Map<string, number> }>();
  for (const h of historyAll) {
    const t = taskById.get(h.taskId);
    if (!t) continue;
    const k = localDateKey(h.completedAt, tz);
    const b = completionsByDate.get(k) ?? { total: 0, byCat: new Map() };
    b.total += 1;
    const catId = t.categoryId ?? '__uncategorized__';
    b.byCat.set(catId, (b.byCat.get(catId) ?? 0) + 1);
    completionsByDate.set(k, b);
  }
  const highDayCompletions: number[] = [];
  const lowDayCompletions: number[] = [];
  const highDayByCat = new Map<string, number>();
  const lowDayByCat = new Map<string, number>();
  for (const [date, info] of ratingByDate) {
    const c = completionsByDate.get(date);
    const completions = c?.total ?? 0;
    if (info.rating >= 4) {
      highDayCompletions.push(completions);
      if (c) for (const [cat, n] of c.byCat) highDayByCat.set(cat, (highDayByCat.get(cat) ?? 0) + n);
    } else if (info.rating <= 2) {
      lowDayCompletions.push(completions);
      if (c) for (const [cat, n] of c.byCat) lowDayByCat.set(cat, (lowDayByCat.get(cat) ?? 0) + n);
    }
  }
  const avgHigh = highDayCompletions.length
    ? highDayCompletions.reduce((s, v) => s + v, 0) / highDayCompletions.length
    : null;
  const avgLow = lowDayCompletions.length
    ? lowDayCompletions.reduce((s, v) => s + v, 0) / lowDayCompletions.length
    : null;

  // Strongest category effect: compare share-of-day-completions between
  // high-rated and low-rated days. Need both buckets to have data.
  let strongestCategoryName: string | null = null;
  let strongestCategoryEffect: number | null = null;
  const highTotal = [...highDayByCat.values()].reduce((s, v) => s + v, 0);
  const lowTotal = [...lowDayByCat.values()].reduce((s, v) => s + v, 0);
  if (highTotal >= 3 && lowTotal >= 3) {
    let bestDelta = 0;
    let bestCatId: string | null = null;
    const cats = new Set([...highDayByCat.keys(), ...lowDayByCat.keys()]);
    for (const cat of cats) {
      const hShare = (highDayByCat.get(cat) ?? 0) / highTotal;
      const lShare = (lowDayByCat.get(cat) ?? 0) / lowTotal;
      const delta = hShare - lShare;
      if (Math.abs(delta) > Math.abs(bestDelta)) {
        bestDelta = delta;
        bestCatId = cat;
      }
    }
    if (bestCatId && Math.abs(bestDelta) >= 0.1) {
      const name =
        bestCatId === '__uncategorized__'
          ? 'Uncategorized'
          : categories.find((c) => c.id === bestCatId)?.name ?? bestCatId;
      strongestCategoryName = name;
      strongestCategoryEffect = bestDelta;
    }
  }

  return {
    windowDays,
    generatedAt: now.toISOString(),
    timezone: tz,
    kpis: {
      tasksCompleted: { current: tasksCompletedCurrent, prior: tasksCompletedPrior },
      goalMomentum: { current: goalMomentumCurrent, prior: goalMomentumPrior },
      approvalRate: { current: approvalRateCurrent, prior: approvalRatePrior },
      procrastinationIndex: { current: procCurrent, prior: procPrior },
    },
    categories: cats,
    goals: goalsOut,
    approvalByKind,
    streakGrid,
    timeOfDay: todBuckets,
    dayOfWeek: dowBuckets,
    dayRatings: {
      average: averageRating,
      count: allRatingValues.length,
      today: todayKey,
      todaysRating: ratingByDate.get(todayKey)?.rating ?? null,
      series: last30Series,
      correlation: {
        highDayAvgCompletions: avgHigh,
        lowDayAvgCompletions: avgLow,
        strongestCategoryName,
        strongestCategoryEffect,
      },
    },
    growthFeed: await buildGrowthFeed(userId, tz),
    finance: await buildFinanceSnapshot(userId),
  };
}

// ─── Growth feed ───────────────────────────────────────────────────────────
// Auto-generated milestone entries from existing data. Top ~15 across last
// 90 days, newest first. Sources:
//   - Goal completions (goal.completed=true, completedAt within 90d)
//   - Project status flips to COMPLETE
//   - Goals 50%/75% milestones (using current progress + a heuristic from
//     linked-task completion order)
//   - Multi-day streaks (5+ consecutive days with task completions, in any
//     category — checked against the user's local-tz date keys)

interface GrowthFeedEntry {
  date: string; // YYYY-MM-DD in user tz
  kind: 'goal-complete' | 'project-complete' | 'goal-milestone' | 'streak' | 'sheet-update';
  title: string;
  detail: string;
  // Optional refs
  goalId?: string;
  projectId?: string;
  categoryId?: string;
}

async function buildGrowthFeed(userId: string, tz: string): Promise<GrowthFeedEntry[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 90 * DAY_MS);
  const entries: GrowthFeedEntry[] = [];

  const [completedGoals, completedProjects, history] = await Promise.all([
    prisma.goal.findMany({
      where: {
        userId,
        completed: true,
        completedAt: { gte: cutoff },
      },
      select: {
        id: true,
        title: true,
        completedAt: true,
        primaryCategoryId: true,
      },
    }),
    prisma.project.findMany({
      where: {
        userId,
        status: 'COMPLETE',
        updatedAt: { gte: cutoff },
      },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        primaryCategoryId: true,
      },
    }),
    prisma.taskHistory.findMany({
      where: { userId, completedAt: { gte: cutoff } },
      select: { completedAt: true, taskId: true },
      orderBy: { completedAt: 'asc' },
    }),
  ]);

  for (const g of completedGoals) {
    if (!g.completedAt) continue;
    entries.push({
      date: localDateKey(g.completedAt, tz),
      kind: 'goal-complete',
      title: `Goal complete: ${g.title}`,
      detail: 'Closed out.',
      goalId: g.id,
      categoryId: g.primaryCategoryId ?? undefined,
    });
  }
  for (const p of completedProjects) {
    entries.push({
      date: localDateKey(p.updatedAt, tz),
      kind: 'project-complete',
      title: `Project complete: ${p.title}`,
      detail: 'Marked complete.',
      projectId: p.id,
      categoryId: p.primaryCategoryId ?? undefined,
    });
  }

  // Detect streaks of 5+ consecutive days with at least one completion.
  const daysWithCompletions = new Set(
    history.map((h) => localDateKey(h.completedAt, tz))
  );
  const sortedDays = [...daysWithCompletions].sort();
  let runStart: string | null = null;
  let runLen = 0;
  let prevDate: Date | null = null;
  function flushRun(endDate: string) {
    if (runLen >= 5 && runStart) {
      entries.push({
        date: endDate,
        kind: 'streak',
        title: `${runLen}-day streak`,
        detail: `Completed something every day from ${runStart} to ${endDate}.`,
      });
    }
    runStart = null;
    runLen = 0;
  }
  for (const d of sortedDays) {
    const cur = new Date(d + 'T12:00:00Z');
    if (prevDate) {
      const gapDays = Math.round((cur.getTime() - prevDate.getTime()) / DAY_MS);
      if (gapDays === 1) {
        runLen += 1;
      } else {
        if (prevDate) flushRun(localDateKey(prevDate, tz));
        runStart = d;
        runLen = 1;
      }
    } else {
      runStart = d;
      runLen = 1;
    }
    prevDate = cur;
  }
  if (prevDate) flushRun(localDateKey(prevDate, tz));

  // Sort newest-first by date, cap at 15
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries.slice(0, 15);
}

// ─── Finance snapshot ──────────────────────────────────────────────────────
// Looks for any enabled SheetSource whose category/label suggests finance,
// pulls out total debt and a delta from the prior month. Best-effort — depends
// on user's sheet structure.

interface FinanceSnapshot {
  available: boolean;
  totalDebt: number | null;
  totalCurrentValue: number | null; // collection (curator) if available
  monthlyDebtPayments: number | null;
  lastSyncedAt: string | null;
  sourceLabel: string | null;
  note: string | null; // "Detected from <source>" or why unavailable
}

async function buildFinanceSnapshot(userId: string): Promise<FinanceSnapshot> {
  // 1. Try a sheet whose label contains "finance" or "debt"
  const sheets = await prisma.sheetSource.findMany({
    where: { userId, enabled: true },
    select: { id: true, label: true, snapshot: true, lastSyncedAt: true },
  });

  let bestFinanceSheet: typeof sheets[number] | null = null;
  for (const s of sheets) {
    if (/finance|debt|money/i.test(s.label) && s.snapshot) {
      bestFinanceSheet = s;
      break;
    }
  }

  let totalDebt: number | null = null;
  let monthlyDebtPayments: number | null = null;
  let sheetLabel: string | null = null;
  let lastSync: string | null = null;

  if (bestFinanceSheet?.snapshot) {
    sheetLabel = bestFinanceSheet.label;
    lastSync = bestFinanceSheet.lastSyncedAt?.toISOString() ?? null;
    const snap = bestFinanceSheet.snapshot as {
      rows?: Array<Array<string | number | null>>;
    };
    const rows = snap.rows ?? [];
    // Scan for cells containing "Debt Totals" / "Total Monthly CC Payments" /
    // similar labels; the value is one column to the right (or one of the
    // adjacent cells with a $-prefixed number).
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (typeof cell !== 'string') continue;
        const lc = cell.toLowerCase();
        if (lc.includes('debt total')) {
          for (let j = i + 1; j < row.length; j++) {
            const n = parseDollar(row[j]);
            if (n != null) {
              totalDebt = n;
              break;
            }
          }
        } else if (lc.includes('total monthly cc') || lc.includes('monthly cc payment')) {
          for (let j = i + 1; j < row.length; j++) {
            const n = parseDollar(row[j]);
            if (n != null) {
              monthlyDebtPayments = n;
              break;
            }
          }
        }
      }
    }
  }

  // 2. Curator collection current value, if a stats DataSource exists
  let totalCurrentValue: number | null = null;
  const dataSources = await prisma.dataSource.findMany({
    where: { userId, enabled: true },
    select: { id: true, label: true, snapshot: true },
  });
  for (const ds of dataSources) {
    if (!/stats|curator/i.test(ds.label) || !ds.snapshot) continue;
    const snap = ds.snapshot as { data?: unknown };
    const data = snap.data as Record<string, unknown> | undefined;
    if (data && typeof data === 'object') {
      const v = data.totalCurrentValue;
      if (typeof v === 'number') {
        totalCurrentValue = v;
        break;
      }
    }
  }

  const available = totalDebt !== null || totalCurrentValue !== null;
  return {
    available,
    totalDebt,
    totalCurrentValue,
    monthlyDebtPayments,
    lastSyncedAt: lastSync,
    sourceLabel: sheetLabel,
    note: available
      ? null
      : 'No finance sheet detected. Add one in Settings → Google Sheets sources.',
  };
}

function parseDollar(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
