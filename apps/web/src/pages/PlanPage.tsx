// /plan — the planning surface. Left sidebar tree of work-stuff, right pane
// renders the selected view. Mobile: tree becomes a top accordion drawer.

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarCheck2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Layers,
  ListChecks,
  Menu,
  Target,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TodayPage } from './TodayPage';
import { ListPage } from './ListPage';
import { GoalsPage } from './GoalsPage';
import { ProjectsPage } from './ProjectsPage';
import { OverviewPage } from './OverviewPage';

type Section = 'today' | 'all' | 'goals' | 'projects' | 'categories';

interface TreeProps {
  active: Section | null;
  activeId?: string;
  onPick: (section: Section, id?: string) => void;
}

export function PlanPage() {
  const params = useParams<{ section?: string; id?: string }>();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const section = (params.section ?? 'today') as Section;
  const id = params.id;

  function go(next: Section, nextId?: string) {
    // Project items deep-link out to their detail page (which has Discuss +
    // markdown editor). Goals/Categories have no detail page; clicking an
    // item just goes to the section list.
    if (next === 'projects' && nextId) {
      navigate(`/projects/${nextId}`);
    } else {
      navigate(`/plan/${next}`);
    }
    setMobileMenuOpen(false);
  }

  return (
    <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-6 lg:h-[calc(100vh-7rem)]">
      <aside className="lg:overflow-y-auto lg:pr-2">
        {/* Mobile toggle */}
        <div className="lg:hidden mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="w-full justify-start"
          >
            <Menu className="h-4 w-4" />
            {sectionLabel(section, id)}
          </Button>
        </div>
        <div className={cn(!mobileMenuOpen && 'hidden lg:block')}>
          <PlanTree active={section} activeId={id} onPick={go} />
        </div>
      </aside>

      <section className="lg:overflow-y-auto">
        {section === 'today' ? (
          <TodayPage />
        ) : section === 'all' ? (
          <ListPage />
        ) : section === 'goals' ? (
          <GoalsPage />
        ) : section === 'projects' ? (
          <ProjectsPage />
        ) : section === 'categories' ? (
          <OverviewPage />
        ) : (
          <TodayPage />
        )}
      </section>
    </div>
  );
}

function sectionLabel(section: Section, id?: string): string {
  if (id) return `${labelFor(section)} · selected`;
  return labelFor(section);
}
function labelFor(section: Section): string {
  switch (section) {
    case 'today':
      return "Today's tasks";
    case 'all':
      return 'All tasks';
    case 'goals':
      return 'Goals';
    case 'projects':
      return 'Projects';
    case 'categories':
      return 'Categories (overview)';
  }
}

function PlanTree({ active, activeId, onPick }: TreeProps) {
  const goalsQ = useQuery({ queryKey: ['goals'], queryFn: () => api.goals.list() });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.projects.list() });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list() });
  const goals = goalsQ.data?.goals ?? [];
  const projects = projectsQ.data?.projects ?? [];
  const categories = categoriesQ.data?.categories ?? [];

  return (
    <nav className="space-y-1 text-sm">
      <TreeButton
        icon={<CalendarCheck2 className="h-4 w-4" />}
        label="Today's tasks"
        active={active === 'today'}
        onClick={() => onPick('today')}
      />
      <TreeButton
        icon={<ListChecks className="h-4 w-4" />}
        label="All tasks"
        active={active === 'all'}
        onClick={() => onPick('all')}
      />
      <TreeGroup
        icon={<Target className="h-4 w-4" />}
        label="Goals"
        count={goals.length}
        active={active === 'goals'}
        onHeaderClick={() => onPick('goals')}
        defaultOpen
      >
        {goals.slice(0, 20).map((g) => (
          <TreeLeaf
            key={g.id}
            label={g.title}
            active={active === 'goals' && activeId === g.id}
            onClick={() => onPick('goals', g.id)}
          />
        ))}
      </TreeGroup>
      <TreeGroup
        icon={<FolderOpen className="h-4 w-4" />}
        label="Projects"
        count={projects.length}
        active={active === 'projects'}
        onHeaderClick={() => onPick('projects')}
        defaultOpen
      >
        {projects.slice(0, 20).map((p) => (
          <TreeLeaf
            key={p.id}
            label={p.title}
            active={active === 'projects' && activeId === p.id}
            onClick={() => onPick('projects', p.id)}
          />
        ))}
      </TreeGroup>
      <TreeGroup
        icon={<Layers className="h-4 w-4" />}
        label="Categories"
        count={categories.length}
        active={active === 'categories'}
        onHeaderClick={() => onPick('categories')}
      >
        {categories.slice(0, 20).map((c) => (
          <TreeLeaf
            key={c.id}
            label={c.name}
            active={active === 'categories' && activeId === c.id}
            onClick={() => onPick('categories', c.id)}
            dotColor={c.color}
          />
        ))}
      </TreeGroup>
    </nav>
  );
}

function TreeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent',
        active && 'bg-accent text-accent-foreground'
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function TreeGroup({
  icon,
  label,
  count,
  active,
  onHeaderClick,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onHeaderClick: () => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        className={cn(
          'flex w-full items-center gap-1 rounded-md hover:bg-accent',
          active && 'bg-accent text-accent-foreground'
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="p-1 text-muted-foreground hover:text-foreground"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onHeaderClick}
          className="flex flex-1 items-center gap-2 py-1.5 pr-2 text-left"
        >
          <span className="text-muted-foreground">{icon}</span>
          <span className="truncate">{label}</span>
          {count > 0 ? (
            <span className="ml-auto text-xs text-muted-foreground">{count}</span>
          ) : null}
        </button>
      </div>
      {open ? <ul className="ml-6 mt-1 space-y-0.5">{children}</ul> : null}
    </div>
  );
}

function TreeLeaf({
  label,
  active,
  onClick,
  dotColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dotColor?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent',
          active && 'bg-accent text-accent-foreground'
        )}
      >
        {dotColor ? (
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: dotColor }}
          />
        ) : null}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}
