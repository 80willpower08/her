import { prisma } from '../prisma.js';

const DEFAULT_CATEGORIES = [
  { slug: 'personal-growth', name: 'Personal Growth', color: '#6366f1', icon: 'book-open', sortOrder: 0 },
  { slug: 'health',          name: 'Health',          color: '#10b981', icon: 'heart',     sortOrder: 1 },
  { slug: 'work',            name: 'Work',            color: '#0ea5e9', icon: 'briefcase', sortOrder: 2 },
  { slug: 'home',            name: 'Home',            color: '#f59e0b', icon: 'home',      sortOrder: 3 },
  { slug: 'finance',         name: 'Finance',         color: '#8b5cf6', icon: 'wallet',    sortOrder: 4 },
  { slug: 'social',          name: 'Social',          color: '#f43f5e', icon: 'users',     sortOrder: 5 },
];

export async function seedDefaultCategories(userId: string): Promise<void> {
  const existing = await prisma.category.count({ where: { userId } });
  if (existing > 0) return;

  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId, isDefault: true })),
  });
}
