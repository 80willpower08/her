// /dashboard — "who I am and how I'm doing"
//
// Top to bottom:
//   1. KPI hero strip (4 cards with trend arrows)
//   2. Goal Progress
//   3. Category mix (bubbles + sparklines)
//   4. 53-week streak grid (with category filter)
//   5. Rhythm — time-of-day + day-of-week histograms
//   6. Approval breakdown by action kind
//   7. About me (collapsible)
//   8. Patterns (collapsible)
//
// Everything is hand-rolled SVG to avoid charting deps.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Brain,
  CheckCircle2,
  Clock,
  DollarSign,
  Flame,
  Heart,
  Sparkles,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { DashboardMetrics } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { cn } from '@/lib/utils';
import { AboutMePage } from './AboutMePage';
import { PatternsPage } from './PatternsPage';

const WINDOW_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
];

export function DashboardPage() {
  const [windowDays, setWindowDays] = useState(30);
  const metricsQ = useQuery({
    queryKey: ['dashboard', windowDays],
    queryFn: () => api.dashboard(windowDays),
  });
  const m = metricsQ.data?.metrics ?? null;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="display text-3xl flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How you're doing, what the agent has learned, and where the energy's going.
          </p>
        </div>
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(parseInt(v, 10))}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {metricsQ.isLoading || !m ? (
        <p className="text-sm text-muted-foreground">Crunching numbers…</p>
      ) : (
        <>
          <KpiStrip m={m} />
          <EnergyRatingSection m={m} />
          <FinanceSnapshotSection m={m} />
          <GoalProgressSection m={m} />
          <CategoryMixSection m={m} />
          <StreakGridSection m={m} />
          <RhythmSection m={m} />
          <ApprovalSection m={m} />
          <GrowthFeedSection m={m} />
        </>
      )}

      <CollapsibleSection
        storageKey="dashboard/about-me"
        title={
          <span className="flex items-center gap-2">
            <Brain className="h-4 w-4" /> About me
          </span>
        }
        description="What the agent remembers about you — facts, preferences, commitments, patterns."
      >
        <AboutMePage />
      </CollapsibleSection>

      <CollapsibleSection
        storageKey="dashboard/patterns"
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Patterns
          </span>
        }
        description="Long-term trends the agent has identified from your task history."
      >
        <PatternsPage />
      </CollapsibleSection>
    </div>
  );
}

// ─── KPI hero strip ────────────────────────────────────────────────────────

function KpiStrip({ m }: { m: DashboardMetrics }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Tasks completed"
        value={m.kpis.tasksCompleted.current.toString()}
        prior={m.kpis.tasksCompleted.prior}
        current={m.kpis.tasksCompleted.current}
        formatTrend={(n) => `${n > 0 ? '+' : ''}${n}`}
      />
      <KpiCard
        icon={<Target className="h-4 w-4" />}
        label="Goal-linked completions"
        value={m.kpis.goalMomentum.current.toString()}
        prior={m.kpis.goalMomentum.prior}
        current={m.kpis.goalMomentum.current}
        formatTrend={(n) => `${n > 0 ? '+' : ''}${n}`}
      />
      <KpiCard
        icon={<Sparkles className="h-4 w-4" />}
        label="Agent approval rate"
        value={`${Math.round(m.kpis.approvalRate.current * 100)}%`}
        prior={m.kpis.approvalRate.prior * 100}
        current={m.kpis.approvalRate.current * 100}
        formatTrend={(n) => `${n > 0 ? '+' : ''}${Math.round(n)}pp`}
        invertDirection={false}
      />
      <KpiCard
        icon={<Clock className="h-4 w-4" />}
        label="Procrastination index"
        value={`${Math.round(m.kpis.procrastinationIndex.current * 100)}%`}
        prior={m.kpis.procrastinationIndex.prior * 100}
        current={m.kpis.procrastinationIndex.current * 100}
        formatTrend={(n) => `${n > 0 ? '+' : ''}${Math.round(n)}pp`}
        invertDirection={true}
      />
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  prior,
  current,
  formatTrend,
  invertDirection = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  prior: number;
  current: number;
  formatTrend: (delta: number) => string;
  // If true, "up" is bad (e.g. procrastination)
  invertDirection?: boolean;
}) {
  const delta = current - prior;
  const direction = delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';
  const good = direction === 'flat' ? null : invertDirection ? direction === 'down' : direction === 'up';

  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="figure text-3xl tabular-nums text-ink">{value}</div>
        <div
          className={cn(
            'flex items-center gap-1 text-xs',
            good === true && 'text-emerald-600 dark:text-emerald-400',
            good === false && 'text-rose-600 dark:text-rose-400',
            good === null && 'text-muted-foreground'
          )}
        >
          {direction === 'up' ? (
            <ArrowUp className="h-3 w-3" />
          ) : direction === 'down' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowRight className="h-3 w-3" />
          )}
          <span>{formatTrend(delta)} vs prior period</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Goal progress ─────────────────────────────────────────────────────────

