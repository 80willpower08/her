import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Lock, Target } from 'lucide-react';
import { format } from 'date-fns';
import type { OverviewCategoryNode, OverviewGoalNode, OverviewTaskNode } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function OverviewPage() {
  const overviewQ = useQuery({ queryKey: ['overview'], queryFn: () => api.overview() });

  if (overviewQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading overview…</p>;
  }
  const overview = overviewQ.data;
  if (!overview) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-3xl">Overview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Categories → goals → tasks, with progress at every level.
        </p>
      </div>

      <div className="space-y-3">
        {overview.categories.map((cat) => (
          <CategoryNode key={cat.category.id} node={cat} />
        ))}
        {(overview.uncategorized.goals.length > 0 ||
          overview.uncategorized.looseTasks.length > 0) && (
          <UncategorizedSection
            goals={overview.uncategorized.goals}
            looseTasks={overview.uncategorized.looseTasks}
          />
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 rounded-full bg-secondary overflow-hidden', className)}>
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
  );
}

function CategoryNode({ node }: { node: OverviewCategoryNode }) {
  const [open, setOpen] = useState(true);
  const c = node.category;
  const hasContent =
    node.primaryGoals.length + node.secondaryGoals.length + node.looseTasks.length > 0;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left"
        disabled={!hasContent}
      >
        {hasContent ? (
          open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{c.name}</span>
            <Badge variant="outline" className="text-[10px]">w {c.weight}</Badge>
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {(c.progress * 100).toFixed(0)}%
            </span>
          </div>
          <ProgressBar value={c.progress} className="mt-1.5" />
        </div>
      </button>
      {open && hasContent && (
        <div className="border-t px-3 py-3 space-y-3">
          {node.primaryGoals.map((g) => (
            <GoalNode key={`p-${g.id}`} goal={g} />
          ))}
          {node.secondaryGoals.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Also helps this category
              </div>
              {node.secondaryGoals.map((g) => (
                <GoalNode key={`s-${g.id}`} goal={g} />
              ))}
            </div>
          )}
          {node.looseTasks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Loose tasks
              </div>
              {node.looseTasks.map((t) => (
                <TaskNode key={t.id} task={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoalNode({ goal }: { goal: OverviewGoalNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border bg-secondary/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {goal.tasks.length > 0 ? (
          open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : <span className="w-3.5" />}
        <Target className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{goal.title}</span>
            <Badge variant="outline" className="text-[10px]">w {goal.weight}</Badge>
            {goal.isSecondary && (
              <Badge variant="outline" className="text-[10px] bg-background/60">
                {goal.contributionPercentage}% to this category
              </Badge>
            )}
            {goal.targetDate && (
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(goal.targetDate), 'MMM d')}
              </span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {(goal.progress * 100).toFixed(0)}%
            </span>
          </div>
          <ProgressBar value={goal.progress} className="mt-1" />
        </div>
      </button>
      {open && goal.tasks.length > 0 && (
        <div className="px-3 pb-3 pt-0 space-y-1.5 border-t">
          {goal.tasks.map((t) => (
            <TaskNode key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskNode({ task, depth = 0 }: { task: OverviewTaskNode; depth?: number }) {
  return (
    <div className="space-y-1" style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-2 rounded-md bg-background/50 border px-2 py-1.5">
        <span className="text-xs">{task.completed ? '✓' : '○'}</span>
        <span
          className={cn(
            'text-sm flex-1',
            task.completed && 'line-through text-muted-foreground'
          )}
        >
          {task.title}
        </span>
        {task.isBlocked && !task.completed && (
          <Lock className="h-3 w-3 text-muted-foreground" />
        )}
        {!task.completed && task.derivedPriority !== 'LOW' && task.derivedPriority !== 'MEDIUM' && (
          <Badge variant="default" className="text-[10px]">
            {task.derivedPriority}
          </Badge>
        )}
        {task.subtasks.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {(task.progress * 100).toFixed(0)}%
          </span>
        )}
      </div>
      {task.subtasks.map((s) => (
        <TaskNode key={s.id} task={s} depth={depth + 1} />
      ))}
    </div>
  );
}

function UncategorizedSection({
  goals,
  looseTasks,
}: {
  goals: OverviewGoalNode[];
  looseTasks: OverviewTaskNode[];
}) {
  return (
    <div className="rounded-lg border border-dashed bg-card/50 p-3">
      <div className="text-xs text-muted-foreground mb-2">Uncategorized</div>
      <div className="space-y-2">
        {goals.map((g) => (
          <GoalNode key={g.id} goal={g} />
        ))}
        {looseTasks.map((t) => (
          <TaskNode key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}
