import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, CheckCircle2, Clock, Pencil, Plus, Trash2, AlertTriangle, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type {
  CommitmentEnforce,
  Observation,
  ObservationKind,
} from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const KIND_INFO: Record<
  ObservationKind,
  { label: string; tone: string; description: string }
> = {
  FACT: {
    label: 'Facts',
    tone: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
    description: 'Stable truths about you — work, family, accounts.',
  },
  PREFERENCE: {
    label: 'Preferences',
    tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    description: 'Rules the agent follows. Inviolable unless you change them.',
  },
  COMMITMENT: {
    label: 'Commitments',
    tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    description: 'Aspirations with targets. Conflicts get surfaced in chat.',
  },
  PATTERN: {
    label: 'Patterns',
    tone: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
    description: 'Recurring behavior the agent has noticed.',
  },
  INSIGHT: {
    label: 'Insights',
    tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    description: 'Things the agent has synthesized about how you work.',
  },
  CONCERN: {
    label: 'Concerns',
    tone: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    description: 'Active worries the agent is tracking.',
  },
};

const KIND_ORDER: ObservationKind[] = [
  'FACT',
  'PREFERENCE',
  'COMMITMENT',
  'PATTERN',
  'INSIGHT',
  'CONCERN',
];

export function AboutMePage() {
  const [creating, setCreating] = useState(false);

  const observationsQ = useQuery({
    queryKey: ['observations'],
    queryFn: () => api.observations.list(),
  });

  const observations = observationsQ.data?.observations ?? [];
  const byKind = new Map<ObservationKind, Observation[]>();
  for (const k of KIND_ORDER) byKind.set(k, []);
  for (const o of observations) {
    byKind.get(o.kind)?.push(o);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="display text-3xl flex items-center gap-2">
            <Brain className="h-6 w-6" /> About me
          </h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            What the agent knows about you — durable memory the agent reads on every run.
            Anything wrong, edit or delete it. Confirm to bump confidence to certain. Agent
            writes observations automatically from chats and patterns; you can also add your
            own.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="h-4 w-4" /> Add observation
        </Button>
      </header>

      {creating ? <CreateForm onDone={() => setCreating(false)} /> : null}

      {observationsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : observations.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nothing yet. The agent will start recording things as you chat with it about
            your goals, preferences, and life. Or click "Add observation" to seed something
            yourself.
          </CardContent>
        </Card>
      ) : (
        KIND_ORDER.map((kind) => {
          const items = byKind.get(kind) ?? [];
          if (items.length === 0) return null;
          const info = KIND_INFO[kind];
          return (
            <Card key={kind}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Badge className={info.tone} variant="secondary">
                        {info.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-normal">
                        ({items.length})
                      </span>
                    </CardTitle>
                    <CardDescription className="mt-1">{info.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((o) => (
                  <ObservationRow key={o.id} observation={o} />
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function ObservationRow({ observation }: { observation: Observation }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.observations.update>[1]) =>
      api.observations.update(observation.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observations'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.observations.delete(observation.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observations'] }),
  });

  if (editing) {
    return (
      <EditForm
        observation={observation}
        onCancel={() => setEditing(false)}
        onSave={(patch) =>
          updateMutation.mutate(patch, { onSuccess: () => setEditing(false) })
        }
      />
    );
  }

  const lowConf = observation.confidence < 0.8;
  const sourceLabel = sourceDisplay(observation.source);
  const ageText = formatDistanceToNow(new Date(observation.createdAt), { addSuffix: true });

  return (
    <div className="rounded-md border p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{observation.subject}</span>
            {observation.confirmedByUser ? (
              <Badge variant="outline" className="text-[10px] gap-1">
                <CheckCircle2 className="h-3 w-3" /> confirmed
              </Badge>
            ) : null}
            {lowConf ? (
              <Badge variant="outline" className="text-[10px]">
                {Math.round(observation.confidence * 100)}% confidence
              </Badge>
            ) : null}
            {observation.kind === 'COMMITMENT' && observation.enforceLevel === 'BLOCK' ? (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <AlertTriangle className="h-3 w-3" /> blocks conflicts
              </Badge>
            ) : null}
            {observation.expiresAt ? (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Clock className="h-3 w-3" /> expires {new Date(observation.expiresAt).toLocaleDateString()}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
            {observation.body}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {sourceLabel} · {ageText}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!observation.confirmedByUser ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Confirm"
              onClick={() =>
                updateMutation.mutate({ confirmedByUser: true, confidence: 1.0 })
              }
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Edit"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Delete"
            onClick={() => {
              if (confirm(`Delete observation "${observation.subject}"?`)) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ObservationKind>('FACT');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [enforce, setEnforce] = useState<CommitmentEnforce>('NORMAL');

  const mutation = useMutation({
    mutationFn: () =>
      api.observations.create({
        kind,
        subject: subject.trim(),
        body: body.trim(),
        enforceLevel: kind === 'COMMITMENT' ? enforce : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['observations'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Add observation</CardTitle>
          <Button size="icon" variant="ghost" onClick={onDone}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as ObservationKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_ORDER.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_INFO[k].label.replace(/s$/, '')} — {KIND_INFO[k].description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Subject</Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder='Short title — "Retirement target"'
          />
        </div>
        <div className="space-y-1">
          <Label>Body</Label>
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="1-3 sentences. Concrete."
          />
        </div>
        {kind === 'COMMITMENT' ? (
          <div className="space-y-1">
            <Label>Enforcement</Label>
            <Select value={enforce} onValueChange={(v) => setEnforce(v as CommitmentEnforce)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">Normal — agent mentions conflicts</SelectItem>
                <SelectItem value="BLOCK">
                  Block — agent refuses conflicting requests
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!subject.trim() || !body.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EditForm({
  observation,
  onCancel,
  onSave,
}: {
  observation: Observation;
  onCancel: () => void;
  onSave: (patch: Parameters<typeof api.observations.update>[1]) => void;
}) {
  const [subject, setSubject] = useState(observation.subject);
  const [body, setBody] = useState(observation.body);
  const [enforce, setEnforce] = useState<CommitmentEnforce>(observation.enforceLevel);

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="space-y-1">
        <Label>Subject</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Body</Label>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {observation.kind === 'COMMITMENT' ? (
        <div className="space-y-1">
          <Label>Enforcement</Label>
          <Select value={enforce} onValueChange={(v) => setEnforce(v as CommitmentEnforce)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NORMAL">Normal — mention conflicts</SelectItem>
              <SelectItem value="BLOCK">Block — refuse conflicting requests</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onSave({
              subject: subject.trim(),
              body: body.trim(),
              enforceLevel: observation.kind === 'COMMITMENT' ? enforce : undefined,
              confirmedByUser: true,
            })
          }
          disabled={!subject.trim() || !body.trim()}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function sourceDisplay(source: string): string {
  switch (source) {
    case 'user_chat':
      return 'You told the agent';
    case 'user_directive':
      return 'You added directly';
    case 'agent_inferred':
      return 'Agent inferred';
    case 'data_pattern':
      return 'Agent detected from data';
    default:
      return source;
  }
}
