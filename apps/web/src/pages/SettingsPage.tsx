import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Archive, MessageSquare } from 'lucide-react';
import { ChatPanel } from '@/components/ChatPanel';
import type { Category } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WeightSlider } from '@/components/WeightSlider';
import { AccountsSection } from '@/components/AccountsSection';
import { CalendarSourcesSection } from '@/components/CalendarSourcesSection';
import { SheetSourcesSection } from '@/components/SheetSourcesSection';
import { DataSourcesSection } from '@/components/DataSourcesSection';
import { NotificationsSection } from '@/components/NotificationsSection';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { cn } from '@/lib/utils';

const PRESET_COLORS = [
  '#6366f1',
  '#10b981',
  '#0ea5e9',
  '#f59e0b',
  '#8b5cf6',
  '#f43f5e',
  '#64748b',
  '#ef4444',
  '#14b8a6',
];

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Tune what drives prioritization, and connect your data sources.
        </p>
      </div>

      <CollapsibleSection
        storageKey="settings/accounts"
        title="Connected accounts"
        description="Calendar and email/drive sources. Set a label and a default category per account."
        defaultOpen
      >
        <AccountsSection />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="settings/calendar-sources"
        title="Calendar sources"
        description="Per-calendar labels and category mapping for the calendars under each connected account."
      >
        <CalendarSourcesSection />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="settings/sheet-sources"
        title="Google Sheets sources"
        description="Register specific Google Sheets the agent should read. Use the description field to tell the agent how to interpret each column."
      >
        <SheetSourcesSection />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="settings/data-sources"
        title="Data sources (other apps)"
        description="Register read-only HTTP feeds from your other self-hosted apps. Agent reads the response as context."
      >
        <DataSourcesSection />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="settings/categories"
        title="Categories"
        description='Each category is a life-area. Higher weight = more rank pull when nothing else differentiates two tasks. You can split "Work" into multiple if you have several jobs.'
      >
        <CategoryManager />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="settings/notifications"
        title="Notifications"
        description="Push reminders for tasks and calendar events. Quiet hours mute non-urgent ones."
      >
        <NotificationsSection />
      </CollapsibleSection>
    </div>
  );
}

function CategoryManager() {
  const queryClient = useQueryClient();
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const categories = categoriesQ.data?.categories ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { weight?: number; name?: string; color?: string; archived?: boolean } }) =>
      api.categories.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: { name: string; color: string; weight: number }) =>
      api.categories.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setCreating(false);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New category
        </Button>
      </div>
      {creating && (
        <CreateCategoryRow
          onCancel={() => setCreating(false)}
          onCreate={(input) => createMutation.mutate(input)}
          saving={createMutation.isPending}
        />
      )}
      {categories.map((c) =>
        editingId === c.id ? (
          <EditCategoryRow
            key={c.id}
            category={c}
            onCancel={() => setEditingId(null)}
            onSave={(patch) =>
              updateMutation.mutate({ id: c.id, patch }, { onSuccess: () => setEditingId(null) })
            }
            saving={updateMutation.isPending}
          />
        ) : (
          <DisplayCategoryRow
            key={c.id}
            category={c}
            onWeightCommit={(weight) => updateMutation.mutate({ id: c.id, patch: { weight } })}
            onEdit={() => setEditingId(c.id)}
            onArchive={() => {
              if (
                confirm(
                  `Archive "${c.name}"? It'll be hidden from pickers, but existing tasks will keep their reference.`
                )
              ) {
                updateMutation.mutate({ id: c.id, patch: { archived: true } });
              }
            }}
          />
        )
      )}
    </div>
  );
}

function DisplayCategoryRow({
  category,
  onWeightCommit,
  onEdit,
  onArchive,
}: {
  category: Category;
  onWeightCommit: (w: number) => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [w, setW] = useState(category.weight);
  const [chatOpen, setChatOpen] = useState(false);
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const id = setTimeout(() => onWeightCommit(w), 400);
    return () => clearTimeout(id);
  }, [w, onWeightCommit]);

  // Sync external changes (e.g., name edit) into local weight if it changed externally
  useEffect(() => {
    setW(category.weight);
  }, [category.weight]);

  return (
    <div className="grid grid-cols-[1fr_1.5fr_auto] gap-4 items-center">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ background: category.color }}
        />
        <span className="text-sm font-medium truncate">{category.name}</span>
      </div>
      <WeightSlider value={w} onChange={setW} />
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Discuss with agent"
          onClick={() => setChatOpen(true)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          title="Archive"
          onClick={onArchive}
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ChatPanel
        anchorType="category"
        anchorId={category.id}
        anchorLabel={category.name}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}

function EditCategoryRow({
  category,
  onCancel,
  onSave,
  saving,
}: {
  category: Category;
  onCancel: () => void;
  onSave: (patch: { name: string; color: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);

  return (
    <div className="rounded-md border p-3 space-y-3 bg-secondary/20">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave({ name: name.trim(), color })} disabled={!name.trim() || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function CreateCategoryRow({
  onCancel,
  onCreate,
  saving,
}: {
  onCancel: () => void;
  onCreate: (input: { name: string; color: string; weight: number }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [weight, setWeight] = useState(5);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), color, weight });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-dashed p-3 space-y-3 bg-secondary/10"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Work — Security, Family"
            autoFocus
            required
          />
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
      <WeightSlider value={weight} onChange={setWeight} label="Initial weight" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!name.trim() || saving}>
          {saving ? 'Saving…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
