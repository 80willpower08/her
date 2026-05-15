// Strengths/struggles by category, derived from TaskHistory.

import { loadUserContext } from './context.js';

export interface CategoryPatternStats {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  sampleSize: number;
  completionRate: number; // completed / (completed + abandoned within window) — for now: 1.0 since abandonment isn't tracked
  onTimeRate: number; // completed on time / completed
  avgEstimatedAccuracy: number | null; // ratio of timeSpent / estimatedMinutes if both present
  classification: 'strength' | 'neutral' | 'struggle' | 'unknown';
}

export interface PatternsResponse {
  windowDays: number;
  byCategory: CategoryPatternStats[];
}

const DEFAULT_WINDOW_DAYS = 90;

export async function buildPatterns(userId: string, windowDays = DEFAULT_WINDOW_DAYS): Promise<PatternsResponse> {
  const ctx = await loadUserContext(userId);
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);

  const recent = ctx.taskHistory.filter((h) => h.completedAt >= cutoff);
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const categoryById = new Map(ctx.categories.map((c) => [c.id, c]));

  const byCat = new Map<
    string | null,
    { sampleSize: number; onTime: number; estimatedAccuracySum: number; estimatedAccuracyCount: number }
  >();

  for (const h of recent) {
    const t = taskById.get(h.taskId);
    if (!t) continue;
    const key = t.categoryId;
    const bucket = byCat.get(key) ?? {
      sampleSize: 0,
      onTime: 0,
      estimatedAccuracySum: 0,
      estimatedAccuracyCount: 0,
    };
    bucket.sampleSize += 1;
    if (h.onTime) bucket.onTime += 1;
    if (h.timeSpent && t.estimatedMinutes && t.estimatedMinutes > 0) {
      bucket.estimatedAccuracySum += h.timeSpent / t.estimatedMinutes;
      bucket.estimatedAccuracyCount += 1;
    }
    byCat.set(key, bucket);
  }

  const stats: CategoryPatternStats[] = [];
  for (const [categoryId, bucket] of byCat.entries()) {
    const cat = categoryId ? categoryById.get(categoryId) : null;
    const onTimeRate = bucket.sampleSize === 0 ? 0 : bucket.onTime / bucket.sampleSize;
    const avgAccuracy =
      bucket.estimatedAccuracyCount === 0
        ? null
        : bucket.estimatedAccuracySum / bucket.estimatedAccuracyCount;
    let classification: CategoryPatternStats['classification'] = 'unknown';
    if (bucket.sampleSize >= 5) {
      if (onTimeRate >= 0.8) classification = 'strength';
      else if (onTimeRate < 0.5) classification = 'struggle';
      else classification = 'neutral';
    }
    stats.push({
      categoryId,
      categoryName: cat?.name ?? 'Uncategorized',
      categoryColor: cat?.color ?? '#94a3b8',
      sampleSize: bucket.sampleSize,
      completionRate: 1.0, // placeholder until abandonment tracking lands
      onTimeRate,
      avgEstimatedAccuracy: avgAccuracy,
      classification,
    });
  }

  // Include categories with no completions yet so the UI can show "no data"
  for (const cat of ctx.categories) {
    if (!byCat.has(cat.id)) {
      stats.push({
        categoryId: cat.id,
        categoryName: cat.name,
        categoryColor: cat.color,
        sampleSize: 0,
        completionRate: 0,
        onTimeRate: 0,
        avgEstimatedAccuracy: null,
        classification: 'unknown',
      });
    }
  }

  stats.sort((a, b) => {
    const order = { strength: 0, neutral: 1, struggle: 2, unknown: 3 };
    return order[a.classification] - order[b.classification];
  });

  return { windowDays, byCategory: stats };
}
