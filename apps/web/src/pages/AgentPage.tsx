import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Play, Check, X, ChevronDown, ChevronRight, AlertCircle, Sparkles, ArrowRight, MessageSquare } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import type { AgentRun, CalendarEvent, Category, ProposedAction, Task } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChatPanel } from '@/components/ChatPanel';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * Compute the next 8am America/Chicago instant. Approximate — uses Intl to
 * determine the current Chicago wall time and figures out delta to next 08:00.
 * Doesn't try to perfect DST edge cases; close enough for the cadence pill.
 */
function computeNext8amCentral(): Date {
  const now = new Date();
  // Chicago wall time as a string, parsed back to a Date in local-zone-naive form
  const chicagoNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const chicagoTodayAt8 = new Date(chicagoNow);
  chicagoTodayAt8.setHours(8, 0, 0, 0);
  const offsetMs = now.getTime() - chicagoNow.getTime();
  if (chicagoNow.getTime() < chicagoTodayAt8.getTime()) {
    return new Date(chicagoTodayAt8.getTime() + offsetMs);
  }
  const tomorrow = new Date(chicagoTodayAt8);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Date(tomorrow.getTime() + offsetMs);
}

const STATUS_TONE: Record<string, string> = {
  OK: 'text-emerald-600',
  RUNNING: 'text-muted-foreground',
  ERROR: 'text-destructive',
  CANCELLED: 'text-muted-foreground',
  PENDING: 'text-amber-600',
  APPROVED: 'text-emerald-600',
  EXECUTED: 'text-emerald-600',
  DENIED: 'text-muted-foreground',
  FAILED: 'text-destructive',
  EXPIRED: 'text-muted-foreground',
};

export function AgentPage() {
  const queryClient = useQueryClient();
  const runsQ = useQuery({ queryKey: ['agent', 'runs'], queryFn: () => api.agent.runs(10) });
  const pendingQ = useQuery({
    queryKey: ['agent', 'pending'],
    queryFn: () => api.agent.proposedActions('PENDING'),
    refetchInterval: 5000,
  });
  // Lookups so we can show names instead of raw IDs in action previews.
  const tasksQ = useQuery({
    queryKey: ['tasks', { view: 'all' }],
    queryFn: () => api.tasks.list({ view: 'all' }),
  });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const calendarQ = useQuery({
    queryKey: ['calendar', 'agent-window'],
    queryFn: () =>
      api.calendar({
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
  });

  const lookups = useMemo(
    () => ({
      tasks: new Map((tasksQ.data?.tasks ?? []).map((t) => [t.id, t])),
      categories: new Map((categoriesQ.data?.categories ?? []).map((c) => [c.id, c])),
      events: new Map((calendarQ.data?.events ?? []).map((e) => [e.id, e])),
    }),
    [tasksQ.data, categoriesQ.data, calendarQ.data]
  );

  const triggerMutation = useMutation({
    mutationFn: () => api.agent.trigger('PRIORITIZATION'),
    onSuccess: () => {
      // Poll for the new run
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['agent'] });
      }, 3000);
    },
  });

  const runs = runsQ.data?.runs ?? [];
  const pending = pendingQ.data?.actions ?? [];

  // Phase 4.3: show last + next run cadence
  const lastRunAt = runs[0]?.startedAt ? new Date(runs[0].startedAt) : null;
  const nextDailyAt = computeNext8amCentral();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl">Agent</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reads your context, proposes actions. AUTO actions execute themselves; REVIEW and ASK
            wait for your call.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {lastRunAt && (
              <span>
                Last run {formatDistanceToNow(lastRunAt, { addSuffix: true })}
              </span>
            )}
            <span>
              Next daily run{' '}
              {formatDistanceToNow(nextDailyAt, { addSuffix: true })}{' '}
              <span className="opacity-60">
                ({nextDailyAt.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })})
              </span>
            </span>
            <span className="opacity-60">+ on new calendar events (1h debounce)</span>
          </div>
        </div>
        <Button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
          <Play className="h-4 w-4" />
          {triggerMutation.isPending ? 'Queued…' : 'Run now'}
        </Button>
      </div>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-600" />
              {pending.length} pending {pending.length === 1 ? 'review' : 'reviews'}
            </CardTitle>
            <CardDescription>The agent has proposed these. Approve to execute.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((a) => (
              <PendingActionRow key={a.id} action={a} lookups={lookups} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Recent runs</h2>
        {runsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!runsQ.isLoading && runs.length === 0 && (
          <div className="rounded-lg border border-dashed bg-card/50 p-8 text-center">
            <Bot className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No agent runs yet. Click "Run now" to trigger one.</p>
          </div>
        )}
        {runs.map((r) => (
          <AgentRunCard key={r.id} run={r} />
        ))}
      </div>
    </div>
  );
}

interface Lookups {
  tasks: Map<string, Task>;
  categories: Map<string, Category>;
  events: Map<string, CalendarEvent>;
}

