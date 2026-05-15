import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, PencilIcon, RefreshCw, Trash2Icon, XIcon, ExternalLink, AlertCircle } from 'lucide-react';
import type {
  Category,
  ExternalAccount,
  SheetSource,
  SheetSourceRegisterInput,
  SheetSourceUpdateInput,
  SheetSyncCadence,
} from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const NONE = '__none__';

export function SheetSourcesSection() {
  const sourcesQ = useQuery({
    queryKey: ['sheet-sources'],
    queryFn: () => api.sheetSources.list(),
  });
  const accountsQ = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts.list() });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });

  const sources = sourcesQ.data?.sources ?? [];
  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];

  const googleAccounts = accounts.filter((a) => a.provider === 'GOOGLE');
  const missingScope =
    googleAccounts.length > 0 &&
    !googleAccounts.some((a) => a.scopes.some((s) => s === SHEETS_SCOPE || s.includes('spreadsheets')));

  const [creating, setCreating] = useState(false);

  return (
    <>
        {missingScope ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="h-4 w-4" /> Reconnect Google to enable Sheets
            </div>
            <p className="text-xs text-muted-foreground">
              Your Google account hasn't granted the Sheets read scope yet. Disconnect and reconnect
              your Google account in the Connected accounts section — Google will append the new
              scope to the existing grant.
            </p>
          </div>
        ) : null}

        {sources.length === 0 && !creating ? (
          <p className="text-sm text-muted-foreground">
            No sheets registered. Click "Register a sheet" to add one.
          </p>
        ) : null}

        {sources.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            account={accounts.find((a) => a.id === s.externalAccountId) ?? null}
            categories={categories}
          />
        ))}

        {creating ? (
          <NewSourceRow
            accounts={googleAccounts}
            categories={categories}
            onDone={() => setCreating(false)}
          />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)} disabled={googleAccounts.length === 0}>
            Register a sheet
          </Button>
        )}
    </>
  );
}

