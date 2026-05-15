import type { Category } from '@prisma/client';
import { prisma } from '../prisma.js';
import { loadUserContext, type UserContext } from './context.js';
import { categoryProgress } from './progress.js';

export type CategoryWithProgress = Category & {
  progress: number;
};

export function decorateCategories(categories: Category[], ctx: UserContext): CategoryWithProgress[] {
  return categories.map((c) => ({
    ...c,
    progress: categoryProgress(c.id, {
      tasks: ctx.tasks,
      goals: ctx.goals,
      goalTasks: ctx.goalTasks,
      goalCategories: ctx.goalCategories,
    }),
  }));
}

export async function listCategories(userId: string): Promise<CategoryWithProgress[]> {
  const ctx = await loadUserContext(userId);
  return decorateCategories(ctx.categories, ctx);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function createCategory(
  userId: string,
  input: { name: string; color?: string; icon?: string | null; weight?: number }
): Promise<CategoryWithProgress> {
  const baseSlug = slugify(input.name) || 'category';
  // Ensure slug uniqueness within this user
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.category.findUnique({ where: { userId_slug: { userId, slug } } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
  const maxOrder = await prisma.category.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });
  const created = await prisma.category.create({
    data: {
      userId,
      slug,
      name: input.name,
      color: input.color ?? '#64748b',
      icon: input.icon ?? null,
      weight: input.weight ?? 5,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      isDefault: false,
    },
  });
  const ctx = await loadUserContext(userId);
  const [decorated] = decorateCategories([created], ctx);
  return decorated;
}

export async function updateCategory(
  userId: string,
  id: string,
  patch: Partial<{
    name: string;
    color: string;
    icon: string | null;
    weight: number;
    sortOrder: number;
    archived: boolean;
  }>
): Promise<CategoryWithProgress | null> {
  const existing = await prisma.category.findFirst({ where: { id, userId } });
  if (!existing) return null;
  if (patch.weight !== undefined) {
    if (patch.weight < 1 || patch.weight > 10) throw new Error('weight must be 1..10');
  }
  const updated = await prisma.category.update({
    where: { id },
    data: {
      name: patch.name,
      color: patch.color,
      icon: patch.icon,
      weight: patch.weight,
      sortOrder: patch.sortOrder,
      archived: patch.archived,
    },
  });
  const ctx = await loadUserContext(userId);
  const [decorated] = decorateCategories([updated], ctx);
  return decorated;
}
