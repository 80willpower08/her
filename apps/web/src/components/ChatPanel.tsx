import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Send, X } from 'lucide-react';
import type { ChatAnchorType, ChatMessage } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatPanelProps {
  anchorType: ChatAnchorType;
  anchorId: string | null;
  anchorLabel?: string;
  open: boolean;
  onClose: () => void;
}

// Polling cadences. Fast while waiting on the agent, slower when idle (still
// poll so async activity from other sources — daily runs that touch the
// thread, another tab — surfaces).
const POLL_WAITING_MS = 1500;
const POLL_IDLE_MS = 5000;

export function ChatPanel({ anchorType, anchorId, anchorLabel, open, onClose }: ChatPanelProps) {
  const qc = useQueryClient();
  const [composer, setComposer] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);

  const resolveQ = useQuery({
    queryKey: ['chat-thread-resolve', anchorType, anchorId],
    queryFn: () => api.chat.resolveThread(anchorType, anchorId),
    enabled: open,
  });
  const threadId = resolveQ.data?.thread.id ?? null;

  const threadQ = useQuery({
    queryKey: ['chat-thread', threadId],
    queryFn: () => api.chat.getThread(threadId!),
    enabled: !!threadId && open,
    // Derive cadence from the data, not a separate state variable, so the
    // poll keeps working across remounts/close-and-reopen.
    refetchInterval: (q) => {
      if (!open) return false;
      const msgs = q.state.data?.thread.messages ?? [];
      const last = msgs[msgs.length - 1];
      const waiting = last?.role === 'USER';
      return waiting ? POLL_WAITING_MS : POLL_IDLE_MS;
    },
    refetchOnWindowFocus: true,
  });

  const messages: ChatMessage[] = threadQ.data?.thread.messages ?? [];

  // "Waiting" is whenever the most recent message is from the user — the
  // agent hasn't replied yet. This is durable across remounts.
  const lastMessage = messages[messages.length - 1];
  const isWaitingForAgent = lastMessage?.role === 'USER';

  // When a new AGENT message arrives, invalidate downstream queries that may
  // reflect actions the agent just took (proposals, tasks, overview).
  const lastAgentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastMessage || lastMessage.role !== 'AGENT') return;
    if (lastAgentIdRef.current === lastMessage.id) return;
    lastAgentIdRef.current = lastMessage.id;
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    qc.invalidateQueries({ queryKey: ['agent-proposed-actions'] });
    qc.invalidateQueries({ queryKey: ['agent'] });
    qc.invalidateQueries({ queryKey: ['goals'] });
  }, [lastMessage, qc]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isWaitingForAgent]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => {
      if (!threadId) throw new Error('No thread');
      return api.chat.postMessage(threadId, body);
    },
    onSuccess: () => {
      setComposer('');
      qc.invalidateQueries({ queryKey: ['chat-thread', threadId] });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col bg-background shadow-xl sm:h-[90vh] sm:max-h-[800px] sm:w-[520px] sm:rounded-l-lg">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="h-4 w-4" />
            <span>Agent chat</span>
            {anchorLabel ? (
              <span className="text-xs text-muted-foreground">· {anchorLabel}</span>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {resolveQ.isLoading || (threadQ.isLoading && !threadQ.data) ? (
            <p className="text-sm text-muted-foreground">Loading thread…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Ask anything — e.g. <em>"why this priority?"</em>,
              <em> "draft a prep task for me,"</em> or <em>"don't suggest tasks for this calendar going forward."</em>
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
                : 'Ask the agent something…'
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
      </div>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'USER';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground'
        }`}
      >
        {message.body}
      </div>
    </div>
  );
}
