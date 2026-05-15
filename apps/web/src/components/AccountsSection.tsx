import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Trash2, AlertCircle, Check, Pencil } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Category, ExternalAccount } from '@time-keeper/shared';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const STATUS_COLOR: Record<ExternalAccount['status'], string> = {
  ACTIVE: 'text-emerald-600',
  NEEDS_REAUTH: 'text-amber-600',
  ERROR: 'text-destructive',
  DISCONNECTED: 'text-muted-foreground',
};

const PRESET_COLORS = [
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#f43f5e', // rose
  '#6366f1', // indigo
  '#64748b', // slate
];

export function AccountsSection() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const accountsQ = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts.list() });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const categories = categoriesQ.data?.categories ?? [];

  const accountStatus = searchParams.get('account');
  const reason = searchParams.get('reason');
  useEffect(() => {
    if (accountStatus === 'connected') {
      setBanner({ kind: 'success', text: 'Account connected.' });
      const sp = new URLSearchParams(searchParams);
      sp.delete('account');
      sp.delete('reason');
      setSearchParams(sp, { replace: true });
    } else if (accountStatus === 'error') {
      setBanner({ kind: 'error', text: `Connection failed: ${reason ?? 'unknown'}` });
      const sp = new URLSearchParams(searchParams);
      sp.delete('account');
      sp.delete('reason');
      setSearchParams(sp, { replace: true });
    }
  }, [accountStatus, reason]); // eslint-disable-line react-hooks/exhaustive-deps

  const startGoogleMutation = useMutation({
    mutationFn: () => api.accounts.startGoogle(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Failed to start OAuth';
      setBanner({ kind: 'error', text: msg });
    },
  });

  const startMicrosoftMutation = useMutation({
    mutationFn: () => api.accounts.startMicrosoft(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Failed to start OAuth';
      setBanner({ kind: 'error', text: msg });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.accounts.disconnect(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.accounts.sync(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <>
      {banner && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
              banner.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-900 dark:text-emerald-200'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            )}
          >
            {banner.kind === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{banner.text}</span>
          </div>
        )}

        {accounts.length === 0 && !accountsQ.isLoading && (
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        )}

        {accounts.map((acc) => {
          const defaultCat = acc.defaultCategoryId ? categoryById.get(acc.defaultCategoryId) : null;
          if (editingId === acc.id) {
            return (
              <AccountEditRow
                key={acc.id}
                account={acc}
                categories={categories}
                onClose={() => setEditingId(null)}
              />
            );
          }
          return (
            <div
              key={acc.id}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: acc.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {acc.label ?? acc.accountEmail ?? acc.provider}
                  </span>
                  {acc.label && (
                    <span className="text-xs text-muted-foreground truncate">
                      {acc.accountEmail}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {acc.provider}
                  </Badge>
                  {defaultCat && (
                    <Badge variant="outline" className="gap-1.5 text-[10px]">
                      <span className="h-2 w-2 rounded-full" style={{ background: defaultCat.color }} />
                      → {defaultCat.name}
                    </Badge>
                  )}
                  <span className={cn('text-xs', STATUS_COLOR[acc.status])}>
                    {acc.status.toLowerCase().replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {acc.lastSyncedAt
                    ? `Synced ${formatDistanceToNow(new Date(acc.lastSyncedAt), { addSuffix: true })}`
                    : 'Never synced'}
                  {acc.lastError && ` · ${acc.lastError}`}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Edit"
                  onClick={() => setEditingId(acc.id)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Sync now"
                  onClick={() => syncMutation.mutate(acc.id)}
                  disabled={syncMutation.isPending}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', syncMutation.isPending && 'animate-spin')} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title="Disconnect"
                  onClick={() => {
                    if (confirm(`Disconnect ${acc.accountEmail}?`)) disconnectMutation.mutate(acc.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => startGoogleMutation.mutate()}
            disabled={startGoogleMutation.isPending}
          >
            <Plus className="h-4 w-4" />
            Connect Google
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => startMicrosoftMutation.mutate()}
            disabled={startMicrosoftMutation.isPending}
          >
            <Plus className="h-4 w-4" />
            Connect Microsoft
          </Button>
        </div>
    </>
  );
}

function AccountEditRow({
  account,
  categories,
  onClose,
}: {
  account: ExternalAccount;
  categories: Category[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(account.label ?? '');
  const [color, setColor] = useState(account.color);
  const [defaultCategoryId, setDefaultCategoryId] = useState(account.defaultCategoryId ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      api.accounts.update(account.id, {
        label: label.trim() || null,
        color,
        defaultCategoryId: defaultCategoryId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      onClose();
    },
  });

  return (
    <div className="rounded-md border p-3 space-y-3 bg-secondary/20">
      <div className="text-xs text-muted-foreground">
        {account.accountEmail} · {account.provider}
      </div>
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Label</Label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Job 1 — Security, Personal, Family"
          maxLength={100}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Default category</Label>
          <Select value={defaultCategoryId} onValueChange={setDefaultCategoryId}>
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
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Color</Label>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-transform',
                  color === c ? 'border-foreground scale-110' : 'border-transparent'
                )}
                style={{ background: c }}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Tasks pinned to this account's events will inherit the default category if they don't already have one.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