function PendingActionRow({ action, lookups }: { action: ProposedAction; lookups: Lookups }) {
  const queryClient = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const approveMutation = useMutation({
    mutationFn: () => api.agent.approve(action.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent'] });
      queryClient.invalidateQueries({ queryKey: ['conversation'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const denyMutation = useMutation({
    mutationFn: () => api.agent.deny(action.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent'] });
    },
  });

  return (
    <div className="rounded-md border bg-secondary/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {action.kind.toLowerCase().replace(/_/g, ' ')}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">{action.mode}</Badge>
          </div>
          <p className="text-sm">{action.rationale}</p>
          <ActionPreview action={action} lookups={lookups} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setChatOpen(true)}
            title="Discuss with agent"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Discuss
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => denyMutation.mutate()}
            disabled={denyMutation.isPending || approveMutation.isPending}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Deny
          </Button>
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={denyMutation.isPending || approveMutation.isPending}
          >
            <Check className="h-3.5 w-3.5" />
            Approve
          </Button>
        </div>
      </div>
      <ChatPanel
        anchorType="proposed_action"
        anchorId={action.id}
        anchorLabel={action.kind.toLowerCase().replace(/_/g, ' ')}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}

function ActionPreview({ action, lookups }: { action: ProposedAction; lookups: Lookups }) {
  const p = action.payload as Record<string, unknown>;

  if (action.kind === 'POST_NOTE') {
    const body = String(p.body ?? '');
    return (
      <div className="mt-2 rounded-md bg-background/60 border px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Note body</div>
        <p className="text-sm whitespace-pre-wrap">{body}</p>
      </div>
    );
  }

  if (action.kind === 'LINK_TASK_TO_EVENT') {
    const task = lookups.tasks.get(String(p.taskId ?? ''));
    const event = lookups.events.get(String(p.calendarEventId ?? ''));
    return (
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="rounded-md border bg-background/60 px-2 py-1 truncate">
          {task?.title ?? '(task)'}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="rounded-md border bg-background/60 px-2 py-1 truncate">
          {event?.title ?? '(event)'}{' '}
          {event?.startsAt && (
            <span className="text-muted-foreground">{format(new Date(event.startsAt), 'MMM d p')}</span>
          )}
        </span>
      </div>
    );
  }

  if (action.kind === 'ADJUST_WEIGHT') {
    const task = lookups.tasks.get(String(p.taskId ?? ''));
    const newW = Number(p.newWeight);
    return (
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{task?.title ?? '(task)'}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium tabular-nums">
          weight {task?.weight ?? '?'} → {newW}
        </span>
      </div>
    );
  }

  if (action.kind === 'RESCHEDULE_TASK') {
    const task = lookups.tasks.get(String(p.taskId ?? ''));
    const newDue = p.newDueDate ? format(new Date(String(p.newDueDate)), 'MMM d, p') : null;
    const newSched = p.newScheduledFor ? format(new Date(String(p.newScheduledFor)), 'MMM d, p') : null;
    return (
      <div className="mt-2 space-y-1 text-xs">
        <div className="text-muted-foreground">{task?.title ?? '(task)'}</div>
        {newDue && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">due:</span>
            {task?.dueDate && (
              <>
                <span>{format(new Date(task.dueDate), 'MMM d, p')}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </>
            )}
            <span className="font-medium">{newDue}</span>
          </div>
        )}
        {newSched && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">scheduled:</span>
            {task?.scheduledFor && (
              <>
                <span>{format(new Date(task.scheduledFor), 'MMM d, p')}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </>
            )}
            <span className="font-medium">{newSched}</span>
          </div>
        )}
      </div>
    );
  }

  if (action.kind === 'CREATE_TASK') {
    const cat = p.categoryId ? lookups.categories.get(String(p.categoryId)) : null;
    const event = p.linkedCalendarEventId
      ? lookups.events.get(String(p.linkedCalendarEventId))
      : null;
    return (
      <div className="mt-2 rounded-md bg-background/60 border px-3 py-2 space-y-1">
        <div className="text-sm font-medium">{String(p.title ?? '(untitled)')}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {cat && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
              {cat.name}
            </span>
          )}
          {p.weight != null && <span>weight {String(p.weight)}</span>}
          {p.dueDate ? <span>due {format(new Date(String(p.dueDate)), 'MMM d, p')}</span> : null}
          {event && <span>↦ {event.title}</span>}
        </div>
        {p.description ? (
          <p className="text-xs text-muted-foreground">{String(p.description)}</p>
        ) : null}
      </div>
    );
  }

  return null;
}

function AgentRunCard({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const decision = run.decision;
  const observations = (decision?.observations ?? []) as string[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-start gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                {run.kind.toLowerCase().replace(/_/g, ' ')}
              </Badge>
              <span className={cn('text-[10px] uppercase tabular-nums', STATUS_TONE[run.status])}>
                {run.status}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
              </span>
              {run.proposedActions.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {run.proposedActions.length} {run.proposedActions.length === 1 ? 'action' : 'actions'}
                </Badge>
              )}
            </div>
            {decision?.summary && (
              <p className="text-sm mt-1.5 line-clamp-2">{decision.summary}</p>
            )}
            {run.error && (
              <p className="text-sm text-destructive mt-1.5 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {run.error}
              </p>
            )}
          </div>
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 pt-0">
          {observations.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Observations</div>
              <ul className="text-sm space-y-1">
                {observations.map((o, i) => (
                  <li key={i} className="pl-3 border-l-2 border-secondary">{o}</li>
                ))}
              </ul>
            </div>
          )}
          {run.proposedActions.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Actions</div>
                {run.proposedActions.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-md border bg-secondary/20 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {a.kind.toLowerCase().replace(/_/g, ' ')}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">{a.mode}</Badge>
                      <span className={cn('text-[10px] uppercase', STATUS_TONE[a.status])}>
                        {a.status}
                      </span>
                    </div>
                    <p className="text-sm">{a.rationale}</p>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="text-[10px] text-muted-foreground tabular-nums flex gap-3">
            <span>tokens: in {run.inputTokens.toLocaleString()} · out {run.outputTokens.toLocaleString()}</span>
            <span>{format(new Date(run.startedAt), 'MMM d, p')}</span>
            <span>trigger: {run.trigger}</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
