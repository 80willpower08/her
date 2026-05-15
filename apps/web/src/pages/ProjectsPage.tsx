// /projects — long-running narrative initiatives (VA claim, custody case, etc.)
// List view + detail (markdown body editor) + Import-from-paste flow.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Briefcase,
  Edit2,
  FileInput,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Category, Project, ProjectStatus } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChatPanel } from '@/components/ChatPanel';
import { cn } from '@/lib/utils';

const NONE = '__none__';

const STATUS_TONE: Record<ProjectStatus, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  PAUSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  COMPLETE: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  ARCHIVED: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
};

export function ProjectsPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  if (projectId) return <ProjectDetail projectId={projectId} />;
  return <ProjectsList />;
}

function ProjectsList() {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    refetchInterval: importing ? 3000 : false,
  });
  const projects = projectsQ.data?.projects ?? [];

  // If something's PAUSED (still importing), poll for updates.
  const anyImporting = projects.some((p) => p.status === 'PAUSED' && (p.description?.includes('processing') ?? false));
  useEffect(() => {
    setImporting(anyImporting);
  }, [anyImporting]);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="display text-3xl flex items-center gap-2">
            <Briefcase className="h-6 w-6" /> Projects
          </h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Long-running initiatives the agent should know about — claims, cases, searches,
            big undertakings. Each project has a markdown body the agent can read and update
            as situations evolve.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportButton />
          <Button size="sm" onClick={() => navigate('/projects/new')}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
      </header>

      {projectsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <Briefcase className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No projects yet. Use "Import" to paste an existing conversation or doc and
              have the agent structure it into a project + observations + tasks. Or start a
              blank project and discuss it with the agent.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const isProcessing =
    project.status === 'PAUSED' && (project.description?.includes('processing') ?? false);
  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-colors"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2 min-w-0">
            <span className="truncate">{project.title}</span>
            {project.alwaysInContext ? <Pin className="h-3 w-3 shrink-0" /> : null}
          </CardTitle>
          <Badge className={STATUS_TONE[project.status]} variant="secondary">
            {isProcessing ? 'processing…' : project.status.toLowerCase()}
          </Badge>
        </div>
        {project.description ? (
          <CardDescription className="line-clamp-2">{project.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0 pb-3 text-xs text-muted-foreground">
        {project.body.length > 0 ? `${project.body.length.toLocaleString()} chars · ` : ''}
        Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
        {project.nextActionAt ? ` · next ${new Date(project.nextActionAt).toLocaleDateString()}` : ''}
      </CardContent>
    </Card>
  );
}

function ImportButton() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [titleHint, setTitleHint] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [secondaryCategoryIds, setSecondaryCategoryIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const categories = categoriesQ.data?.categories ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      // If any files are present, use the multipart endpoint. Otherwise the
      // JSON one.
      if (files.length > 0) {
        return api.projects.importFiles({
          files,
          titleHint: titleHint.trim() || undefined,
          categoryId: categoryId || null,
          secondaryCategoryIds,
          pastedText: content.trim() || undefined,
        });
      }
      return api.projects.import({
        rawContent: content,
        titleHint: titleHint.trim() || null,
        categoryId: categoryId || null,
        secondaryCategoryIds,
      });
    },
    onSuccess: (res) => {
      setOpen(false);
      setContent('');
      setTitleHint('');
      setFiles([]);
      qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${res.project.id}`);
    },
  });

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    setFiles((prev) => [...prev, ...incoming].slice(0, 10));
  }
  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }
  function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  const canSubmit =
    !mutation.isPending && (files.length > 0 || content.trim().length >= 50);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <FileInput className="h-4 w-4" /> Import
      </Button>
    );
  }

  return (
    <Card className="fixed inset-0 z-50 m-auto h-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Import existing content</CardTitle>
          <Button size="icon" variant="ghost" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>
          Paste a Claude.ai conversation, a doc, an email thread — anything textual. The
          agent will read it, extract observations + tasks, and structure it into a
          project. Takes a few minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Title hint (optional)</Label>
          <Input
            value={titleHint}
            onChange={(e) => setTitleHint(e.target.value)}
            placeholder='e.g. "VA Disability Claim — PTSD"'
          />
        </div>
        <div className="space-y-1">
          <Label>Primary category (optional)</Label>
          <Select
            value={categoryId || NONE}
            onValueChange={(v) => setCategoryId(v === NONE ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Optional anchor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>(none)</SelectItem>
              {categories.map((c: Category) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CategoryMultiSelect
          label="Also belongs to (optional)"
          description="Additional categories — for projects that span multiple areas (e.g., VA claim = Health + Finance)."
          categories={categories}
          excludeId={categoryId || null}
          value={secondaryCategoryIds}
          onChange={setSecondaryCategoryIds}
        />
        <div className="space-y-1">
          <Label>Files (optional)</Label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
            }}
            className={cn(
              'rounded-md border-2 border-dashed p-4 text-center text-sm transition-colors',
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-border text-muted-foreground'
            )}
          >
            Drop files here, or{' '}
            <label className="text-primary underline cursor-pointer">
              browse
              <input
                type="file"
                multiple
                accept=".txt,.md,.docx,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="mt-1 text-xs">
              .txt · .md · .docx · .pdf · .jpg/.png/.webp (vision OCR) — up to 10 files, 25MB each
            </p>
          </div>
          {files.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {files.map((f) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs"
                >
                  <span className="truncate">{f.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    {humanSize(f.size)}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeFile(f.name)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label>Pasted text (optional)</Label>
          <Textarea
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste anything — text only, agent will figure it out."
          />
          <p className="text-xs text-muted-foreground">
            {content.length.toLocaleString()} chars
            {files.length === 0 && content.length > 0 && content.length < 50
              ? ' (need at least 50 if no files)'
              : ''}
          </p>
        </div>
        {mutation.isError ? (
          <p className="text-xs text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : 'Import failed'}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? 'Importing…'
              : files.length > 0
                ? `Import ${files.length} file${files.length === 1 ? '' : 's'}${content.trim() ? ' + text' : ''}`
                : 'Import + process'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = projectId === 'new';
  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
    enabled: !isNew,
    refetchInterval: (q) => {
      const p = q.state.data?.project;
      // If processing import, poll faster
      const processing = p?.status === 'PAUSED' && (p.description?.includes('processing') ?? false);
      return processing ? 3000 : false;
    },
  });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const categories = categoriesQ.data?.categories ?? [];

  if (isNew) {
    return <NewProjectForm onCreated={(p) => navigate(`/projects/${p.id}`, { replace: true })} />;
  }

  if (projectQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const project = projectQ.data?.project;
  if (!project) return <p className="text-sm text-muted-foreground">Project not found.</p>;

  return (
    <ProjectEditor project={project} categories={categories} qc={qc} navigate={navigate} />
  );
}

function NewProjectForm({ onCreated }: { onCreated: (p: Project) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [secondaryCategoryIds, setSecondaryCategoryIds] = useState<string[]>([]);
  const [alwaysInContext, setAlwaysInContext] = useState(false);
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const categories = categoriesQ.data?.categories ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api.projects.create({
        title: title.trim(),
        description: description.trim() || null,
        primaryCategoryId: categoryId || null,
        secondaryCategoryIds,
        alwaysInContext,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      onCreated(res.project);
    },
  });

  return (
    <div className="space-y-4 max-w-2xl">
      <header>
        <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
          <ArrowLeft className="h-3 w-3" /> Back to projects
        </Button>
        <h1 className="display text-3xl mt-2">New project</h1>
      </header>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "VA Disability Claim — PTSD"'
            />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary of what this project is."
            />
          </div>
          <div className="space-y-1">
            <Label>Primary category</Label>
            <Select
              value={categoryId || NONE}
              onValueChange={(v) => setCategoryId(v === NONE ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>(none)</SelectItem>
                {categories.map((c: Category) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Lead category — used for default badge + anchor.
            </p>
          </div>
          <CategoryMultiSelect
            label="Also belongs to (optional)"
            description="Additional categories — project shows up in those chats too."
            categories={categories}
            excludeId={categoryId || null}
            value={secondaryCategoryIds}
            onChange={setSecondaryCategoryIds}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alwaysInContext}
              onChange={(e) => setAlwaysInContext(e.target.checked)}
            />
            <span>Always in context — agent sees this project on every run</span>
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!title.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              <Save className="h-3 w-3" /> Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/projects')}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectEditor({
  project,
  categories,
  qc,
  navigate,
}: {
  project: Project;
  categories: Category[];
  qc: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(project.body);
  const [titleDraft, setTitleDraft] = useState(project.title);
  const [descDraft, setDescDraft] = useState(project.description ?? '');
  const [primaryDraft, setPrimaryDraft] = useState(project.primaryCategoryId ?? '');
  const [secondaryDraft, setSecondaryDraft] = useState<string[]>(project.secondaryCategoryIds ?? []);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    setBodyDraft(project.body);
    setTitleDraft(project.title);
    setDescDraft(project.description ?? '');
    setPrimaryDraft(project.primaryCategoryId ?? '');
    setSecondaryDraft(project.secondaryCategoryIds ?? []);
  }, [project.id, project.body, project.title, project.description, project.primaryCategoryId, project.secondaryCategoryIds]);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.projects.update>[1]) =>
      api.projects.update(project.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setEditing(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.projects.delete(project.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
    },
  });

  const cat = project.primaryCategoryId
    ? categories.find((c) => c.id === project.primaryCategoryId)
    : null;
  const secondaryCats = project.secondaryCategoryIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => Boolean(c));
  const isProcessing =
    project.status === 'PAUSED' && (project.description?.includes('processing') ?? false);

  return (
    <div className="space-y-4 max-w-3xl">
      <header className="space-y-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
          <ArrowLeft className="h-3 w-3" /> Back to projects
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="text-xl font-semibold"
              />
            ) : (
              <h1 className="display text-3xl flex items-center gap-2">
                {project.title}
                {project.alwaysInContext ? (
                  <Pin className="h-4 w-4 text-muted-foreground" />
                ) : null}
              </h1>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge className={STATUS_TONE[project.status]} variant="secondary">
                {isProcessing ? 'processing…' : project.status.toLowerCase()}
              </Badge>
              {cat ? <span>· {cat.name}</span> : null}
              {secondaryCats.length ? (
                <span>· also {secondaryCats.map((c) => c.name).join(', ')}</span>
              ) : null}
              <span>· Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}</span>
              <span>· {project.body.length.toLocaleString()} chars</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="secondary" onClick={() => setChatOpen(true)}>
              <MessageSquare className="h-3 w-3" /> Discuss
            </Button>
            {editing ? null : (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  <Edit2 className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete project "${project.title}"?`)) deleteMutation.mutate();
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>
        {editing ? (
          <>
            <Textarea
              rows={2}
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              placeholder="Description"
            />
            <Card>
              <CardContent className="space-y-3 pt-4">
                <div className="space-y-1">
                  <Label>Primary category</Label>
                  <Select
                    value={primaryDraft || NONE}
                    onValueChange={(v) => setPrimaryDraft(v === NONE ? '' : v)}
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
                <CategoryMultiSelect
                  label="Also belongs to"
                  description="Additional categories — project shows up in those chats too."
                  categories={categories}
                  excludeId={primaryDraft || null}
                  value={secondaryDraft.filter((id) => id !== primaryDraft)}
                  onChange={setSecondaryDraft}
                />
              </CardContent>
            </Card>
          </>
        ) : project.description ? (
          <p className="text-sm text-muted-foreground">{project.description}</p>
        ) : null}
      </header>

      <Card>
        <CardContent className={cn('pt-6', editing ? '' : '')}>
          {editing ? (
            <Textarea
              rows={28}
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              className="font-mono text-sm"
              placeholder="Markdown body — accumulated history, drafts, status."
            />
          ) : project.body.trim().length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No body content yet. Click Edit to add some, or open Discuss to have the
              agent draft it from a paste.
            </p>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-sm">{project.body}</pre>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <div className="flex items-center gap-2 sticky bottom-4 bg-background border rounded-md p-2 shadow-md">
          <Button
            size="sm"
            onClick={() =>
              updateMutation.mutate({
                title: titleDraft.trim(),
                description: descDraft.trim() || null,
                body: bodyDraft,
                primaryCategoryId: primaryDraft || null,
                secondaryCategoryIds: secondaryDraft.filter((id) => id !== primaryDraft),
              })
            }
            disabled={!titleDraft.trim() || updateMutation.isPending}
          >
            <Save className="h-3 w-3" /> Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              updateMutation.mutate({ alwaysInContext: !project.alwaysInContext })
            }
            title={project.alwaysInContext ? 'Remove from always-in-context' : 'Always in context'}
          >
            {project.alwaysInContext ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            {project.alwaysInContext ? 'Unpin' : 'Pin'}
          </Button>
          <Select
            value={project.status}
            onValueChange={(v) =>
              updateMutation.mutate({ status: v as ProjectStatus })
            }
          >
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PAUSED">Paused</SelectItem>
              <SelectItem value="COMPLETE">Complete</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <ChatPanel
        anchorType="project"
        anchorId={project.id}
        anchorLabel={project.title}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}

function CategoryMultiSelect({
  label,
  description,
  categories,
  excludeId,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  categories: Category[];
  excludeId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };
  const eligible = categories.filter((c) => c.id !== excludeId);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {eligible.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No other categories.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {eligible.map((c) => {
            const on = value.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => toggle(c.id)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent'
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
