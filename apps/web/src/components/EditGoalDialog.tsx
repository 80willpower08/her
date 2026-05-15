import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Lock } from 'lucide-react';
import type { Category, Goal, GoalCategoryMapping } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { WeightSlider } from '@/components/WeightSlider';

const dateInputValue = (iso: string | null) => {
  if (!iso) return '';
  return iso.slice(0, 10);
};

interface EditGoalDialogProps {
  goal: Goal;
  categories: Category[];
  /** All goals — used for the prerequisite picker. */
  allGoals?: Goal[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditGoalDialog({ goal, categories, allGoals = [], open, onOpenChange }: EditGoalDialogProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description ?? '');
  const [primaryCategoryId, setPrimaryCategoryId] = useState(goal.primaryCategoryId ?? '');
  const [weight, setWeight] = useState(goal.weight);
  const [targetDate, setTargetDate] = useState(dateInputValue(goal.targetDate));
  const [secondaries, setSecondaries] = useState<{ categoryId: string; percentage: number }[]>(
    goal.categoryMappings.filter((m) => !m.isPrimary).map((m) => ({ categoryId: m.categoryId, percentage: m.percentage }))
  );

  useEffect(() => {
    setTitle(goal.title);
    setDescription(goal.description ?? '');
    setPrimaryCategoryId(goal.primaryCategoryId ?? '');
    setWeight(goal.weight);
    setTargetDate(dateInputValue(goal.targetDate));
    setSecondaries(
      goal.categoryMappings.filter((m) => !m.isPrimary).map((m) => ({
        categoryId: m.categoryId,
        percentage: m.percentage,
      }))
    );
  }, [goal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['goals'] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
    queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  const saveCoreMutation = useMutation({
    mutationFn: () =>
      api.goals.update(goal.id, {
        title,
        description: description || null,
        primaryCategoryId: primaryCategoryId || null,
        weight,
        targetDate: targetDate ? new Date(targetDate).toISOString() : null,
      }),
    onSuccess: invalidate,
  });

  const saveCategoriesMutation = useMutation({
    mutationFn: () => {
      const mappings: GoalCategoryMapping[] = [];
      if (primaryCategoryId) {
        mappings.push({ categoryId: primaryCategoryId, isPrimary: true, percentage: 100 });
      }
      for (const s of secondaries) {
        if (s.categoryId && s.categoryId !== primaryCategoryId) {
          mappings.push({ categoryId: s.categoryId, isPrimary: false, percentage: s.percentage });
        }
      }
      return api.goals.setCategories(goal.id, mappings);
    },
    onSuccess: invalidate,
  });

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    await saveCoreMutation.mutateAsync();
    await saveCategoriesMutation.mutateAsync();
    onOpenChange(false);
  }

  const usedCategoryIds = new Set([
    primaryCategoryId,
    ...secondaries.map((s) => s.categoryId),
  ].filter(Boolean));

  const availableForSecondary = categories.filter(
    (c) => !usedCategoryIds.has(c.id) || true
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit goal</DialogTitle>
          <DialogDescription>
            Secondary categories receive a portion of this goal's progress, weighted by their percentage.
            They're additive — secondaries don't reduce the primary's contribution.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="g-title">Title</Label>
            <Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="g-desc">Description</Label>
            <Textarea
              id="g-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Primary category</Label>
              <Select value={primaryCategoryId} onValueChange={setPrimaryCategoryId}>
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
            <WeightSlider value={weight} onChange={setWeight} label="Weight" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="g-target">Target date</Label>
            <Input
              id="g-target"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Secondary categories
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSecondaries((s) => [...s, { categoryId: '', percentage: 30 }])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            {secondaries.length === 0 && (
              <p className="text-xs text-muted-foreground">
                None yet. Add a secondary if this goal also helps another life-area.
              </p>
            )}
            {secondaries.map((s, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={s.categoryId}
                  onValueChange={(v) =>
                    setSecondaries((arr) =>
                      arr.map((x, i) => (i === idx ? { ...x, categoryId: v } : x))
                    )
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pick" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableForSecondary
                      .filter((c) => c.id !== primaryCategoryId)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 min-w-[140px]">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={s.percentage}
                    onChange={(e) =>
                      setSecondaries((arr) =>
                        arr.map((x, i) =>
                          i === idx ? { ...x, percentage: parseInt(e.target.value, 10) } : x
                        )
                      )
                    }
                    className="flex-1 accent-primary"
                  />
                  <span className="text-xs tabular-nums w-10 text-right">{s.percentage}%</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    setSecondaries((arr) => arr.filter((_, i) => i !== idx))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <Separator />

          <PrerequisiteEditor goal={goal} allGoals={allGoals} onChanged={invalidate} />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saveCoreMutation.isPending || saveCategoriesMutation.isPending}
            >
              {saveCoreMutation.isPending || saveCategoriesMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PrerequisiteEditor({
  goal,
  allGoals,
  onChanged,
}: {
  goal: Goal;
  allGoals: Goal[];
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const goalById = new Map(allGoals.map((g) => [g.id, g]));

  const addMutation = useMutation({
    mutationFn: (prereqId: string) => api.goals.addPrereq(goal.id, prereqId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      onChanged();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (prereqId: string) => api.goals.removePrereq(goal.id, prereqId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      onChanged();
    },
  });

  const prereqGoals = goal.prerequisiteIds
    .map((id) => goalById.get(id))
    .filter((g): g is Goal => Boolean(g));

  const candidates = allGoals.filter(
    (g) => g.id !== goal.id && !goal.prerequisiteIds.includes(g.id) && !g.archived
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Prerequisites
        </Label>
        {goal.isBlocked && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Lock className="h-3 w-3" /> Blocked
          </Badge>
        )}
      </div>
      {prereqGoals.length === 0 && (
        <p className="text-xs text-muted-foreground">
          None. Add one if this goal can't start until another goal completes (e.g. Architecting after Planning).
        </p>
      )}
      {prereqGoals.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-md border bg-secondary/30 px-3 py-1.5"
        >
          <span className="text-sm">
            {p.completed ? '✓ ' : '○ '}
            <span className={p.completed ? 'line-through text-muted-foreground' : ''}>
              {p.title}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => removeMutation.mutate(p.id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {candidates.length > 0 && (
        <Select onValueChange={(id) => addMutation.mutate(id)} value="">
          <SelectTrigger className="text-muted-foreground">
            <span className="inline-flex items-center gap-2 text-sm">
              <Plus className="h-3.5 w-3.5" /> Add prerequisite goal
            </span>
          </SelectTrigger>
          <SelectContent>
            {candidates.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