const PACE_TONE: Record<string, { dot: string; label: string }> = {
  'on-pace': { dot: 'bg-emerald-500', label: 'On pace' },
  ahead: { dot: 'bg-emerald-500', label: 'Ahead' },
  behind: { dot: 'bg-amber-500', label: 'Behind' },
  overdue: { dot: 'bg-rose-500', label: 'Overdue' },
  done: { dot: 'bg-slate-400', label: 'Complete' },
  'no-target': { dot: 'bg-slate-400', label: 'No target date' },
};

function GoalProgressSection({ m }: { m: DashboardMetrics }) {
  const goals = m.goals.filter((g) => !g.completed);
  if (goals.length === 0) {
    return null;
  }
  // Sort: overdue/behind first, then by weight desc
  const order = ['overdue', 'behind', 'on-pace', 'ahead', 'no-target', 'done'];
  const sorted = [...goals].sort((a, b) => {
    const pa = order.indexOf(a.paceState);
    const pb = order.indexOf(b.paceState);
    if (pa !== pb) return pa - pb;
    return b.weight - a.weight;
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Target className="h-4 w-4" /> Goal progress
        </h2>
        <div className="space-y-3">
          {sorted.map((g) => (
            <GoalBar key={g.id} g={g} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GoalBar({ g }: { g: DashboardMetrics['goals'][number] }) {
  const tone = PACE_TONE[g.paceState] ?? PACE_TONE['no-target'];
  const progressPct = Math.round(g.progress * 100);
  const timePct = g.pctTimeElapsed != null ? Math.round(g.pctTimeElapsed * 100) : null;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full shrink-0', tone.dot)} />
          <span className="truncate font-medium">{g.title}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {progressPct}% done
          {timePct != null ? ` · ${timePct}% time elapsed` : ''}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all',
            g.paceState === 'overdue' || g.paceState === 'behind'
              ? 'bg-amber-500'
              : g.paceState === 'ahead'
                ? 'bg-emerald-500'
                : 'bg-primary'
          )}
          style={{ width: `${progressPct}%` }}
        />
        {timePct != null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/40"
            style={{ left: `${timePct}%` }}
            title={`Time elapsed: ${timePct}%`}
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{tone.label}</span>
        {g.paceDeltaDays != null && g.paceState !== 'done' ? (
          <span>
            {g.paceDeltaDays > 0
              ? `+${g.paceDeltaDays} days ahead`
              : g.paceDeltaDays < 0
                ? `${Math.abs(g.paceDeltaDays)} days behind`
                : 'on pace'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Category bubbles + sparklines ─────────────────────────────────────────

function CategoryMixSection({ m }: { m: DashboardMetrics }) {
  const cats = m.categories.filter((c) => c.completedInWindow > 0 || c.activeTaskCount > 0);
  if (cats.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h2 className="text-sm font-medium">Category mix</h2>
          <p className="mt-2 text-sm text-muted-foreground">No data in window.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Category mix</h2>
          <p className="text-xs text-muted-foreground">
            Size = completions in window · sparkline = last 14 days
          </p>
        </div>
        <BubbleChart cats={cats} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cats
            .slice()
            .sort((a, b) => b.completedInWindow - a.completedInWindow)
            .map((c) => (
              <CategoryRow key={c.id} c={c} />
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BubbleChart({ cats }: { cats: DashboardMetrics['categories'] }) {
  // Simple grid-packed bubbles. Sized by sqrt(completedInWindow + activeTaskCount).
  // No physics simulation — just a deterministic flowing layout.
  const minR = 22;
  const maxR = 60;
  const padding = 6;
  const maxScore = Math.max(1, ...cats.map((c) => c.completedInWindow + c.activeTaskCount));
  type Placed = { c: DashboardMetrics['categories'][number]; r: number; x: number; y: number };

  // Sort largest-first so they anchor the layout.
  const sorted = [...cats].sort(
    (a, b) =>
      b.completedInWindow + b.activeTaskCount - (a.completedInWindow + a.activeTaskCount)
  );

  const width = 600;
  const placed: Placed[] = [];
  let cursorX = padding;
  let cursorY = padding;
  let rowH = 0;

  for (const c of sorted) {
    const score = c.completedInWindow + c.activeTaskCount;
    const t = Math.sqrt(score / maxScore);
    const r = Math.round(minR + (maxR - minR) * t);
    if (cursorX + 2 * r + padding > width) {
      cursorX = padding;
      cursorY += rowH + padding;
      rowH = 0;
    }
    const x = cursorX + r;
    const y = cursorY + r;
    placed.push({ c, r, x, y });
    cursorX += 2 * r + padding;
    rowH = Math.max(rowH, 2 * r);
  }
  const height = cursorY + rowH + padding;

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minWidth: 320 }}
        role="img"
        aria-label="Category completion bubbles"
      >
        {placed.map(({ c, r, x, y }) => (
          <g key={c.id}>
            <circle cx={x} cy={y} r={r} fill={c.color} fillOpacity={0.85} />
            <text
              x={x}
              y={y - 4}
              textAnchor="middle"
              className="fill-white"
              style={{ fontSize: Math.max(10, r * 0.32), fontWeight: 600 }}
            >
              {c.completedInWindow}
            </text>
            <text
              x={x}
              y={y + r * 0.45}
              textAnchor="middle"
              className="fill-white/90"
              style={{ fontSize: Math.max(8, r * 0.22) }}
            >
              {truncate(c.name, Math.floor(r / 4))}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (max < 4 || s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function CategoryRow({ c }: { c: DashboardMetrics['categories'][number] }) {
  return (
    <div className="flex items-center gap-3 rounded-md border p-2.5">
      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium truncate">{c.name}</p>
          <p className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {c.completedInWindow} done · {c.activeTaskCount} active
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Sparkline values={c.sparkline} color={c.color} />
          <p className="text-[10px] text-muted-foreground shrink-0">
            {c.medianLeadTimeHours != null
              ? `~${Math.round(c.medianLeadTimeHours)}h lead`
              : ''}
            {c.staleTaskCount > 0 ? ` · ${c.staleTaskCount} stale` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 80;
  const h = 18;
  const max = Math.max(1, ...values);
  const stepX = w / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => `${i * stepX},${h - (v / max) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="shrink-0" role="img" aria-label="14-day sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

// ─── Streak grid ───────────────────────────────────────────────────────────

function StreakGridSection({ m }: { m: DashboardMetrics }) {
  const [filter, setFilter] = useState('all');
  const cells = m.streakGrid;

  // Bin counts (filtered)
  const counts = cells.map((cell) => {
    if (filter === 'all') return cell.count;
    if (filter === '__uncategorized__') return cell.byCategory['__uncategorized__'] ?? 0;
    return cell.byCategory[filter] ?? 0;
  });
  const max = Math.max(1, ...counts);

  // Arrange into 53 columns × 7 rows. cells[0] is oldest; we need to align to
  // weekday so columns are weeks (Sun-Sat).
  // Find weekday of cells[0]
  const firstDate = parseISO(cells[0]?.date ?? new Date().toISOString().slice(0, 10));
  const firstDow = firstDate.getDay(); // 0=Sun

  // Total cells we render = 53 weeks * 7 days, but we add leading blanks so
  // the first cell sits on its right weekday row.
  const totalCells = 53 * 7;
  const padded: Array<{ date: string; value: number; raw?: typeof cells[number] } | null> = new Array(
    totalCells
  ).fill(null);
  for (let i = 0; i < cells.length && i < totalCells; i++) {
    const slot = firstDow + i;
    if (slot >= totalCells) break;
    padded[slot] = { date: cells[i].date, value: counts[i], raw: cells[i] };
  }

  const cellSize = 11;
  const gap = 2;
  const cols = 53;
  const rows = 7;
  const width = cols * (cellSize + gap);
  const height = rows * (cellSize + gap);

  function colorFor(v: number): string {
    if (v === 0) return 'var(--secondary)';
    const intensity = Math.min(1, v / max);
    // emerald-style steps
    if (intensity > 0.75) return '#059669';
    if (intensity > 0.5) return '#10b981';
    if (intensity > 0.25) return '#34d399';
    return '#a7f3d0';
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-medium">Streak grid · 53 weeks</h2>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {m.categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
              <SelectItem value="__uncategorized__">(uncategorized)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto -mx-2 px-2">
          <svg width={width} height={height} role="img" aria-label="Streak grid">
            {padded.map((cell, i) => {
              if (!cell) return null;
              const col = Math.floor(i / 7);
              const row = i % 7;
              return (
                <rect
                  key={i}
                  x={col * (cellSize + gap)}
                  y={row * (cellSize + gap)}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  fill={colorFor(cell.value)}
                >
                  <title>
                    {cell.date} · {cell.value} task{cell.value === 1 ? '' : 's'}
                  </title>
                </rect>
              );
            })}
          </svg>
        </div>
        <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: colorFor((i / 4) * max) }}
            />
          ))}
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Rhythm: time-of-day + day-of-week histograms ──────────────────────────

function RhythmSection({ m }: { m: DashboardMetrics }) {
  const todMax = Math.max(1, ...m.timeOfDay);
  const dowMax = Math.max(1, ...m.dayOfWeek);
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-medium">Time of day</h2>
          <p className="text-xs text-muted-foreground">
            When in the day you complete tasks
          </p>
          <Histogram values={m.timeOfDay} max={todMax} labelFor={(i) => `${i}:00`} step={4} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-medium">Day of week</h2>
          <p className="text-xs text-muted-foreground">Where the week shows up most</p>
          <Histogram values={m.dayOfWeek} max={dowMax} labelFor={(i) => dows[i]} step={1} />
        </CardContent>
      </Card>
    </div>
  );
}

function Histogram({
  values,
  max,
  labelFor,
  step,
}: {
  values: number[];
  max: number;
  labelFor: (i: number) => string;
  step: number;
}) {
  const width = 300;
  const height = 100;
  const barW = width / values.length;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height + 20}`}
        className="w-full"
        role="img"
        aria-label="Histogram"
      >
        {values.map((v, i) => {
          const h = (v / max) * height;
          return (
            <g key={i}>
              <rect
                x={i * barW + 1}
                y={height - h}
                width={barW - 2}
                height={h}
                fill="hsl(var(--primary))"
                rx={1}
              >
                <title>
                  {labelFor(i)}: {v}
                </title>
              </rect>
              {i % step === 0 ? (
                <text
                  x={i * barW + barW / 2}
                  y={height + 12}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  style={{ fontSize: 9 }}
                >
                  {labelFor(i)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Approval rate by kind ─────────────────────────────────────────────────

function ApprovalSection({ m }: { m: DashboardMetrics }) {
  if (m.approvalByKind.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Agent approval by action kind
        </h2>
        <p className="text-xs text-muted-foreground">
          Where your trust is highest vs. lowest. If a kind is consistently rejected, the
          agent's calibration on that surface is off.
        </p>
        <div className="space-y-2">
          {m.approvalByKind.map((k) => {
            const pct = Math.round(k.rate * 100);
            const trend = pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'low';
            return (
              <div key={k.kind} className="space-y-0.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{k.kind.toLowerCase().replace(/_/g, ' ')}</span>
                  <span className="text-xs text-muted-foreground">
                    {k.approved}/{k.decided} approved · {pct}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      trend === 'good'
                        ? 'bg-emerald-500'
                        : trend === 'mid'
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Energy rating — input + sparkline + correlation ──────────────────────

function EnergyRatingSection({ m }: { m: DashboardMetrics }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const upsertMutation = useMutation({
    mutationFn: (input: { rating: number; note?: string | null }) =>
      api.dayRatings.upsert({ dateKey: m.dayRatings.today, ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setNote('');
    },
  });

  const r = m.dayRatings;
  const todays = r.todaysRating;
  const series = r.series;
  const max = 5;
  const widthSpark = 320;
  const heightSpark = 36;

  const correlationLine = (() => {
    if (r.correlation.highDayAvgCompletions == null || r.correlation.lowDayAvgCompletions == null) {
      return null;
    }
    const hi = r.correlation.highDayAvgCompletions;
    const lo = r.correlation.lowDayAvgCompletions;
    if (Math.abs(hi - lo) < 0.5) return 'No strong correlation between rating and completions yet.';
    const more = hi > lo;
    return more
      ? `On 4-5 days you average ${hi.toFixed(1)} completions; on 1-2 days, ${lo.toFixed(1)}.`
      : `On 1-2 days you actually complete more (${lo.toFixed(1)}) than on 4-5 days (${hi.toFixed(1)}).`;
  })();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Heart className="h-4 w-4" /> How was today?
          </h2>
          {r.average != null ? (
            <p className="text-xs text-muted-foreground">
              {r.count} rating{r.count === 1 ? '' : 's'} · avg {r.average.toFixed(1)}/5
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((v) => {
            const active = todays === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => upsertMutation.mutate({ rating: v, note: note.trim() || null })}
                disabled={upsertMutation.isPending}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-accent'
                )}
                title={`Rate ${v}/5`}
              >
                <Star
                  className={cn('h-4 w-4', active ? 'fill-current' : '')}
                />
              </button>
            );
          })}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note for today…"
            className="flex-1 min-w-[120px] bg-transparent border rounded-md px-2 h-9 text-sm"
            maxLength={200}
          />
        </div>

        {todays != null ? (
          <p className="text-xs text-muted-foreground">
            Today: {todays}/5. Tap another star to change.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No rating for today yet.</p>
        )}

        {series.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Last 30 days</p>
            <svg
              viewBox={`0 0 ${widthSpark} ${heightSpark + 4}`}
              className="w-full"
              role="img"
              aria-label="Last 30 days rating sparkline"
            >
              {series.map((s, i) => {
                const x = (i / Math.max(1, series.length - 1)) * widthSpark;
                const y = heightSpark - (s.rating / max) * heightSpark;
                const color =
                  s.rating >= 4
                    ? '#10b981'
                    : s.rating === 3
                      ? '#a3a3a3'
                      : '#f43f5e';
                return (
                  <g key={s.date}>
                    <circle cx={x} cy={y + 2} r={3} fill={color}>
                      <title>
                        {s.date}: {s.rating}/5{s.note ? ` — ${s.note}` : ''}
                      </title>
                    </circle>
                    {i > 0 ? (
                      <line
                        x1={((i - 1) / Math.max(1, series.length - 1)) * widthSpark}
                        y1={heightSpark - (series[i - 1].rating / max) * heightSpark + 2}
                        x2={x}
                        y2={y + 2}
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={1}
                        opacity={0.4}
                      />
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        ) : null}

        {correlationLine ? (
          <p className="text-xs text-muted-foreground italic">
            {correlationLine}
            {r.correlation.strongestCategoryName && r.correlation.strongestCategoryEffect != null
              ? ` On good days, ${r.correlation.strongestCategoryName} makes up ${
                  r.correlation.strongestCategoryEffect > 0 ? '+' : ''
                }${Math.round(r.correlation.strongestCategoryEffect * 100)}pp more of your work.`
              : ''}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Finance snapshot ──────────────────────────────────────────────────────

function FinanceSnapshotSection({ m }: { m: DashboardMetrics }) {
  const f = m.finance;
  if (!f.available) {
    return null;
  }
  const fmt = (n: number | null) =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Finance snapshot
          </h2>
          {f.sourceLabel ? (
            <p className="text-xs text-muted-foreground">
              From {f.sourceLabel}
              {f.lastSyncedAt ? ` · synced ${formatRelative(f.lastSyncedAt)}` : ''}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {f.totalDebt != null ? (
            <FinanceTile label="Total debt" value={fmt(f.totalDebt)} tone="warn" />
          ) : null}
          {f.monthlyDebtPayments != null ? (
            <FinanceTile
              label="Monthly debt payment"
              value={fmt(f.monthlyDebtPayments)}
              tone="neutral"
            />
          ) : null}
          {f.totalCurrentValue != null ? (
            <FinanceTile
              label="Collection value"
              value={fmt(f.totalCurrentValue)}
              tone="good"
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FinanceTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const ringClass =
    tone === 'good'
      ? 'border-emerald-500/30'
      : tone === 'warn'
        ? 'border-amber-500/30'
        : 'border-border';
  return (
    <div className={cn('rounded-md border p-3', ringClass)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// ─── Growth feed ───────────────────────────────────────────────────────────

const FEED_ICON: Record<string, React.ReactNode> = {
  'goal-complete': <Trophy className="h-4 w-4 text-amber-500" />,
  'project-complete': <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  'goal-milestone': <Target className="h-4 w-4 text-primary" />,
  streak: <Flame className="h-4 w-4 text-rose-500" />,
  'sheet-update': <DollarSign className="h-4 w-4 text-muted-foreground" />,
};

function GrowthFeedSection({ m }: { m: DashboardMetrics }) {
  if (m.growthFeed.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Trophy className="h-4 w-4" /> Growth feed
          </h2>
          <p className="text-xs text-muted-foreground">
            No milestones in the last 90 days yet. Goal completions, project closures, and
            5+ day streaks will show up here.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Trophy className="h-4 w-4" /> Growth feed
        </h2>
        <ol className="space-y-3">
          {m.growthFeed.map((e, i) => (
            <li key={`${e.kind}:${e.date}:${i}`} className="flex gap-3">
              <div className="shrink-0 pt-0.5">{FEED_ICON[e.kind] ?? <Sparkles className="h-4 w-4" />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">{e.detail}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
                  {e.date}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// Suppress unused-import warnings for icons we keep ready for later phases.
void TrendingUp;
void TrendingDown;
void format;
void parseISO;
