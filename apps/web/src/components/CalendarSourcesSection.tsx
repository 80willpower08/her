import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, EyeOffIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { CalendarSource, Category, ExternalAccount, UnmappedCalendar } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const NONE = '__none__';

export function CalendarSourcesSection() {
  const sourcesQ = useQuery({
    queryKey: ['calendar-sources'],
    queryFn: () => api.calendarSources.list(),
  });
  const accountsQ = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts.list() });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });

  const sources = sourcesQ.data?.sources ?? [];
  const unmapped = sourcesQ.data?.unmapped ?? [];
  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  return (
    <>
        {sources.length === 0 && unmapped.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No calendars discovered yet — connect a calendar account and run a sync.
          </p>
        ) : null}

        {sources.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            account={accountById.get(s.externalAccountId) ?? null}
            categoryById={categoryById}
            categories={categories}
          />
        ))}

        {unmapped.length > 0 ? (
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Unmapped calendars ({unmapped.length})
            </h4>
            {unmapped.map((u) => (
              <UnmappedRow
                key={`${u.externalAccountId}::${u.sourceCalendarId}`}
                row={u}
                account={accountById.get(u.externalAccountId) ?? null}
                categories={categories}
              />
            ))}
          </div>
        ) : null}
    </>
  );
}

function SourceRow({
  source,
  account,
  categoryById,
  categories,
}: {
  source: CalendarSource;
  account: ExternalAccount | null;
  categoryById: Map<string, Category>;
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (patch: {
      label?: string;
      categoryId?: string | null;
      hidden?: boolean;
      notes?: string | null;
    }) => api.calendarSources.update(source.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-sources'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.calendarSources.delete(source.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-sources'] }),
  });

  const accountLabel = account?.label ?? account?.accountEmail ?? 'unknown';
  const categoryLabel = source.categoryId
    ? categoryById.get(source.categoryId)?.name ?? '—'
    : '—';

  if (editing) {
    return (
      <EditRow
        initial={source}
        categories={categories}
        accountLabel={accountLabel}
        sourceCalendarId={source.sourceCalendarId}
        eventCount={source.eventCount}
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={(patch) => {
          updateMutation.mutate(patch, { onSuccess: () => setEditing(false) });
        }}
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {source.hidden ? <EyeOffIcon className="h-3 w-3 text-muted-foreground" /> : null}
          <span>{source.label}</span>
          <span className="text-xs text-muted-foreground">· {categoryLabel}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {accountLabel} · {source.sourceCalendarId} · {source.eventCount ?? 0} events
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <PencilIcon className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
        >
          <Trash2Icon className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function UnmappedRow({
  row,
  account,
  categories,
}: {
  row: UnmappedCalendar;
  account: ExternalAccount | null;
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();
  const accountLabel = account?.label ?? account?.accountEmail ?? 'unknown';

  const upsertMutation = useMutation({
    mutationFn: (input: {
      label: string;
      categoryId: string | null;
      hidden: boolean;
      notes: string | null;
    }) =>
      api.calendarSources.upsert({
        externalAccountId: row.externalAccountId,
        sourceCalendarId: row.sourceCalendarId,
        ...input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-sources'] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <EditRow
        initial={null}
        categories={categories}
        accountLabel={accountLabel}
        sourceCalendarId={row.sourceCalendarId}
        eventCount={row.eventCount}
        submitLabel="Map"
        onCancel={() => setEditing(false)}
        onSubmit={(patch) =>
          upsertMutation.mutate({
            label: patch.label ?? '',
            categoryId: patch.categoryId ?? null,
            hidden: patch.hidden ?? false,
            notes: patch.notes ?? null,
          })
        }
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{row.sourceCalendarId}</div>
        <div className="text-xs text-muted-foreground">
          {accountLabel} · {row.eventCount} events
        </div>
        {row.sampleTitles && row.sampleTitles.length > 0 ? (
          <div className="mt-1 truncate text-xs text-muted-foreground/80">
            e.g. {row.sampleTitles.slice(0, 3).join(' · ')}
          </div>
        ) : null}
      </div>
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        Map
      </Button>
    </div>
  );
}

function EditRow({
  initial,
  categories,
  accountLabel,
  sourceCalendarId,
  eventCount,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: CalendarSource | null;
  categories: Category[];
  accountLabel: string;
  sourceCalendarId: string;
  eventCount: number | undefined;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (patch: {
    label?: string;
    categoryId?: string | null;
    hidden?: boolean;
    notes?: string | null;
  }) => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [hidden, setHidden] = useState(initial?.hidden ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="text-xs text-muted-foreground">
        {accountLabel} · {sourceCalendarId} · {eventCount ?? 0} events
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "Work — PDS"'
          />
        </div>
        <div className="space-y-1">
          <Label>Category</Label>
          <Select
            value={categoryId || NONE}
            onValueChange={(v) => setCategoryId(v === NONE ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Optional category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>(none)</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="hidden"
          checked={hidden}
          onCheckedChange={(v) => setHidden(v === true)}
        />
        <Label htmlFor="hidden" className="text-sm">
          Hide events from this calendar (excluded from agent + UI)
        </Label>
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes" className="text-sm">
          Relevance notes (read by the agent)
        </Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder='e.g. "Family calendar — kids&apos; activities involve me; school board (NCISD) and dance (Mekka) are spouse only; $-prefix titles are paydays, no action needed."'
        />
        <p className="text-xs text-muted-foreground">
          Free text. The agent reads this when deciding what's actionable.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onSubmit({
              label: label.trim(),
              categoryId: categoryId || null,
              hidden,
              notes: notes.trim() || null,
            })
          }
          disabled={!label.trim()}
        >
          <CheckIcon className="h-3 w-3" />
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <XIcon className="h-3 w-3" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