function SourceRow({
  source,
  account,
  categories,
}: {
  source: SheetSource;
  account: ExternalAccount | null;
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (patch: SheetSourceUpdateInput) => api.sheetSources.update(source.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheet-sources'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.sheetSources.delete(source.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheet-sources'] }),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.sheetSources.sync(source.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheet-sources'] }),
  });

  const accountLabel = account?.label ?? account?.accountEmail ?? 'unknown';
  const cat = source.categoryId ? categories.find((c) => c.id === source.categoryId) : null;
  const lastSynced = source.lastSyncedAt
    ? new Date(source.lastSyncedAt).toLocaleString()
    : 'never';
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit`;

  if (editing) {
    return (
      <EditRow
        initial={source}
        categories={categories}
        accountLabel={accountLabel}
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={(patch) => updateMutation.mutate(patch, { onSuccess: () => setEditing(false) })}
      />
    );
  }

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>{source.label}</span>
            {!source.enabled ? (
              <span className="text-xs text-muted-foreground">(disabled)</span>
            ) : null}
            {cat ? <span className="text-xs text-muted-foreground">· {cat.name}</span> : null}
            <span className="text-xs text-muted-foreground">· {source.syncCadence.toLowerCase()}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {accountLabel} · {source.sheetName ? `${source.sheetName}` : 'first tab'}
            {source.range ? ` · ${source.range}` : ''}
          </div>
          <div className="text-xs text-muted-foreground">
            Last synced: {lastSynced}
            {source.snapshot?.rowCount !== undefined ? ` · ${source.snapshot.rowCount} rows` : ''}
          </div>
          {source.lastError ? (
            <div className="text-xs text-destructive mt-1">
              <AlertCircle className="inline h-3 w-3" /> {source.lastError}
            </div>
          ) : null}
          {source.description ? (
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{source.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <a
            href={sheetUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Open in Google Sheets"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            title="Sync now"
          >
            <RefreshCw className={`h-3 w-3 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} title="Edit">
            <PencilIcon className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete "${source.label}"?`)) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            title="Delete"
          >
            <Trash2Icon className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewSourceRow({
  accounts,
  categories,
  onDone,
}: {
  accounts: ExternalAccount[];
  categories: Category[];
  onDone: () => void;
}) {
  const [externalAccountId, setExternalAccountId] = useState(accounts[0]?.id ?? '');
  const [spreadsheetIdOrUrl, setSpreadsheetIdOrUrl] = useState('');
  const [label, setLabel] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [range, setRange] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [syncCadence, setSyncCadence] = useState<SheetSyncCadence>('WEEKLY');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SheetSourceRegisterInput) => api.sheetSources.register(input),
    onSuccess: async (res) => {
      // Auto-sync the new source right away
      await api.sheetSources.sync(res.source.id).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['sheet-sources'] });
      onDone();
    },
  });

  return (
    <div className="rounded-md border border-dashed p-3 space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Google account</Label>
          <Select value={externalAccountId} onValueChange={setExternalAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a Google account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label || a.accountEmail}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "Finance — Debt"'
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Spreadsheet URL or ID</Label>
        <Input
          value={spreadsheetIdOrUrl}
          onChange={(e) => setSpreadsheetIdOrUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Tab name (optional)</Label>
          <Input
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder='e.g. "Sheet1" — blank = first tab'
          />
        </div>
        <div className="space-y-1">
          <Label>Range (optional)</Label>
          <Input
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder='e.g. "A1:F200" — blank = first 200 rows'
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description (read by the agent)</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder='e.g. "Top section is income. DEBT section has promotional APR expiry in column F — these are deadlines. Column K is expected payoff date."'
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Category anchor</Label>
          <Select
            value={categoryId || NONE}
            onValueChange={(v) => setCategoryId(v === NONE ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Optional" />
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
        <div className="space-y-1">
          <Label>Sync cadence</Label>
          <Select value={syncCadence} onValueChange={(v) => setSyncCadence(v as SheetSyncCadence)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUAL">Manual only</SelectItem>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={reminderEnabled}
              onCheckedChange={(v) => setReminderEnabled(v === true)}
            />
            <span>Pre-sync reminder</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={
            !externalAccountId ||
            !label.trim() ||
            !spreadsheetIdOrUrl.trim() ||
            mutation.isPending
          }
          onClick={() =>
            mutation.mutate({
              externalAccountId,
              spreadsheetIdOrUrl: spreadsheetIdOrUrl.trim(),
              label: label.trim(),
              sheetName: sheetName.trim() || null,
              range: range.trim() || null,
              description: description.trim() || null,
              categoryId: categoryId || null,
              syncCadence,
              preUpdateReminderEnabled: reminderEnabled,
            })
          }
        >
          <CheckIcon className="h-3 w-3" /> Register + sync
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          <XIcon className="h-3 w-3" /> Cancel
        </Button>
      </div>

      {mutation.isError ? (
        <p className="text-xs text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : 'Register failed'}
        </p>
      ) : null}
    </div>
  );
}

function EditRow({
  initial,
  categories,
  accountLabel,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: SheetSource;
  categories: Category[];
  accountLabel: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (patch: SheetSourceUpdateInput) => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [sheetName, setSheetName] = useState(initial.sheetName ?? '');
  const [range, setRange] = useState(initial.range ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [syncCadence, setSyncCadence] = useState<SheetSyncCadence>(initial.syncCadence);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [reminderEnabled, setReminderEnabled] = useState(initial.preUpdateReminderEnabled);

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="text-xs text-muted-foreground">{accountLabel}</div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Category</Label>
          <Select
            value={categoryId || NONE}
            onValueChange={(v) => setCategoryId(v === NONE ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Optional" />
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Tab name</Label>
          <Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Range</Label>
          <Input value={range} onChange={(e) => setRange(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Cadence</Label>
          <Select value={syncCadence} onValueChange={(v) => setSyncCadence(v as SheetSyncCadence)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUAL">Manual</SelectItem>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-1 text-sm">
          <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
          <span>Enabled</span>
        </label>
        <label className="flex items-end gap-2 pb-1 text-sm">
          <Checkbox
            checked={reminderEnabled}
            onCheckedChange={(v) => setReminderEnabled(v === true)}
          />
          <span>Pre-sync reminder</span>
        </label>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onSubmit({
              label: label.trim(),
              sheetName: sheetName.trim() || null,
              range: range.trim() || null,
              description: description.trim() || null,
              categoryId: categoryId || null,
              syncCadence,
              enabled,
              preUpdateReminderEnabled: reminderEnabled,
            })
          }
          disabled={!label.trim()}
        >
          <CheckIcon className="h-3 w-3" /> {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <XIcon className="h-3 w-3" /> Cancel
        </Button>
      </div>
    </div>
  );
}
