// Agent service — context assembly + proposed-action execution.
// The agent itself runs in a separate container (Claude Code CLI). This file is
// the API-side machinery that supplies it with curated input and applies its
// approved decisions.

import type {
  AgentKind,
  ProposedAction,
  ProposedActionKind,
  ProposedActionMode,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { env } from '../env.js';
import { decorateTasks } from './tasks.js';
import { loadUserContext } from './context.js';
import { buildOverview } from './overview.js';
import { buildPatterns } from './patterns.js';

/** Format a Date in the user's timezone as "Mon May 11, 2:00 PM CDT". */
function formatLocal(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

/** Format an all-day event date as "Mon May 13" — interprets the date in UTC
 * because Google/MS store all-day events as midnight UTC on the calendar date
 * (so May 13 becomes 2026-05-13T00:00:00Z, NOT a local-tz May 13). Converting
 * that through the user's tz shifts the day backward in CDT/CST. */
function formatLocalAllDay(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** Structured input the agent reasons over. Curated, not freeform. */
export interface AgentContext {
  kind: AgentKind;
  generatedAt: string;
  generatedAtLocal: string;
  // IANA tz like "America/Chicago". All *Local fields are formatted in this zone.
  timezone: string;
  user: { id: string; username: string };
  // Ranked tasks (top 20, top-level only)
  rankedTasks: Array<{
    id: string;
    title: string;
    categoryId: string | null;
    weight: number;
    importance: number;
    urgency: number;
    rank: number;
    derivedPriority: string;
    isBlocked: boolean;
    dueDate: string | null;
    scheduledFor: string | null;
    linkedCalendarEventId: string | null;
  }>;
  // Today's events
  todayEvents: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    startsAtLocal: string;
    endsAtLocal: string;
    accountLabel: string | null;
    categoryId: string | null;
    notes: Array<{ kind: string; body: string; at: string }>;
  }>;
  // Events in the next 7 days (excluding today). Lets the agent spot
  // unlinked prep tasks and suggest LINK_TASK_TO_EVENT or CREATE_TASK.
  upcomingEvents: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    startsAtLocal: string;
    endsAtLocal: string;
    accountLabel: string | null;
    categoryId: string | null;
    notes: Array<{ kind: string; body: string; at: string }>;
  }>;
  // Active goals with progress
  goals: Array<{
    id: string;
    title: string;
    weight: number;
    progress: number;
    isBlocked: boolean;
    primaryCategoryId: string | null;
  }>;
  // Categories with weight + recent progress
  categories: Array<{
    id: string;
    name: string;
    weight: number;
    progress: number;
  }>;
  // Performance patterns
  patterns: {
    windowDays: number;
    strengths: string[]; // category names
    struggles: string[];
  };
  // Per-calendar notes the user wrote — relevance hints for the agent.
  // E.g., "Family calendar — kids' practices involve me; NCISD is spouse only;
  // $-prefix titles are paydays, no action needed."
  // Long-running narrative initiatives (VA claim, custody case, etc.).
  // Always-in-context projects come in regardless of anchor; anchor-relevant
  // and recently-touched fill the rest. Body is truncated; agent can fetch
  // full body via read_project_body MCP tool.
  projects: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    primaryCategoryId: string | null;
    secondaryCategoryIds: string[];
    nextActionAt: string | null;
    nextActionAtLocal: string | null;
    nextActionNote: string | null;
    alwaysInContext: boolean;
    bodyExcerpt: string;
    bodyTruncated: boolean;
    bodyLength: number;
    updatedAt: string;
  }>;
  // What the agent remembers about the user. ALL current FACT/PREFERENCE/
  // active-COMMITMENT are loaded; PATTERN/INSIGHT/CONCERN are top-N by anchor
  // relevance with recency fallback. Each row is current (not superseded,
  // not archived, not expired).
  observations: Array<{
    id: string;
    kind: string;
    subject: string;
    body: string;
    confidence: number;
    source: string;
    enforceLevel: string;
    confirmedByUser: boolean;
    relatedCategoryIds: string[];
    relatedGoalIds: string[];
    relatedTaskIds: string[];
    expiresAt: string | null;
    createdAt: string;
  }>;
  calendarSourceNotes: Array<{
    label: string;
    notes: string;
  }>;
  // Generic JSON feeds from other apps (e.g., curator). Each entry has a
  // user-written description plus a snapshot (truncated for context budget).
  dataSources: Array<{
    id: string;
    label: string;
    description: string | null;
    categoryId: string | null;
    baseUrl: string;
    endpointPath: string;
    syncCadence: string;
    lastSyncedAt: string | null;
    lastSyncedAtLocal: string | null;
    lastError: string | null;
    dataExcerpt: string; // serialized snapshot, truncated to ~10K chars
    dataTruncated: boolean;
    dataSizeBytes: number;
  }>;
  // Registered Google Sheets the user has tagged for the agent to read.
  // Each entry includes a description (user-written interpretation guide)
  // plus a snapshot of header + rows.
  sheets: Array<{
    id: string;
    label: string;
    description: string | null;
    categoryId: string | null;
    spreadsheetId: string;
    sheetName: string | null;
    syncCadence: string;
    lastSyncedAt: string | null;
    lastSyncedAtLocal: string | null;
    header: string[];
    rows: Array<Array<string | number | null>>;
    rowCount: number;
  }>;
  // Recent proposed actions — both open and recently-decided. Lets the agent
  // see what it (or a prior run) has already suggested so it doesn't propose
  // the same thing twice.
  recentProposedActions: Array<{
    id: string;
    kind: string;
    status: string; // PENDING | EXECUTED | DENIED | EXPIRED | FAILED
    mode: string;
    targetType: string | null;
    targetId: string | null;
    rationale: string;
    payloadSummary: string; // short flattened view, e.g. "newWeight=7", "linkedCalendarEventId=abc"
    createdAt: string;
    decidedAt: string | null;
  }>;
  // Recent inbound items: ingested emails + manually-shared messages.
  // Untriaged shares (PENDING) come first; then recent emails by receivedAt.
  recentMessages: Array<{
    id: string;
    source: 'GMAIL' | 'OUTLOOK' | 'SHARED' | 'SMS' | 'NOTIFICATION';
    triageStatus: string;
    accountLabel: string | null;
    fromAddress: string;
    fromName: string | null;
    subject: string;
    snippet: string | null;
    sourceUrl: string | null;
    isUnread: boolean;
    isImportant: boolean;
    labels: string[];
    receivedAt: string;
    receivedAtLocal: string;
  }>;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfTomorrow(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

// Anchor hint for context curation — CHAT runs pass these so observations
// load top-relevance for the thread's anchor.
export interface AgentContextAnchor {
  categoryIds?: string[];
  goalIds?: string[];
  taskIds?: string[];
}

export async function buildAgentContext(
  userId: string,
  kind: AgentKind,
  anchor?: AgentContextAnchor
): Promise<AgentContext> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const ctx = await loadUserContext(userId);
  const overview = await buildOverview(userId);
  const patterns = await buildPatterns(userId);

  // Top-level not-completed tasks, decorated, sorted by rank
  const topTasks = decorateTasks(
    ctx.tasks.filter((t) => !t.parentId && !t.completed),
    ctx
  )
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 20);

  const today = startOfToday();
  const tomorrow = startOfTomorrow();
  const sevenDays = new Date(today.getTime() + 7 * 86_400_000);
  const accountById = new Map(
    (await prisma.externalAccount.findMany({
      where: { userId },
      select: { id: true, label: true, accountEmail: true },
    })).map((a) => [a.id, a])
  );
  const accountLabelFor = (accountId: string) =>
    accountById.get(accountId)?.label ?? accountById.get(accountId)?.accountEmail ?? null;

  // Per-calendar overrides: friendly label, category mapping, hide flag, notes.
  const calendarSources = await prisma.calendarSource.findMany({
    where: { userId },
    select: {
      externalAccountId: true,
      sourceCalendarId: true,
      label: true,
      categoryId: true,
      hidden: true,
      notes: true,
    },
  });
  const sourceByKey = new Map(
    calendarSources.map((s) => [`${s.externalAccountId}::${s.sourceCalendarId}`, s])
  );
  const sourceFor = (e: { externalAccountId: string; sourceCalendarId: string | null }) =>
    e.sourceCalendarId
      ? sourceByKey.get(`${e.externalAccountId}::${e.sourceCalendarId}`) ?? null
      : null;
  const isHidden = (e: { externalAccountId: string; sourceCalendarId: string | null }) =>
    sourceFor(e)?.hidden === true;
  const labelForEvent = (e: { externalAccountId: string; sourceCalendarId: string | null }) =>
    sourceFor(e)?.label ?? accountLabelFor(e.externalAccountId);

  const tz = env.userTimeZone;

  // Load any per-event notes (INSTRUCTION-kind especially — these are user
  // steering rules the agent must respect on future runs).
  const candidateEvents = ctx.events.filter(
    (e) => e.startsAt < sevenDays && e.endsAt > today && !isHidden(e)
  );
  const eventConvs = candidateEvents.length === 0
    ? []
    : await prisma.conversation.findMany({
        where: {
          userId,
          entityType: 'EVENT',
          entityId: { in: candidateEvents.map((e) => e.id) },
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { kind: true, body: true, createdAt: true },
          },
        },
      });
  const notesByEventId = new Map(
    eventConvs.map((c) => [
      c.entityId,
      c.messages.map((m) => ({
        kind: m.kind,
        body: m.body,
        at: m.createdAt.toISOString(),
      })),
    ])
  );
  const decorateEvent = (e: typeof ctx.events[number]) => ({
    id: e.id,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    allDay: e.allDay,
    startsAtLocal: e.allDay
      ? formatLocalAllDay(e.startsAt)
      : formatLocal(e.startsAt, tz),
    endsAtLocal: e.allDay
      ? formatLocalAllDay(e.endsAt)
      : formatLocal(e.endsAt, tz),
    accountLabel: labelForEvent(e),
    categoryId: sourceFor(e)?.categoryId ?? null,
    notes: notesByEventId.get(e.id) ?? [],
  });

  const todayEvents = ctx.events
    .filter((e) => e.startsAt < tomorrow && e.endsAt > today && !isHidden(e))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map(decorateEvent);

  const upcomingEvents = ctx.events
    .filter((e) => e.startsAt >= tomorrow && e.startsAt < sevenDays && !isHidden(e))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 30)
    .map(decorateEvent);

  const goals = overview.categories
    .flatMap((c) => [...c.primaryGoals, ...c.secondaryGoals])
    .filter((g) => !g.completed && !g.archived)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map((g) => ({
      id: g.id,
      title: g.title,
      weight: g.weight,
      progress: g.progress,
      isBlocked: false, // TODO: wire from getGoal once needed
      primaryCategoryId: null as string | null,
    }));

  const categories = overview.categories.map((c) => ({
    id: c.category.id,
    name: c.category.name,
    weight: c.category.weight,
    progress: c.category.progress,
  }));

  // Snapshots of any registered Google Sheets the user wants the agent to see.
  const sheetRows = await prisma.sheetSource.findMany({
    where: { userId, enabled: true },
    orderBy: [{ label: 'asc' }],
  });
  const sheetSummary = sheetRows.map((s) => {
    const snap = (s.snapshot ?? null) as
      | { header?: string[]; rows?: Array<Array<string | number | null>>; rowCount?: number }
      | null;
    return {
      id: s.id,
      label: s.label,
      description: s.description,
      categoryId: s.categoryId,
      spreadsheetId: s.spreadsheetId,
      sheetName: s.sheetName,
      syncCadence: s.syncCadence,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      lastSyncedAtLocal: s.lastSyncedAt ? formatLocal(s.lastSyncedAt, tz) : null,
      header: snap?.header ?? [],
      rows: snap?.rows ?? [],
      rowCount: snap?.rowCount ?? 0,
    };
  });

  const observationsForContext = await loadObservationsForContext(userId, anchor);
  const projectsForContext = await loadProjectsForContext(userId, anchor);
  const dataSourcesForContext = await loadDataSourcesForContext(userId);

  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);
  const recentProposedActionRows = await prisma.proposedAction.findMany({
    where: {
      userId,
      OR: [
        { status: 'PENDING' },
        { createdAt: { gte: thirtyDaysAgo } },
      ],
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });
  const summarizePayload = (kind: string, payload: unknown): string => {
    if (!payload || typeof payload !== 'object') return '';
    const p = payload as Record<string, unknown>;
    const pairs: string[] = [];
    const interesting = [
      'taskId',
      'newWeight',
      'newDueDate',
      'newScheduledFor',
      'calendarEventId',
      'linkedCalendarEventId',
      'entityType',
      'entityId',
      'title',
      'categoryId',
      'messageKind',
    ];
    for (const k of interesting) {
      if (p[k] !== undefined && p[k] !== null && p[k] !== '') {
        const v = typeof p[k] === 'string' ? (p[k] as string).slice(0, 80) : p[k];
        pairs.push(`${k}=${JSON.stringify(v)}`);
      }
    }
    return pairs.join(', ') || kind;
  };
  const recentProposedActions = recentProposedActionRows.map((a) => ({
    id: a.id,
    kind: a.kind,
    status: a.status,
    mode: a.mode,
    targetType: a.targetType,
    targetId: a.targetId,
    rationale: a.rationale,
    payloadSummary: summarizePayload(a.kind, a.payload),
    createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
  }));

  const sevenDaysAgo = new Date(today.getTime() - 7 * 86_400_000);
  const recentEmailRows = await prisma.emailMessage.findMany({
    where: {
      userId,
      OR: [
        { triageStatus: 'PENDING' },
        { receivedAt: { gte: sevenDaysAgo } },
      ],
    },
    orderBy: [{ triageStatus: 'asc' }, { receivedAt: 'desc' }],
    take: 30,
  });
  const recentMessages = recentEmailRows.map((m) => ({
    id: m.id,
    source: m.source as 'GMAIL' | 'OUTLOOK' | 'SHARED',
    triageStatus: m.triageStatus,
    accountLabel: m.externalAccountId ? accountLabelFor(m.externalAccountId) : null,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    subject: m.subject,
    snippet: m.snippet,
    sourceUrl: m.sourceUrl,
    isUnread: m.isUnread,
    isImportant: m.isImportant,
    labels: m.labels,
    receivedAt: m.receivedAt.toISOString(),
    receivedAtLocal: formatLocal(m.receivedAt, tz),
  }));

  return {
    kind,
    generatedAt: new Date().toISOString(),
    generatedAtLocal: formatLocal(new Date(), tz),
    timezone: tz,
    user: { id: user.id, username: user.username },
    rankedTasks: topTasks.map((t) => ({
      id: t.id,
      title: t.title,
      categoryId: t.categoryId,
      weight: t.weight,
      importance: t.importance,
      urgency: t.urgency,
      rank: t.rank,
      derivedPriority: t.derivedPriority,
      isBlocked: t.isBlocked,
      dueDate: t.dueDate?.toISOString() ?? null,
      scheduledFor: t.scheduledFor?.toISOString() ?? null,
      linkedCalendarEventId: t.linkedCalendarEventId,
    })),
    todayEvents,
    upcomingEvents,
    goals,
    categories,
    patterns: {
      windowDays: patterns.windowDays,
      strengths: patterns.byCategory.filter((p) => p.classification === 'strength').map((p) => p.categoryName),
      struggles: patterns.byCategory.filter((p) => p.classification === 'struggle').map((p) => p.categoryName),
    },
    calendarSourceNotes: calendarSources
      .filter((s) => s.notes && s.notes.trim().length > 0)
      .map((s) => ({ label: s.label, notes: s.notes! })),
    sheets: sheetSummary,
    dataSources: dataSourcesForContext,
    projects: projectsForContext,
    observations: observationsForContext,
    recentProposedActions,
    recentMessages,
  };
}

