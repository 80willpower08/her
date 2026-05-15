import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target, X, Plus, Trash2, Pencil, Lock, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import type { Category, Goal, Task } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { CreateGoalDialog } from '@/components/CreateGoalDialog';
import { EditGoalDialog } from '@/components/EditGoalDialog';
import { ChatPanel } from '@/components/ChatPanel';

export function GoalsPage() {
  const goalsQ = useQuery({ queryKey: ['goals'], queryFn: () => api.goals.list() });
  const tasksQ = useQuery({
    queryKey: ['tasks', { view: 'all' }],
    queryFn: () => api.tasks.list({ view: 'all' }),
  });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });

  const categories = categoriesQ.data?.categories ?? [];
  const goals = goalsQ.data?.goals ?? [];
  const allTasks = tasksQ.data?.tasks ?? [];

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl">Goals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {goals.length === 0 ? 'No goals yet.' : `${goals.length} active`}
          </p>
        </div>
        <CreateGoalDialog categories={categories} />
      </div>

      {goals.length === 0 && !goalsQ.isLoading && (
        <div className="rounded-lg border border-dashed bg-card/50 p-8 text-center">
          <Target className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Goals group tasks toward a longer-term outcome. Create one to start linking tasks.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {goals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            allTasks={allTasks}
            allGoals={goals}
            categories={categories}
            categoryById={categoryById}
          />
        ))}
      </div>
    </div>
  );
}

interface GoalCardProps {
  goal: Goal;
  allTasks: Task[];
  allGoals: Goal[];
  categories: Category[];
  categoryById: Map<string, Category>;
}

function GoalCard({ goal, allTasks, allGoals, categories, categoryById }: GoalCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const primary = goal.primaryCategoryId ? categoryById.get(goal.primaryCategoryId) : undefined;
  const secondaries = goal.categoryMappings
    .filter((m) => !m.isPrimary)
    .map((m) => ({
      mapping: m,
      category: categoryById.get(m.categoryId),
    }))
    .filter((x): x is { mapping: typeof x.mapping; category: Category } => Boolean(x.category));

  const linked = allTasks.filter((t) => goal.linkedTaskIds.includes(t.id));
  const candidates = allTasks.filter(
    (t) => !goal.linkedTaskIds.includes(t.id) && !t.completed && t.parentId === null
  );

  const linkMutation = useMutation({
    mutationFn: (taskId: string) => api.goals.linkTask(goal.id, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (taskId: string) => api.goals.unlinkTask(goal.id, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.goals.delete(goal.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{goal.title}</CardTitle>
            {goal.description && (
              <CardDescription className="mt-1 line-clamp-2">{goal.description}</CardDescription>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {primary && (
                <Badge variant="outline" className="gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: primary.color }} />
                  {primary.name}
                </Badge>
              )}
              {secondaries.map(({ mapping, category }) => (
                <Badge key={mapping.categoryId} variant="outline" className="gap-1.5 opacity-70">
                  <span className="h-2 w-2 rounded-full" style={{ background: category.color }} />
                  {category.name}
                  <span className="text-[10px] tabular-nums">·{mapping.percentage}%</span>
                </Badge>
              ))}
              <Badge variant="secondary" className="text-[10px]">w {goal.weight}</Badge>
              {goal.isBlocked && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Lock className="h-3 w-3" /> Blocked
                </Badge>
              )}
              {goal.targetDate && (
                <span className="text-xs text-muted-foreground">
                  Target: {format(new Date(goal.targetDate), 'MMM d, yyyy')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-start gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setChatOpen(true)}
              title="Discuss with agent"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirm(`Delete goal "${goal.title}"?`)) deleteMutation.mutate();
              }}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {goal.completedTasks} of {goal.totalTasks} tasks
            </span>
            <span className="font-medium">{(goal.weightedProgress * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, goal.weightedProgress * 100)}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? 'Hide' : 'Show'} linked tasks
        </button>

        {expanded && (
          <div className="space-y-2">
            {linked.length > 0 && (
              <ul className="space-y-1">
                {linked.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-md border bg-secondary/30 px-3 py-1.5"
                  >
                    <span className="text-sm flex items-center gap-2">
                      <span>{t.completed ? '✓' : '○'}</span>
                      <span className={t.completed ? 'line-through text-muted-foreground' : ''}>
                        {t.title}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => unlinkMutation.mutate(t.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {candidates.length > 0 ? (
              <Select onValueChange={(taskId) => linkMutation.mutate(taskId)} value="">
                <SelectTrigger className="text-muted-foreground">
                  <span className="inline-flex items-center gap-2 text-sm">
                    <Plus className="h-3.5 w-3.5" /> Link a task
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : linked.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Create some tasks first, then link them here.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
      <EditGoalDialog
        goal={goal}
        categories={categories}
        allGoals={allGoals}
        open={editing}
        onOpenChange={setEditing}
      />
      <ChatPanel
        anchorType="goal"
        anchorId={goal.id}
        anchorLabel={goal.title}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </Card>
  );
}
