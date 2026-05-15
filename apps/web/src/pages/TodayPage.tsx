import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, EyeOff, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Task } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { TaskCard } from '@/components/TaskCard';
import { TaskDetail } from '@/components/TaskDetail';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { EventCard } from '@/components/EventCard';

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function TodayPage() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [eventsCollapsed, setEventsCollapsed] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const todayQ = useQuery({
    queryKey: ['tasks', { view: 'today' }],
    queryFn: () => api.tasks.list({ view: 'today' }),
  });
  const allQ = useQuery({
    queryKey: ['tasks', { view: 'all' }],
    queryFn: () => api.tasks.list({ view: 'all' }),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
  });
  const calendarQ = useQuery({
    queryKey: ['calendar', 'today', { showHidden }],
    queryFn: () => api.calendar({ ...todayBounds(), includeHidden: showHidden }),
  });
  const curationQ = useQuery({
    queryKey: ['today-curation'],
    queryFn: () => api.todayCuration.get(),
  });
  const qc = useQueryClient();
  const clearCuration = useMutation({
    mutationFn: () => api.todayCuration.clear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['today-curation'] }),
  });

  const categories = categoriesQ.data?.categories ?? [];
  const allTasks = allQ.data?.tasks ?? [];
  const tasks = todayQ.data?.tasks ?? [];
  const events = calendarQ.data?.events ?? [];
  const accountById = new Map(
    (calendarQ.data?.accounts ?? []).map((a) => [a.id, a])
  );

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const selectedTask = selectedTaskId
    ? allTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  const blockedCount = tasks.filter((t) => t.isBlocked).length;
  const todayLabel = format(new Date(), "EEEE',' MMMM d");
  const curation = curationQ.data?.curation ?? null;
  const pinnedTaskById = new Map(allTasks.map((t) => [t.id, t]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl">Today</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {todayLabel}
            {(tasks.length > 0 || events.length > 0) && (
              <>
                {' · '}
                {events.length > 0 && `${events.length} ${events.length === 1 ? 'event' : 'events'}`}
                {events.length > 0 && tasks.length > 0 && ' · '}
                {tasks.length > 0 && `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
                {blockedCount > 0 && ` · ${blockedCount} blocked`}
              </>
            )}
          </p>
        </div>
        <CreateTaskDialog categories={categories} />
      </div>

      {curation && (curation.headline || curation.pinned.length > 0) ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Agent's focus for today
                  </p>
                  {curation.headline ? (
                    <p className="mt-1 text-sm whitespace-pre-wrap">{curation.headline}</p>
                  ) : null}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (confirm('Clear the agent curation? It will refresh on the next agent run.')) {
                    clearCuration.mutate();
                  }
                }}
                title="Clear curation"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            {curation.pinned.length > 0 ? (
              <ol className="space-y-1.5">
                {curation.pinned.map((pin, i) => {
                  let title = '';
                  if (pin.type === 'task') title = pinnedTaskById.get(pin.id)?.title ?? '(unknown task)';
                  else if (pin.type === 'event') title = eventById.get(pin.id)?.title ?? '(event not in today\'s window)';
                  else title = '(project)';
                  return (
                    <li key={`${pin.type}:${pin.id}:${i}`} className="text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                        <span className="font-medium">{title}</span>
                        <span className="text-[10px] uppercase text-muted-foreground shrink-0">
                          {pin.type}
                        </span>
                      </div>
                      {pin.reason ? (
                        <p className="ml-6 text-xs text-muted-foreground">{pin.reason}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {events.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
              onClick={() => setEventsCollapsed((v) => !v)}
            >
              {eventsCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Events ({events.length})
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? 'Stop showing hidden events' : 'Show hidden events'}
            >
              <EyeOff className="h-3 w-3" />
              {showHidden ? 'Hide hidden' : 'Show hidden'}
            </Button>
          </div>
          {!eventsCollapsed &&
            events.map((ev) => {
              const acc = accountById.get(ev.externalAccountId);
              return (
                <EventCard
                  key={ev.id}
                  event={ev}
                  accountColor={acc?.color}
                  accountLabel={acc?.displayName ?? acc?.accountEmail ?? undefined}
                />
              );
            })}
        </section>
      )}

      {(tasks.length > 0 || events.length > 0) && events.length > 0 && (
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Tasks</h2>
      )}

      {todayQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {tasks.length === 0 && events.length === 0 && !todayQ.isLoading && !calendarQ.isLoading && (
        <div className="rounded-lg border border-dashed bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing scheduled or due today. Add a task — or connect a calendar in Settings.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {tasks.map((t: Task) => (
          <TaskCard
            key={t.id}
            task={t}
            category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
            allTasks={allTasks}
            onClick={() => setSelectedTaskId(t.id)}
          />
        ))}
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
