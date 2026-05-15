// Settings → Data sources. Generic HTTP feeds from other self-hosted apps.
// Read-only. Cookie-login flow handled server-side.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckIcon,
  ExternalLink,
  PencilIcon,
  RefreshCw,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import type {
  Category,
  DataSource,
  DataSourceAuthMode,
  DataSourceCreateInput,
  DataSourceSyncCadence,
  DataSourceUpdateInput,
} from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const NONE = '__none__';

export function DataSourcesSection() {
  const qc = useQueryClient();
  const sourcesQ = useQuery({
    queryKey: ['data-sources'],
    queryFn: () => api.dataSources.list(),
  });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const sources = sourcesQ.data?.sources ?? [];
  const categories = categoriesQ.data?.categories ?? [];

  const [creating, setCreating] = useState(false);

  return (
    <>
        {sources.length === 0 && !creating ? (
          <p className="text-sm text-muted-foreground">
            None yet. Click "Add data source" to register a feed.
          </p>
        ) : null}

        {sources.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            categories={categories}
            onChange={() => qc.invalidateQueries({ queryKey: ['data-sources'] })}
          />
        ))}

        {creating ? (
          <NewSourceRow categories={categories} onDone={() => setCreating(false)} />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            Add data source
          </Button>
        )}
    </>
  );
}