const DATA_SOURCE_EXCERPT_CHARS = 10000;

async function loadDataSourcesForContext(
  userId: string
): Promise<AgentContext['dataSources']> {
  const tz = env.userTimeZone;
  const rows = await prisma.dataSource.findMany({
    where: { userId, enabled: true },
    orderBy: [{ label: 'asc' }],
  });
  return rows.map((s) => {
    const snap = (s.snapshot ?? null) as
      | { data?: unknown; sizeBytes?: number; truncated?: boolean }
      | null;
    let serialized = '';
    if (snap?.data !== undefined && snap.data !== null) {
      try {
        serialized =
          typeof snap.data === 'string'
            ? snap.data
            : JSON.stringify(snap.data, null, 2);
      } catch {
        serialized = String(snap.data);
      }
    }
    const truncated = serialized.length > DATA_SOURCE_EXCERPT_CHARS;
    const excerpt = truncated
      ? serialized.slice(0, DATA_SOURCE_EXCERPT_CHARS) +
        '\n\n[...truncated — call read_data_source_snapshot for full content]'
      : serialized;
    return {
      id: s.id,
      label: s.label,
      description: s.description,
      categoryId: s.categoryId,
      baseUrl: s.baseUrl,
      endpointPath: s.endpointPath,
      syncCadence: s.syncCadence,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      lastSyncedAtLocal: s.lastSyncedAt ? formatLocal(s.lastSyncedAt, tz) : null,
      lastError: s.lastError,
      dataExcerpt: excerpt,
      dataTruncated: truncated || snap?.truncated === true,
      dataSizeBytes: snap?.sizeBytes ?? serialized.length,
    };
  });
}

