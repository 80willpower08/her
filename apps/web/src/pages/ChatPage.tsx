// /chat — agent surface. Left tree organizes:
//   - New conversation
//   - Pending review (proposals queue inline)
//   - About me (observations editor)
//   - Patterns (data-driven insights)
//   - Threads, grouped by anchor type
// Right pane: selected view (thread / pending list / about-me / patterns).
//
// URL shape:
//   /chat                        → empty state
//   /chat/pending                → pending action queue
//   /chat/about-me               → /about-me content
//   /chat/patterns               → /patterns content
//   /chat/:threadId              → an actual thread (active conversation)

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Edit2,
  Inbox,
  Layers,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ChatAnchorType, ChatMessage, ChatThread } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AgentPage } from './AgentPage';

const POLL_WAITING_MS = 1500;
const POLL_IDLE_MS = 5000;

type SpecialView = 'pending';

export function ChatPage() {
  const params = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // threadId can hold either a real thread id or a SpecialView slug.
  // About me + Patterns moved to /dashboard; only 'pending' remains.
  const slug = params.threadId;
  const specialView: SpecialView | null = slug === 'pending' ? slug : null;
  const activeThreadId = !specialView ? (slug ?? null) : null;

  const threadsQ = useQuery({
    queryKey: ['chat-threads'],
    queryFn: () => api.chat.listThreads(),
  });
  const pendingQ = useQuery({
    queryKey: ['agent', 'pending'],
    queryFn: () => api.agent.proposedActions('PENDING'),
    refetchInterval: 30000,
  });
  const threads = threadsQ.data?.threads ?? [];
  const pendingCount = pendingQ.data?.actions?.length ?? 0;

  const createMutation = useMutation({
    mutationFn: () => api.chat.createGeneralThread(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
      navigate(`/chat/${res.thread.id}`);
      setMobileMenuOpen(false);
    },
  });

  function gotoThread(id: string) {
    navigate(`/chat/${id}`);
    setMobileMenuOpen(false);
  }
  function gotoSpecial(s: SpecialView) {
    navigate(`/chat/${s}`);
    setMobileMenuOpen(false);
  }
  const headerLabel = specialView === 'pending'
    ? 'Pending review'
    : activeThreadId
      ? threads.find((t) => t.id === activeThreadId)?.title ?? 'Conversation'
      : 'Chat';

  return (
    <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-6 lg:h-[calc(100vh-7rem)]">
      <aside className="lg:overflow-y-auto lg:pr-2">
        <div className="lg:hidden mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="w-full justify-start"
          >
            <Menu className="h-4 w-4" />
            {headerLabel}
            {pendingCount > 0 ? (
              <span className="ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {pendingCount}
              </span>
            ) : null}
          </Button>
        </div>

        <div className={cn('space-y-1', !mobileMenuOpen && 'hidden lg:block')}>
          <div className="flex items-center justify-between pb-2">
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <MessageSquare className="h-5 w-5" /> Chat
            </h1>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>

          <TreeButton
            icon={<Sparkles className="h-4 w-4" />}
            label="Pending review"
            badge={pendingCount > 0 ? pendingCount : undefined}
            active={specialView === 'pending'}
            onClick={() => gotoSpecial('pending')}
          />

          <ThreadGroups
            threads={threads}
            loading={threadsQ.isLoading}
            activeThreadId={activeThreadId}
            onPick={gotoThread}
          />
        </div>
      </aside>

      {/* Right pane: threads need overflow-hidden so their composer pins to
          the bottom; special views (AboutMe, Patterns, AgentPage) are normal
          scroll content and need overflow-y-auto. */}
      <section
        className={cn(
          specialView || !activeThreadId ? 'lg:overflow-y-auto' : 'lg:overflow-hidden'
        )}
      >
        {specialView === 'pending' ? (
          <AgentPage />
        ) : activeThreadId ? (
          <ActiveThread threadId={activeThreadId} />
        ) : (
          <EmptyState
            onNew={() => createMutation.mutate()}
            onPickPending={() => gotoSpecial('pending')}
            disabled={createMutation.isPending}
            hasThreads={threads.length > 0}
            onPickAnyThread={() => threads[0] && gotoThread(threads[0].id)}
            pendingCount={pendingCount}
          />
        )}
      </section>
    </div>
  );
}