function SourceRow({
  source,
  categories,
  onChange,
}: {
  source: DataSource;
  categories: Category[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: () => api.dataSources.sync(source.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-sources'] });
      onChange();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.dataSources.delete(source.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-sources'] });
      onChange();
    },
  });

  const cat = source.categoryId ? categories.find((c) => c.id === source.categoryId) : null;
  const lastSynced = source.lastSyncedAt
    ? new Date(source.lastSyncedAt).toLocaleString()
    : 'never';
  const size = source.snapshot?.sizeBytes
    ? source.snapshot.sizeBytes < 1024
      ? `${source.snapshot.sizeBytes} B`
      : source.snapshot.sizeBytes < 1024 * 1024
        ? `${(source.snapshot.sizeBytes / 1024).toFixed(1)} KB`
        : `${(source.snapshot.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : null;

  if (editing) {
    return (
      <EditRow
        initial={source}
        categories={categories}
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={async (patch) => {
          await api.dataSources.update(source.id, patch);
          qc.invalidateQueries({ queryKey: ['data-sources'] });
          setEditing(false);
        }}
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
            <span className="text-xs text-muted-foreground">
              · {source.syncCadence.toLowerCase()}
            </span>
            <span className="text-xs text-muted-foreground">· {source.authMode}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {source.baseUrl}
            {source.endpointPath}
          </div>
          <div className="text-xs text-muted-foreground">
            Last synced: {lastSynced}
            {size ? ` · ${size}` : ''}
            {source.snapshot?.truncated ? ' · truncated' : ''}
          </div>
          {source.lastError ? (
            <div className="mt-1 text-xs text-destructive">
              <AlertCircle className="inline h-3 w-3" /> {source.lastError}
            </div>
          ) : null}
          {source.description ? (
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{source.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <a
            href={source.baseUrl + source.endpointPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Open URL"
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
            <RefreshCw
              className={`h-3 w-3 ${syncMutation.isPending ? 'animate-spin' : ''}`}
            />
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
  categories,
  onDone,
}: {
  categories: Category[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: DataSourceCreateInput) => {
      const res = await api.dataSources.create(input);
      // Auto-sync after create
      await api.dataSources.sync(res.source.id).catch(() => undefined);
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-sources'] });
      onDone();
    },
  });

  return (
    <EditRow
      initial={null}
      categories={categories}
      submitLabel="Register + sync"
      onCancel={onDone}
      onSubmit={(input) =>
        mutation.mutate({
          label: input.label ?? '',
          description: input.description ?? null,
          baseUrl: input.baseUrl ?? '',
          endpointPath: input.endpointPath ?? '',
          authMode: input.authMode ?? 'NONE',
          authConfig: input.authConfig ?? null,
          staticHeaders: input.staticHeaders ?? null,
          categoryId: input.categoryId ?? null,
          syncCadence: input.syncCadence ?? 'DAILY',
          enabled: input.enabled ?? true,
        })
      }
    />
  );
}

interface EditRowProps {
  initial: DataSource | null;
  categories: Category[];
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (patch: DataSourceUpdateInput) => void;
}

function EditRow({ initial, categories, submitLabel, onCancel, onSubmit }: EditRowProps) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [endpointPath, setEndpointPath] = useState(initial?.endpointPath ?? '');
  const [authMode, setAuthMode] = useState<DataSourceAuthMode>(initial?.authMode ?? 'NONE');
  const [authConfigText, setAuthConfigText] = useState(
    initial?.authConfig ? JSON.stringify(initial.authConfig, null, 2) : ''
  );
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [syncCadence, setSyncCadence] = useState<DataSourceSyncCadence>(
    initial?.syncCadence ?? 'DAILY'
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [parseError, setParseError] = useState('');

  function submit() {
    let authConfig: Record<string, unknown> | null = null;
    if (authMode !== 'NONE' && authConfigText.trim()) {
      try {
        authConfig = JSON.parse(authConfigText);
      } catch {
        setParseError('Auth config is not valid JSON.');
        return;
      }
    }
    setParseError('');
    onSubmit({
      label: label.trim(),
      description: description.trim() || null,
      baseUrl: baseUrl.trim().replace(/\/$/, ''),
      endpointPath: endpointPath.trim().startsWith('/')
        ? endpointPath.trim()
        : `/${endpointPath.trim()}`,
      authMode,
      authConfig,
      categoryId: categoryId || null,
      syncCadence,
      enabled,
    });
  }

  const authConfigHint = (() => {
    switch (authMode) {
      case 'NONE':
        return 'No auth config needed.';
      case 'BEARER':
        return '{ "token": "your-bearer-token" }';
      case 'BASIC':
        return '{ "username": "...", "password": "..." }';
      case 'COOKIE_LOGIN':
        return '{ "loginPath": "/api/auth/login", "loginBody": { "username": "...", "password": "..." } }';
      case 'CUSTOM_HEADERS':
        return '{ "headers": { "X-API-Key": "..." } }';
    }
  })();

  return (
    <div className="rounded-md border border-dashed p-3 space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='"Curator — Items"'
          />
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
          <Label>Base URL</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://curator.phnet.me"
          />
        </div>
        <div className="space-y-1">
          <Label>Endpoint path</Label>
          <Input
            value={endpointPath}
            onChange={(e) => setEndpointPath(e.target.value)}
            placeholder="/api/items?limit=200"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description (read by the agent)</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this feed return? How should the agent interpret it?"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Auth mode</Label>
          <Select value={authMode} onValueChange={(v) => setAuthMode(v as DataSourceAuthMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">None</SelectItem>
              <SelectItem value="BEARER">Bearer token</SelectItem>
              <SelectItem value="BASIC">Basic auth</SelectItem>
              <SelectItem value="COOKIE_LOGIN">Cookie login</SelectItem>
              <SelectItem value="CUSTOM_HEADERS">Custom headers</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Sync cadence</Label>
          <Select
            value={syncCadence}
            onValueChange={(v) => setSyncCadence(v as DataSourceSyncCadence)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUAL">Manual only</SelectItem>
              <SelectItem value="HOURLY">Hourly</SelectItem>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <span>Enabled</span>
          </label>
        </div>
      </div>

      {authMode !== 'NONE' ? (
        <div className="space-y-1">
          <Label>Auth config (JSON)</Label>
          <Textarea
            rows={5}
            value={authConfigText}
            onChange={(e) => setAuthConfigText(e.target.value)}
            placeholder={authConfigHint}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Shape: <code>{authConfigHint}</code>
          </p>
          {parseError ? (
            <p className="text-xs text-destructive">{parseError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" disabled={!label.trim() || !baseUrl.trim() || !endpointPath.trim()} onClick={submit}>
          <CheckIcon className="h-3 w-3" /> {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <XIcon className="h-3 w-3" /> Cancel
        </Button>
      </div>
    </div>
  );
}
