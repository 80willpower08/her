import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Inbox, Loader2 } from 'lucide-react';
import type { SharedItem } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { clearStagedShare, readStagedShare } from '@/lib/share-staging';

const LAST_ACCOUNT_KEY = 'tk:share:lastAccountId';
const LAST_CATEGORY_KEY = 'tk:share:lastCategoryId';

export function ShareReceivePage() {
  const [searchParams] = useSearchParams();
  const stagedId = searchParams.get('id');
  const messageId = searchParams.get('messageId');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [share, setShare] = useState<SharedItem | null>(null);
  const [stagingError, setStagingError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const accountId = localStorage.getItem(LAST_ACCOUNT_KEY) ?? '';
  const [categoryId, setCategoryId] = useState<string>(() => localStorage.getItem(LAST_CATEGORY_KEY) ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const categories = categoriesQ.data?.categories ?? [];

  // Step 1: hydrate the SharedItem either from IndexedDB stage (fresh share)
  // or from the API (retroactive triage from inbox).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (messageId) {
          const { share: existing } = await api.share.get(messageId);
          if (cancelled) return;
          setShare(existing);
          setTitle(existing.subject);
          setBody(existing.bodyText ?? existing.snippet ?? '');
          return;
        }
        if (!stagedId) {
          setStagingError('No staged share id in URL');
          return;
        }
        const s = await readStagedShare(stagedId);
        if (!s) {
          setStagingError('Staged share not found (already triaged or expired?)');
          return;
        }
        if (cancelled) return;
        setTitle(s.title || (s.text.split('\n')[0] || '').slice(0, 200) || 'Shared item');
        setBody(s.text || '');

        const submitted = await api.share.submit({
          title: s.title,
          text: s.text,
          url: s.url,
        });
        if (cancelled) return;
        setShare(submitted.share);
      } catch (err) {
        if (!cancelled) setStagingError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stagedId, messageId]);

  const sharedUrl = share?.sourceUrl || '';

  const finishMutation = useMutation({
    mutationFn: async (kind: 'task' | 'note' | 'discard') => {
      if (!share) throw new Error('Share not yet persisted');

      if (kind === 'task') {
        if (!title.trim()) throw new Error('Title required');
        if (!categoryId) throw new Error('Category required');
        const trailer = sharedUrl ? `\n\nSource: ${sharedUrl}` : '';
        await api.tasks.create({
          title: title.trim(),
          description: (body.trim() ? body.trim() : null) + (trailer || ''),
          categoryId: categoryId,
          weight: 5,
        });
        localStorage.setItem(LAST_CATEGORY_KEY, categoryId);
        await api.share.triage(share.id, 'CONVERTED_TO_TASK', accountId || null);
      } else if (kind === 'note') {
        if (categoryId) localStorage.setItem(LAST_CATEGORY_KEY, categoryId);
        await api.share.triage(share.id, 'NOTED', accountId || null);
      } else {
        await api.share.triage(share.id, 'DISCARDED', accountId || null);
      }

      if (accountId) localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
      if (stagedId) await clearStagedShare(stagedId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      navigate('/today');
    },
  });

  function handleAction(kind: 'task' | 'note' | 'discard') {
    setValidationError(null);
    if (kind === 'task' && !categoryId) {
      setValidationError('Pick a category before converting to a task — the agent uses this for tagging.');
      return;
    }
    finishMutation.mutate(kind);
  }

  if (stagingError) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Couldn't open share</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{stagingError}</p>
            <Button variant="secondary" onClick={() => navigate('/today')}>
              Back to Today
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Saving share...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Triage shared item
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sharedUrl ? (
            <a
              href={sharedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {sharedUrl}
            </a>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="share-title">Title</Label>
            <Input id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="share-body">Body</Label>
            <Textarea
              id="share-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              Category
              <span className="text-xs text-destructive">*</span>
            </Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Tag with which life-area / job?" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Required for Convert-to-Task. The agent uses this for prioritization.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button onClick={() => handleAction('task')} disabled={finishMutation.isPending}>
          Convert to Task
        </Button>
        <Button
          variant="secondary"
          onClick={() => handleAction('note')}
          disabled={finishMutation.isPending}
        >
          Save for context
        </Button>
        <Button
          variant="ghost"
          onClick={() => handleAction('discard')}
          disabled={finishMutation.isPending}
        >
          Discard
        </Button>
      </div>

      {validationError ? (
        <p className="text-sm text-destructive">{validationError}</p>
      ) : null}

      {finishMutation.isError ? (
        <p className="text-sm text-destructive">
          {finishMutation.error instanceof Error
            ? finishMutation.error.message
            : 'Failed to triage'}
        </p>
      ) : null}
    </div>
  );
}