function ThreadGroups({
  threads,
  loading,
  activeThreadId,
  onPick,
}: {
  threads: ChatThread[];
  loading: boolean;
  activeThreadId: string | null;
  onPick: (id: string) => void;
}) {
  // Bucket by anchor type. "general" first since it's the freeform-chat
  // surface; anchored ones grouped after.
  const buckets: Array<{ key: ChatAnchorType | 'general'; label: string; icon: React.ReactNode }> = [
    { key: 'general', label: 'General', icon: <MessageSquare className="h-4 w-4" /> },
    { key: 'project', label: 'Projects', icon: <Briefcase className="h-4 w-4" /> },
    { key: 'category', label: 'Categories', icon: <Layers className="h-4 w-4" /> },
    { key: 'goal', label: 'Goals', icon: <Target className="h-4 w-4" /> },
    { key: 'task', label: 'Tasks', icon: <ClipboardList className="h-4 w-4" /> },
    { key: 'event', label: 'Events', icon: <CalendarDays className="h-4 w-4" /> },
    { key: 'message', label: 'Messages', icon: <Inbox className="h-4 w-4" /> },
    { key: 'proposed_action', label: 'Proposals', icon: <Sparkles className="h-4 w-4" /> },
  ];

  const byBucket = new Map<string, ChatThread[]>();
  for (const t of threads) byBucket.set(t.anchorType, [...(byBucket.get(t.anchorType) ?? []), t]);

  if (loading) return <p className="text-xs text-muted-foreground mt-3">Loading…</p>;
  if (threads.length === 0)
    return (
      <p className="text-xs text-muted-foreground mt-3">
        No conversations yet. "New" starts one.
      </p>
    );

  return (
    <div className="mt-3 space-y-1 border-t pt-3">
      {buckets.map((b) => {
        const list = byBucket.get(b.key) ?? [];
        if (list.length === 0) return null;
        return (
          <TreeGroup
            key={b.key}
            icon={b.icon}
            label={b.label}
            count={list.length}
            defaultOpen={b.key === 'general' || b.key === 'project'}
          >
            {list.map((t) => (
              <ThreadLeaf
                key={t.id}
                thread={t}
                active={activeThreadId === t.id}
                onSelect={() => onPick(t.id)}
              />
            ))}
          </TreeGroup>
        );
      })}
    </div>
  );
}

