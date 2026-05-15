import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { Inbox, Mail, Share2, ArrowRight, MessageSquare } from 'lucide-react';
import type { ExternalAccount, SharedItem } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChatPanel } from '@/components/ChatPanel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type StatusFilter = 'pending' | 'all';
type SourceFilter = 'all' | 'GMAIL' | 'OUTLOOK' | 'SHARED';

export function InboxPage() {
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [source, setSource] = useState<SourceFilter>('all');
  const [accountId, setAccountId] = useState<string>('all');

  const messagesQ = useQuery({
    queryKey: ['messages', { status, source, accountId }],
    queryFn: () =>
      api.messages.list({
        status,
        source,
        accountId: accountId === 'all' ? undefined : accountId,
        limit: 200,
      }),
  });

  const accountsQ = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts.list() });

  const messages = messagesQ.data?.messages ?? [];
  const pendingCount = messagesQ.data?.pendingCount ?? 0;
  const bySource = messagesQ.data?.bySource ?? [];
  const accounts = accountsQ.data?.accounts ?? [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Inbox className="h-5 w-5" />
          Inbox
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manually-shared items + ingested emails. Pending shares need triaging.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SummaryPill icon={<Share2 className="h-3 w-3" />} label="Pending" value={pendingCount} accent={pendingCount > 0} />
        {bySource.map((b) => (
          <SummaryPill
            key={b.source}
            icon={<Mail className="h-3 w-3" />}
            label={sourceDisplay(b.source)}
            value={b.count}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending only</SelectItem>
            <SelectItem value="all">All triage statuses</SelectItem>
          </SelectContent>
        </Select>

        <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="SHARED">Shared</SelectItem>
            <SelectItem value="GMAIL">Gmail</SelectItem>
            <SelectItem value="OUTLOOK">Outlook</SelectItem>
          </SelectContent>
        </Select>

        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label || a.accountEmail || `${a.provider} account`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {messagesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : messages.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nothing here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} account={m.externalAccountId ? accountById.get(m.externalAccountId) ?? null : null} />
          ))}
        </div>
      )}
    </div>
  );
}

function sourceDisplay(s: 'GMAIL' | 'OUTLOOK' | 'SHARED'): string {
  if (s === 'GMAIL') return 'Gmail';
  if (s === 'OUTLOOK') return 'Outlook';
  return 'Shared';
}

function SummaryPill({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
        accent ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border text-muted-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function MessageRow({ message, account }: { message: SharedItem; account: ExternalAccount | null }) {
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);
  const isPending = message.triageStatus === 'PENDING';
  const accountLabel = account?.label || account?.accountEmail || (message.source === 'SHARED' ? 'Shared' : 'Account');

  return (
    <Card className={isPending ? 'border-primary/40' : ''}>
      <CardHeader className="space-y-1 p-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant={message.source === 'SHARED' ? 'default' : 'secondary'}
                className="gap-1.5"
              >
                {account?.color ? (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: account.color }}
                  />
                ) : null}
                {sourceDisplay(message.source)}
              </Badge>
              <span>{accountLabel}</span>
              <span>·</span>
              <span title={format(new Date(message.receivedAt), 'PPpp')}>
                {formatDistanceToNow(new Date(message.receivedAt), { addSuffix: true })}
              </span>
              {message.triageStatus !== 'NONE' && message.triageStatus !== 'PENDING' ? (
                <>
                  <span>·</span>
                  <Badge variant="outline">{triageDisplay(message.triageStatus)}</Badge>
                </>
              ) : null}
            </div>
            <CardTitle className="truncate text-sm">{message.subject}</CardTitle>
            <p className="truncate text-xs text-muted-foreground">
              {message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setChatOpen(true)}
              title="Discuss with agent"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
            {isPending ? (
              <Button
                size="sm"
                onClick={() => navigate(`/share-receive?messageId=${encodeURIComponent(message.id)}`)}
              >
                Triage
                <ArrowRight className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {message.snippet || message.bodyText ? (
        <CardContent className="p-3 pt-0">
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {message.snippet || message.bodyText?.slice(0, 300)}
          </p>
        </CardContent>
      ) : null}
      <ChatPanel
        anchorType="message"
        anchorId={message.id}
        anchorLabel={message.subject}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </Card>
  );
}

function triageDisplay(s: SharedItem['triageStatus']): string {
  if (s === 'CONVERTED_TO_TASK') return 'task';
  if (s === 'ATTACHED_TO_GOAL') return 'goal';
  if (s === 'NOTED') return 'noted';
  if (s === 'DISCARDED') return 'discarded';
  return s.toLowerCase();
}