const PROJECT_BODY_BUDGET = 4000; // chars per project in context

/** Curate projects for context. Always-in-context first, then anchor-matching,
 * then 3 most-recently-updated active. Bodies truncated to a budget. */
async function loadProjectsForContext(
  userId: string,
  anchor?: AgentContextAnchor
): Promise<AgentContext['projects']> {
  const tz = env.userTimeZone;
  const rows = await prisma.project.findMany({
    where: {
      userId,
      archived: false,
      NOT: { status: 'ARCHIVED' },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const picked = new Set<string>();
  const out: typeof rows = [];

  const add = (p: (typeof rows)[number]) => {
    if (picked.has(p.id)) return;
    picked.add(p.id);
    out.push(p);
  };

  // 1) Always-in-context
  for (const p of rows.filter((r) => r.alwaysInContext)) add(p);

  // 2) Anchor-matching by primary OR secondary category
  if (anchor?.categoryIds?.length) {
    const cats = new Set(anchor.categoryIds);
    for (const p of rows.filter((r) => {
      if (r.primaryCategoryId && cats.has(r.primaryCategoryId)) return true;
      return r.secondaryCategoryIds.some((c) => cats.has(c));
    })) {
      add(p);
    }
  }

  // 3) Top 3 recently updated (ACTIVE only)
  for (const p of rows.filter((r) => r.status === 'ACTIVE').slice(0, 3)) add(p);

  return out.map((p) => {
    const trimmed = p.body.length > PROJECT_BODY_BUDGET
      ? p.body.slice(0, PROJECT_BODY_BUDGET) + '\n\n[...truncated — call read_project_body for full content]'
      : p.body;
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      primaryCategoryId: p.primaryCategoryId,
      secondaryCategoryIds: p.secondaryCategoryIds,
      nextActionAt: p.nextActionAt?.toISOString() ?? null,
      nextActionAtLocal: p.nextActionAt ? formatLocal(p.nextActionAt, tz) : null,
      nextActionNote: p.nextActionNote,
      alwaysInContext: p.alwaysInContext,
      bodyExcerpt: trimmed,
      bodyTruncated: p.body.length > PROJECT_BODY_BUDGET,
      bodyLength: p.body.length,
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

const PROBABILISTIC_KINDS = new Set(['PATTERN', 'INSIGHT', 'CONCERN']);
const TOP_N_PROBABILISTIC = 25;

/** Curate observations for a given anchor.
 *
 * Rule:
 *  - Always load all current FACT, PREFERENCE, COMMITMENT (regardless of anchor).
 *  - For PATTERN/INSIGHT/CONCERN: score by anchor overlap (categories > goals >
 *    tasks), then by recency. Take top N.
 */
async function loadObservationsForContext(
  userId: string,
  anchor?: AgentContextAnchor
): Promise<AgentContext['observations']> {
  const now = new Date();
  const rows = await prisma.observation.findMany({
    where: {
      userId,
      archived: false,
      supersededAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
  });

  const anchorCats = new Set(anchor?.categoryIds ?? []);
  const anchorGoals = new Set(anchor?.goalIds ?? []);
  const anchorTasks = new Set(anchor?.taskIds ?? []);
  const hasAnchor = anchorCats.size + anchorGoals.size + anchorTasks.size > 0;

  const scoreOverlap = (o: (typeof rows)[number]): number => {
    let s = 0;
    for (const id of o.relatedCategoryIds) if (anchorCats.has(id)) s += 3;
    for (const id of o.relatedGoalIds) if (anchorGoals.has(id)) s += 2;
    for (const id of o.relatedTaskIds) if (anchorTasks.has(id)) s += 1;
    return s;
  };

  const always = rows.filter((r) => !PROBABILISTIC_KINDS.has(r.kind));
  const probabilistic = rows.filter((r) => PROBABILISTIC_KINDS.has(r.kind));

  let pickedProb: typeof probabilistic;
  if (hasAnchor) {
    pickedProb = probabilistic
      .map((r) => ({ r, score: scoreOverlap(r) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.r.createdAt.getTime() - a.r.createdAt.getTime();
      })
      .slice(0, TOP_N_PROBABILISTIC)
      .map((x) => x.r);
  } else {
    pickedProb = probabilistic.slice(0, TOP_N_PROBABILISTIC);
  }

  return [...always, ...pickedProb].map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    confidence: r.confidence,
    source: r.source,
    enforceLevel: r.enforceLevel,
    confirmedByUser: r.confirmedByUser,
    relatedCategoryIds: r.relatedCategoryIds,
    relatedGoalIds: r.relatedGoalIds,
    relatedTaskIds: r.relatedTaskIds,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Default mode for each action kind. The user can override per-policy later. */
export const DEFAULT_ACTION_MODE: Record<ProposedActionKind, ProposedActionMode> = {
  POST_NOTE: 'AUTO',
  CREATE_TASK: 'REVIEW',
  UPDATE_TASK: 'REVIEW',
  COMPLETE_TASK: 'REVIEW',
  ADJUST_WEIGHT: 'REVIEW',
  RESCHEDULE_TASK: 'REVIEW',
  LINK_TASK_TO_EVENT: 'AUTO',
  ARCHIVE_TASK: 'REVIEW',
  DECLINE_MEETING: 'ASK',
  CREATE_GOAL: 'REVIEW',
  CREATE_PROJECT: 'REVIEW',
  UPDATE_PROJECT: 'REVIEW',
};

/**
 * Execute an APPROVED action. Idempotent: marks executedAt; returns the result.
 * For Phase 4.0 only POST_NOTE is implemented; others surface a clear error.
 */
export async function executeProposedAction(action: ProposedAction): Promise<{ ok: true } | { error: string }> {
  if (action.kind === 'POST_NOTE') {
    const payload = action.payload as {
      entityType?: string;
      entityId?: string;
      body?: string;
      messageKind?: string;
    };
    if (!payload.entityType || !payload.entityId || !payload.body) {
      return { error: 'POST_NOTE payload missing entityType/entityId/body' };
    }
    const lower = payload.entityType.toLowerCase();
    if (lower !== 'task' && lower !== 'goal' && lower !== 'event') {
      return { error: `POST_NOTE entityType must be task, goal, or event, got ${payload.entityType}` };
    }
    // Verify the entity belongs to this user
    if (lower === 'task') {
      const t = await prisma.task.findFirst({
        where: { id: payload.entityId, userId: action.userId },
      });
      if (!t) return { error: 'Target task not found' };
    } else if (lower === 'goal') {
      const g = await prisma.goal.findFirst({
        where: { id: payload.entityId, userId: action.userId },
      });
      if (!g) return { error: 'Target goal not found' };
    } else {
      const e = await prisma.calendarEvent.findFirst({
        where: { id: payload.entityId, userId: action.userId },
      });
      if (!e) return { error: 'Target event not found' };
    }

    const entityTypeEnum = lower === 'task' ? 'TASK' : lower === 'goal' ? 'GOAL' : 'EVENT';
    const conv = await prisma.conversation.upsert({
      where: { entityType_entityId: { entityType: entityTypeEnum, entityId: payload.entityId } },
      update: { updatedAt: new Date() },
      create: {
        userId: action.userId,
        entityType: entityTypeEnum,
        entityId: payload.entityId,
      },
    });
    // Allow the agent to mark notes as INSTRUCTION (user-given rules to be
    // respected on future runs) vs the default AGENT_REPLY (silent observation).
    const allowedKinds = ['AGENT_REPLY', 'INSTRUCTION', 'NOTE'] as const;
    const messageKind = (payload.messageKind && (allowedKinds as readonly string[]).includes(payload.messageKind)
      ? payload.messageKind
      : 'AGENT_REPLY') as (typeof allowedKinds)[number];
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        kind: messageKind,
        body: payload.body,
        authorType: 'AGENT',
        authorId: 'agent',
      },
    });
    return { ok: true };
  }

  if (action.kind === 'LINK_TASK_TO_EVENT') {
    const payload = action.payload as { taskId?: string; calendarEventId?: string };
    if (!payload.taskId || !payload.calendarEventId) {
      return { error: 'LINK_TASK_TO_EVENT requires taskId + calendarEventId' };
    }
    const [task, event] = await Promise.all([
      prisma.task.findFirst({ where: { id: payload.taskId, userId: action.userId } }),
      prisma.calendarEvent.findFirst({
        where: { id: payload.calendarEventId, userId: action.userId },
      }),
    ]);
    if (!task) return { error: 'Task not found' };
    if (!event) return { error: 'Calendar event not found' };
    await prisma.task.update({
      where: { id: task.id },
      data: { linkedCalendarEventId: event.id },
    });
    return { ok: true };
  }

  if (action.kind === 'ADJUST_WEIGHT') {
    const payload = action.payload as { taskId?: string; newWeight?: number };
    if (!payload.taskId) return { error: 'ADJUST_WEIGHT requires taskId' };
    if (typeof payload.newWeight !== 'number' || payload.newWeight < 1 || payload.newWeight > 10) {
      return { error: 'newWeight must be an integer 1..10' };
    }
    const task = await prisma.task.findFirst({
      where: { id: payload.taskId, userId: action.userId },
    });
    if (!task) return { error: 'Task not found' };
    await prisma.task.update({
      where: { id: task.id },
      data: { weight: Math.round(payload.newWeight) },
    });
    return { ok: true };
  }

  if (action.kind === 'RESCHEDULE_TASK') {
    const payload = action.payload as {
      taskId?: string;
      newDueDate?: string | null;
      newScheduledFor?: string | null;
    };
    if (!payload.taskId) return { error: 'RESCHEDULE_TASK requires taskId' };
    const task = await prisma.task.findFirst({
      where: { id: payload.taskId, userId: action.userId },
    });
    if (!task) return { error: 'Task not found' };
    const data: { dueDate?: Date | null; scheduledFor?: Date | null } = {};
    if (payload.newDueDate !== undefined) {
      data.dueDate = payload.newDueDate ? new Date(payload.newDueDate) : null;
    }
    if (payload.newScheduledFor !== undefined) {
      data.scheduledFor = payload.newScheduledFor ? new Date(payload.newScheduledFor) : null;
    }
    if (Object.keys(data).length === 0) {
      return { error: 'RESCHEDULE_TASK needs at least newDueDate or newScheduledFor' };
    }
    await prisma.task.update({ where: { id: task.id }, data });
    return { ok: true };
  }

  if (action.kind === 'CREATE_TASK') {
    const payload = action.payload as {
      title?: string;
      categoryId?: string | null;
      weight?: number;
      dueDate?: string | null;
      scheduledFor?: string | null;
      linkedCalendarEventId?: string | null;
      description?: string | null;
    };
    if (!payload.title || payload.title.trim().length === 0) {
      return { error: 'CREATE_TASK requires title' };
    }
    if (payload.categoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: payload.categoryId, userId: action.userId },
      });
      if (!cat) return { error: 'Category not found' };
    }
    if (payload.linkedCalendarEventId) {
      const ev = await prisma.calendarEvent.findFirst({
        where: { id: payload.linkedCalendarEventId, userId: action.userId },
      });
      if (!ev) return { error: 'Linked calendar event not found' };
    }
    await prisma.task.create({
      data: {
        userId: action.userId,
        title: payload.title.trim(),
        description: payload.description ?? null,
        categoryId: payload.categoryId ?? null,
        weight: payload.weight ?? 5,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        scheduledFor: payload.scheduledFor ? new Date(payload.scheduledFor) : null,
        linkedCalendarEventId: payload.linkedCalendarEventId ?? null,
      },
    });
    return { ok: true };
  }

  if (action.kind === 'CREATE_GOAL') {
    const payload = action.payload as {
      title?: string;
      description?: string | null;
      weight?: number;
      primaryCategoryId?: string | null;
      targetDate?: string | null;
    };
    if (!payload.title || payload.title.trim().length === 0) {
      return { error: 'CREATE_GOAL requires title' };
    }
    if (payload.primaryCategoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: payload.primaryCategoryId, userId: action.userId },
      });
      if (!cat) return { error: 'Primary category not found' };
    }
    await prisma.goal.create({
      data: {
        userId: action.userId,
        title: payload.title.trim(),
        description: payload.description ?? null,
        weight: payload.weight ?? 5,
        primaryCategoryId: payload.primaryCategoryId ?? null,
        targetDate: payload.targetDate ? new Date(payload.targetDate) : null,
      },
    });
    return { ok: true };
  }

  if (action.kind === 'CREATE_PROJECT') {
    const payload = action.payload as {
      title?: string;
      description?: string | null;
      body?: string;
      primaryCategoryId?: string | null;
      nextActionAt?: string | null;
      nextActionNote?: string | null;
      alwaysInContext?: boolean;
    };
    if (!payload.title || payload.title.trim().length === 0) {
      return { error: 'CREATE_PROJECT requires title' };
    }
    if (payload.primaryCategoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: payload.primaryCategoryId, userId: action.userId },
      });
      if (!cat) return { error: 'Primary category not found' };
    }
    await prisma.project.create({
      data: {
        userId: action.userId,
        title: payload.title.trim(),
        description: payload.description ?? null,
        body: payload.body ?? '',
        primaryCategoryId: payload.primaryCategoryId ?? null,
        nextActionAt: payload.nextActionAt ? new Date(payload.nextActionAt) : null,
        nextActionNote: payload.nextActionNote ?? null,
        alwaysInContext: payload.alwaysInContext ?? false,
      },
    });
    return { ok: true };
  }

  if (action.kind === 'UPDATE_PROJECT') {
    const payload = action.payload as {
      projectId?: string;
      title?: string;
      description?: string;
      status?: string;
      primaryCategoryId?: string;
      nextActionAt?: string;
      nextActionNote?: string;
      alwaysInContext?: boolean;
    };
    if (!payload.projectId) return { error: 'UPDATE_PROJECT requires projectId' };
    const existing = await prisma.project.findFirst({
      where: { id: payload.projectId, userId: action.userId },
    });
    if (!existing) return { error: 'Project not found' };
    await prisma.project.update({
      where: { id: existing.id },
      data: {
        title: payload.title,
        description: payload.description,
        status: payload.status as 'ACTIVE' | 'PAUSED' | 'COMPLETE' | 'ARCHIVED' | undefined,
        primaryCategoryId: payload.primaryCategoryId,
        nextActionAt: payload.nextActionAt ? new Date(payload.nextActionAt) : undefined,
        nextActionNote: payload.nextActionNote,
        alwaysInContext: payload.alwaysInContext,
      },
    });
    return { ok: true };
  }

  return { error: `Action kind ${action.kind} not yet implemented` };
}