function TreeButton({
  icon,
  label,
  badge,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
        active && 'bg-accent text-accent-foreground'
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {badge ? (
        <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function TreeGroup({
  icon,
  label,
  count,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
      >
        <span className="text-muted-foreground">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="text-muted-foreground">{icon}</span>
        <span className="truncate flex-1">{label}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </button>
      {open ? <ul className="ml-6 space-y-0.5">{children}</ul> : null}
    </div>
  );
}

function ThreadLeaf({
  thread,
  active,
  onSelect,
}: {
  thread: ChatThread;
  active: boolean;
  onSelect: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title ?? '');
  const label = thread.title ?? defaultThreadLabel(thread);
  const subtitle = formatDistanceToNow(new Date(thread.updatedAt), { addSuffix: true });

  const renameMutation = useMutation({
    mutationFn: (title: string) => api.chat.renameThread(thread.id, title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
      setEditing(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.chat.deleteThread(thread.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
      if (active) navigate('/chat');
    },
  });

  if (editing) {
    return (
      <li className="rounded-md border p-1.5 space-y-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          className="h-7 text-xs"
        />
        <div className="flex gap-1">
          <Button
            size="sm"
            className="h-6 px-2"
            onClick={() => renameMutation.mutate(draft.trim() || 'Untitled')}
            disabled={!draft.trim()}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-accent',
          active && 'bg-accent text-accent-foreground'
        )}
        onClick={onSelect}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate">{label}</p>
          <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
        </div>
        {thread.anchorType === 'general' ? (
          <div className="flex opacity-0 group-hover:opacity-100">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={(e) => {
                e.stopPropagation();
                setDraft(thread.title ?? '');
                setEditing(true);
              }}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete thread "${label}"?`)) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function defaultThreadLabel(thread: ChatThread): string {
  if (thread.anchorType === 'general') return 'Untitled chat';
  return `${thread.anchorType} discussion`;
}

function EmptyState({
  onNew,
  onPickPending,
  disabled,
  hasThreads,
  onPickAnyThread,
  pendingCount,
}: {
  onNew: () => void;
  onPickPending: () => void;
  disabled: boolean;
  hasThreads: boolean;
  onPickAnyThread: () => void;
  pendingCount: number;
}) {
  return (
    <Card className="h-full">
      <CardContent className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
        <Bot className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-base font-medium">What do you want to do?</p>
          <p className="text-sm text-muted-foreground max-w-md mt-1">
            Start a new conversation, review what the agent has proposed, browse what it
            knows about you, or pick up an existing thread from the left.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          <Button onClick={onNew} disabled={disabled}>
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
          {pendingCount > 0 ? (
            <Button variant="secondary" onClick={onPickPending}>
              <Sparkles className="h-4 w-4" />
              Review {pendingCount} pending
            </Button>
          ) : null}
          {hasThreads ? (
            <Button variant="ghost" onClick={onPickAnyThread}>
              Most recent
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ActiveThread({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const [composer, setComposer] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastAgentIdRef = useRef<string | null>(null);

  const threadQ = useQuery({
    queryKey: ['chat-thread', threadId],
    queryFn: () => api.chat.getThread(threadId),
    refetchInterval: (q) => {
      const msgs = q.state.data?.thread.messages ?? [];
      const last = msgs[msgs.length - 1];
      return last?.role === 'USER' ? POLL_WAITING_MS : POLL_IDLE_MS;
    },
    refetchOnWindowFocus: true,
  });

  const messages: ChatMessage[] = threadQ.data?.thread.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const isWaitingForAgent = lastMessage?.role === 'USER';

  useEffect(() => {
    if (!lastMessage || lastMessage.role !== 'AGENT') return;
    if (lastAgentIdRef.current === lastMessage.id) return;
    lastAgentIdRef.current = lastMessage.id;
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    qc.invalidateQueries({ queryKey: ['agent-proposed-actions'] });
    qc.invalidateQueries({ queryKey: ['agent', 'pending'] });
    qc.invalidateQueries({ queryKey: ['agent'] });
    qc.invalidateQueries({ queryKey: ['goals'] });
    qc.invalidateQueries({ queryKey: ['observations'] });
  }, [lastMessage, qc]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isWaitingForAgent]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => api.chat.postMessage(threadId, body),
    onSuccess: () => {
      setComposer('');
      qc.invalidateQueries({ queryKey: ['chat-thread', threadId] });
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
    },
  });

  return (
    <Card className="h-full lg:h-full flex flex-col">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {threadQ.isLoading && !threadQ.data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Empty thread. Ask the agent something — about your week, your goals, a decision
            you're weighing.
          </p>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        {isWaitingForAgent ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Agent is thinking… (planning-heavy questions can take a few minutes)
          </div>
        ) : null}
      </div>
      <form
        className="border-t p-3 flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (composer.trim() && !sendMutation.isPending && !isWaitingForAgent) {
            sendMutation.mutate(composer.trim());
          }
        }}
      >
        <Textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder={
            isWaitingForAgent
              ? 'Waiting for agent reply…'
              : 'Ask the agent anything…'
          }
          rows={2}
          className="flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (composer.trim() && !sendMutation.isPending && !isWaitingForAgent) {
                sendMutation.mutate(composer.trim());
              }
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!composer.trim() || sendMutation.isPending || isWaitingForAgent}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'USER';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground'
        )}
      >
        {message.body}
      </div>
    </div>
  );
}
