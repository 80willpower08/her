import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, X, Plus, Lock, Calendar, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import type { Category, Task } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { WeightSlider } from '@/components/WeightSlider';
import { ChatPanel } from '@/components/ChatPanel';
import { cn } from '@/lib/utils';

const dateInputValue = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
};

const PRIORITY_VARIANT = {
  LOW: 'outline',
  MEDIUM: 'secondary',
  HIGH: 'default',
  CRITICAL: 'destructive',
} as const;

interface TaskDetailProps {
  task: Task;
  allTasks: Task[];
  categories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetail({ task, allTasks, categories, open, onOpenChange }: TaskDetailProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [categoryId, setCategoryId] = useState(task.categoryId ?? '');
  const [weight, setWeight] = useState(task.weight);
  const [dueDate, setDueDate] = useState(dateInputValue(task.dueDate));
  const [scheduledFor, setScheduledFor] = useState(dateInputValue(task.scheduledFor));
  const [linkedEventId, setLinkedEventId] = useState(task.linkedCalendarEventId ?? '');
  const [noteDraft, setNoteDraft] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [showRankBreakdown, setShowRankBreakdown] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setCategoryId(task.categoryId ?? '');
    setWeight(task.weight);
    setDueDate(dateInputValue(task.dueDate));
    setScheduledFor(dateInputValue(task.scheduledFor));
    setLinkedEventId(task.linkedCalendarEventId ?? '');
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcomingEventsQ = useQuery({
    queryKey: ['calendar', 'upcoming-30d'],
    queryFn: () =>
      api.calendar({
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    enabled: open,
    staleTime: 60_000,
  });
  const upcomingEvents = upcomingEventsQ.data?.events ?? [];

  const messages = useQuery({
    queryKey: ['conversation', 'task', task.id],
    queryFn: () => api.conversations.listMessages('task', task.id),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['categories'] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.tasks.update(task.id, {
        title,
        description: description || null,
        categoryId: categoryId || null,
        weight,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        linkedCalendarEventId: linkedEventId || null,
      }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.tasks.delete(task.id),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
    },
  });

  const noteMutation = useMutation({
    mutationFn: () => api.conversations.postMessage('task', task.id, 'NOTE', noteDraft),
    onSuccess: () => {
      setNoteDraft('');
      queryClient.invalidateQueries({ queryKey: ['conversation', 'task', task.id] });
    },
  });

  const addPrereqMutation = useMutation({
    mutationFn: (prereqId: string) => api.tasks.addPrereq(task.id, prereqId),
    onSuccess: invalidate,
  });

  const removePrereqMutation = useMutation({
    mutationFn: (prereqId: string) => api.tasks.removePrereq(task.id, prereqId),
    onSuccess: invalidate,
  });

  const addSubtaskMutation = useMutation({
    mutationFn: () =>
      api.tasks.create({
        title: newSubtaskTitle,
        parentId: task.id,
        categoryId: task.categoryId,
      }),
    onSuccess: () => {
      setNewSubtaskTitle('');
      invalidate();
    },
  });

  const completeSubtaskMutation = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      completed ? api.tasks.uncomplete(id) : api.tasks.complete(id),
    onSuccess: invalidate,
  });

  const deleteSubtaskMutation = useMutation({
    mutationFn: (id: string) => api.tasks.delete(id),
    onSuccess: invalidate,
  });

  const prereqTasks = task.prerequisiteIds
    .map((id) => allTasks.find((t) => t.id === id))
    .filter((t): t is Task => Boolean(t));

  const candidatePrereqs = allTasks.filter(
    (t) => t.id !== task.id && !task.prerequisiteIds.includes(t.id) && t.parentId === null
  );

  const subtasks = allTasks.filter((t) => task.subtaskIds.includes(t.id));

  function handleSave(e: FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  function handlePostNote(e: FormEvent) {
    e.preventDefault();
    if (!noteDraft.trim()) return;
    noteMutation.mutate();
  }

  function handleAddSubtask(e: FormEvent) {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;
    addSubtaskMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle className="sr-only">Edit task</DialogTitle>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="flex items-start gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-base font-semibold border-0 px-0 shadow-none focus-visible:ring-0 flex-1"
              required
            />
            <Badge variant={PRIORITY_VARIANT[task.derivedPriority]} className="shrink-0 mt-1.5">
              {task.derivedPriority}
            </Badge>
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <WeightSlider
              value={weight}
              onChange={setWeight}
              label="Weight"
              hint="How much this individual task matters."
            />
            <div className="space-y-1.5">
              <Label htmlFor="due" className="text-xs uppercase tracking-wide text-muted-foreground">Due</Label>
              <Input
                id="due"
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scheduled" className="text-xs uppercase tracking-wide text-muted-foreground">Scheduled</Label>
              <Input
                id="scheduled"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> Linked event
            </Label>
            {linkedEventId ? (
              <div className="flex items-center gap-2 rounded-md border bg-secondary/30 px-3 py-1.5">
                {task.linkedCalendarEvent ? (
                  <span className="text-sm flex-1 min-w-0 truncate">
                    {task.linkedCalendarEvent.title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {format(new Date(task.linkedCalendarEvent.startsAt), 'MMM d, p')}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm flex-1 text-muted-foreground italic">
                    Linked event no longer in window
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setLinkedEventId('')}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : upcomingEvents.length > 0 ? (
              <Select value="" onValueChange={(v) => setLinkedEventId(v)}>
                <SelectTrigger className="text-muted-foreground">
                  <span className="text-sm">Pin to a calendar event…</span>
                </SelectTrigger>
                <SelectContent>
                  {upcomingEvents.slice(0, 50).map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>
                      <span className="truncate">{ev.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {format(new Date(ev.startsAt), 'MMM d, p')}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">No upcoming events to link to.</p>
            )}
            {linkedEventId && (
              <p className="text-[10px] text-muted-foreground">
                Urgency anchors to the event start time instead of due date.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowRankBreakdown((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showRankBreakdown ? 'Hide' : 'Why is this'} {task.derivedPriority.toLowerCase()}{showRankBreakdown ? '' : '?'}
          </button>
          {showRankBreakdown && (
            <div className="rounded-md bg-secondary/40 p-3 text-xs space-y-1 font-mono">
              <div className="flex justify-between"><span>importance</span><span>{(task.importance * 100).toFixed(0)}%</span></div>
              <div className="flex justify-between"><span>urgency</span><span>{(task.urgency * 100).toFixed(0)}%</span></div>
              <div className="flex justify-between"><span>performance</span><span>{(task.rankBreakdown.performance * 100).toFixed(0)}%</span></div>
              <Separator className="my-1" />
              <div className="flex justify-between font-semibold"><span>rank</span><span>{(task.rank * 100).toFixed(0)}%</span></div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm('Delete this task?')) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setChatOpen(true)}
            >
              <MessageSquare className="h-4 w-4" />
              Discuss with agent
            </Button>
            <Button type="submit" size="sm" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>

        <ChatPanel
          anchorType="task"
          anchorId={task.id}
          anchorLabel={task.title}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
        />

        <Separator />

        {/* Subtasks */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Subtasks</h3>
            {subtasks.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {subtasks.filter((s) => s.completed).length} / {subtasks.length}
              </span>
            )}
          </div>
          {subtasks.length > 0 && (
            <ul className="space-y-1">
              {subtasks.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border bg-secondary/30 px-2 py-1.5"
                >
                  <Checkbox
                    checked={s.completed}
                    onCheckedChange={() =>
                      completeSubtaskMutation.mutate({ id: s.id, completed: s.completed })
                    }
                  />
                  <span className={cn('text-sm flex-1', s.completed && 'line-through text-muted-foreground')}>
                    {s.title}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteSubtaskMutation.mutate(s.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAddSubtask} className="flex gap-2">
            <Input
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              placeholder="Add a subtask…"
              className="flex-1"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!newSubtaskTitle.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </form>
        </section>

        <Separator />

        {/* Prerequisites */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Prerequisites</h3>
            {task.isBlocked && (
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3 w-3" /> Blocked
              </Badge>
            )}
          </div>
          {prereqTasks.length > 0 && (
            <div className="space-y-1.5">
              {prereqTasks.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border bg-secondary/30 px-3 py-1.5"
                >
                  <span className="text-sm">
                    {p.completed ? '✓ ' : '○ '}
                    <span className={p.completed ? 'line-through text-muted-foreground' : ''}>{p.title}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => removePrereqMutation.mutate(p.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {candidatePrereqs.length > 0 ? (
            <Select onValueChange={(id) => addPrereqMutation.mutate(id)} value="">
              <SelectTrigger className="text-muted-foreground">
                <span className="inline-flex items-center gap-2 text-sm">
                  <Plus className="h-3.5 w-3.5" /> Add prerequisite
                </span>
              </SelectTrigger>
              <SelectContent>
                {candidatePrereqs.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : prereqTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No other tasks to block on yet.</p>
          ) : null}
        </section>

        <Separator />

        {/* Notes thread */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Notes</h3>
          <p className="text-xs text-muted-foreground">
            Notes are silent — when an agent is around, it'll read these as background context but won't reply.
          </p>
          {messages.data && messages.data.messages.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {messages.data.messages.map((m) => (
                <div key={m.id} className="rounded-md bg-secondary/50 px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-0.5">
                    <span>{m.kind.toLowerCase()}</span>
                    <span>{format(new Date(m.createdAt), 'MMM d, h:mm a')}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handlePostNote} className="space-y-2">
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add a note…"
              rows={2}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!noteDraft.trim() || noteMutation.isPending}>
                {noteMutation.isPending ? 'Saving…' : 'Save note'}
              </Button>
            </div>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  );
}
