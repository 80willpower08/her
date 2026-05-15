import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, AlertCircle, Calendar } from 'lucide-react';
import { format, isPast, isToday, isTomorrow } from 'date-fns';
import type { Category, DerivedPriority, Task } from '@time-keeper/shared';
import { api, ApiError } from '@/lib/api';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PRIORITY_VARIANT: Record<DerivedPriority, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  LOW: 'outline',
  MEDIUM: 'secondary',
  HIGH: 'default',
  CRITICAL: 'destructive',
};

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return `Today, ${format(d, 'p')}`;
  if (isTomorrow(d)) return `Tomorrow, ${format(d, 'p')}`;
  return format(d, 'MMM d, p');
}

interface TaskCardProps {
  task: Task;
  category?: Category;
  /** All tasks (used for subtask progress display). Optional — falls back to task.subtaskIds. */
  allTasks?: Task[];
  onClick: () => void;
}

export function TaskCard({ task, category, allTasks, onClick }: TaskCardProps) {
  const queryClient = useQueryClient();

  const completeMutation = useMutation({
    mutationFn: () =>
      task.completed ? api.tasks.uncomplete(task.id) : api.tasks.complete(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        alert(err.message);
      }
    },
  });

  const overdue =
    task.dueDate &&
    isPast(new Date(task.dueDate)) &&
    !isToday(new Date(task.dueDate)) &&
    !task.completed;

  const subtasks = allTasks ? allTasks.filter((t) => task.subtaskIds.includes(t.id)) : [];
  const completedSubtasks = subtasks.filter((t) => t.completed).length;
  const hasSubtasks = task.subtaskIds.length > 0;
  const progressPct = Math.round(task.progress * 100);

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors cursor-pointer',
        !task.completed && 'hover:border-primary/40',
        task.completed && 'opacity-50',
        task.isBlocked && !task.completed && 'opacity-70 border-dashed'
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
        <Checkbox
          checked={task.completed}
          onCheckedChange={() => completeMutation.mutate()}
          disabled={task.isBlocked && !task.completed}
          aria-label={task.completed ? 'Mark incomplete' : 'Complete task'}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-medium leading-snug',
              task.completed && 'line-through text-muted-foreground'
            )}
          >
            {task.title}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {task.isBlocked && !task.completed && (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Blocked" />
            )}
            {overdue && (
              <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-label="Overdue" />
            )}
          </div>
        </div>

        {hasSubtasks && !task.completed && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary/70 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
              {completedSubtasks}/{subtasks.length}
            </span>
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {category && (
            <Badge variant="outline" className="gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: category.color }} />
              {category.name}
            </Badge>
          )}
          {!task.completed && task.derivedPriority !== 'MEDIUM' && task.derivedPriority !== 'LOW' && (
            <Badge variant={PRIORITY_VARIANT[task.derivedPriority]} className="text-[10px] uppercase">
              {task.derivedPriority}
            </Badge>
          )}
          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                overdue ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              <Calendar className="h-3 w-3" />
              {formatDue(task.dueDate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
