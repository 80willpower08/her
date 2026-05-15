import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import type { Category, Task } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { TaskCard } from '@/components/TaskCard';
import { TaskDetail } from '@/components/TaskDetail';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { Button } from '@/components/ui/button';

const UNCATEGORIZED: Category = {
  id: '__uncategorized__',
  userId: '',
  slug: 'uncategorized',
  name: 'Uncategorized',
  color: '#94a3b8',
  icon: null,
  sortOrder: 999,
  weight: 5,
  isDefault: false,
  archived: false,
  createdAt: '',
  updatedAt: '',
  progress: 0,
};

export function ListPage() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false);

  const allQ = useQuery({
    queryKey: ['tasks', { view: 'all' }],
    queryFn: () => api.tasks.list({ view: 'all' }),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
  });

  const categories = categoriesQ.data?.categories ?? [];
  const allTasks = allQ.data?.tasks ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!showCompleted && t.completed) continue;
      const key = t.categoryId ?? UNCATEGORIZED.id;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [allTasks, showCompleted]);

  const orderedCategories = [...categories, UNCATEGORIZED].filter((c) => grouped.has(c.id));

  const selectedTask = selectedTaskId
    ? allTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl">All tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Grouped by category.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCompleted((v) => !v)}
            className="text-muted-foreground"
          >
            {showCompleted ? 'Hide completed' : 'Show completed'}
          </Button>
          <CreateTaskDialog categories={categories} />
        </div>
      </div>

      {allTasks.length === 0 && !allQ.isLoading && (
        <div className="rounded-lg border border-dashed bg-card/50 p-8 text-center">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No tasks yet. Create one to get started.</p>
        </div>
      )}

      <div className="space-y-4">
        {orderedCategories.map((cat) => {
          const tasks = grouped.get(cat.id) ?? [];
          const isCollapsed = collapsed.has(cat.id);
          return (
            <section key={cat.id} className="space-y-2">
              <button
                type="button"
                onClick={() => toggle(cat.id)}
                className="w-full flex items-center gap-2 text-left group"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: cat.color }} />
                <h2 className="text-sm font-medium">{cat.name}</h2>
                <span className="text-xs text-muted-foreground">({tasks.length})</span>
              </button>
              {!isCollapsed && (
                <div className="space-y-1.5 pl-6">
                  {tasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      category={cat.id !== UNCATEGORIZED.id ? cat : undefined}
                      allTasks={allTasks}
                      onClick={() => setSelectedTaskId(t.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          allTasks={allTasks}
          categories={categories}
          open={Boolean(selectedTaskId)}
          onOpenChange={(open) => !open && setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
