import type {
  AgentKind,
  AgentRun,
  CalendarResponse,
  Category,
  CategoryCreateInput,
  CategoryUpdate,
  ExternalAccount,
  ExternalAccountUpdate,
  Goal,
  GoalCategoryMapping,
  GoalInput,
  LoginRequest,
  LoginResponse,
  Message,
  MeResponse,
  Overview,
  PatternsResponse,
  CalendarSource,
  CalendarSourceUpsertInput,
  ChatAnchorType,
  ChatMessage as AgentChatMessage,
  ChatThread,
  ProposedAction,
  ProposedActionStatus,
  Observation,
  ObservationKind,
  CommitmentEnforce,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectImportInput,
  DataSource,
  DataSourceCreateInput,
  DataSourceUpdateInput,
  ChatThread as AgentChatThread,
  SharedItem,
  SheetSource,
  SheetSourceRegisterInput,
  SheetSourceUpdateInput,
  UnmappedCalendar,
  Task,
  TaskInput,
  MessageKind,
} from '@time-keeper/shared';
import { useAuth } from './auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = useAuth.getState();
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  // Only declare a JSON body when there actually is one — Fastify rejects
  // application/json POSTs with empty bodies.
  if (init.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401) useAuth.getState().clearSession();
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
};

export const api = {
  // Auth
  login: (body: LoginRequest) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: () => request<MeResponse>('/api/me'),
  health: () => request<{ status: string; service: string }>('/healthz'),

  // Categories
  categories: {
    list: () => request<{ categories: Category[] }>('/api/categories'),
    create: (input: CategoryCreateInput) =>
      request<{ category: Category }>('/api/categories', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: CategoryUpdate) =>
      request<{ category: Category }>(`/api/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
  },

  // Tasks
  tasks: {
    list: (params: { view?: 'today' | 'all'; categoryId?: string; goalId?: string } = {}) =>
      request<{ tasks: Task[] }>(`/api/tasks${qs(params)}`),
    get: (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
    create: (input: TaskInput) =>
      request<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, patch: Partial<TaskInput>) =>
      request<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    complete: (id: string) =>
      request<{ task: Task }>(`/api/tasks/${id}/complete`, { method: 'POST' }),
    uncomplete: (id: string) =>
      request<{ task: Task }>(`/api/tasks/${id}/uncomplete`, { method: 'POST' }),
    delete: (id: string) => request<{ ok: true }>(`/api/tasks/${id}`, { method: 'DELETE' }),
    addPrereq: (taskId: string, prerequisiteId: string) =>
      request<{ ok: true }>(`/api/tasks/${taskId}/prerequisites`, {
        method: 'POST',
        body: JSON.stringify({ prerequisiteId }),
      }),
    removePrereq: (taskId: string, prerequisiteId: string) =>
      request<{ ok: true }>(`/api/tasks/${taskId}/prerequisites/${prerequisiteId}`, {
        method: 'DELETE',
      }),
  },

  // Goals
  goals: {
    list: () => request<{ goals: Goal[] }>('/api/goals'),
    create: (input: GoalInput) =>
      request<{ goal: Goal }>('/api/goals', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, patch: Partial<GoalInput>) =>
      request<{ goal: Goal }>(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    delete: (id: string) => request<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' }),
    linkTask: (goalId: string, taskId: string) =>
      request<{ ok: true }>(`/api/goals/${goalId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      }),
    unlinkTask: (goalId: string, taskId: string) =>
      request<{ ok: true }>(`/api/goals/${goalId}/tasks/${taskId}`, { method: 'DELETE' }),
    setCategories: (goalId: string, mappings: GoalCategoryMapping[]) =>
      request<{ goal: Goal }>(`/api/goals/${goalId}/categories`, {
        method: 'PUT',
        body: JSON.stringify({ mappings }),
      }),
    addPrereq: (goalId: string, prerequisiteId: string) =>
      request<{ ok: true }>(`/api/goals/${goalId}/prerequisites`, {
        method: 'POST',
        body: JSON.stringify({ prerequisiteId }),
      }),
    removePrereq: (goalId: string, prerequisiteId: string) =>
      request<{ ok: true }>(`/api/goals/${goalId}/prerequisites/${prerequisiteId}`, {
        method: 'DELETE',
      }),
  },

  // Overview & patterns
  overview: () => request<Overview>('/api/overview'),
  patterns: (windowDays?: number) =>
    request<PatternsResponse>(`/api/patterns${qs({ windowDays: windowDays?.toString() })}`),

  // External accounts
  accounts: {
    list: () => request<{ accounts: ExternalAccount[] }>('/api/accounts'),
    update: (id: string, patch: ExternalAccountUpdate) =>
      request<{ account: ExternalAccount }>(`/api/accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    startGoogle: () =>
      request<{ url: string }>('/api/accounts/google/start', { method: 'POST' }),
    startMicrosoft: () =>
      request<{ url: string }>('/api/accounts/microsoft/start', { method: 'POST' }),
    disconnect: (id: string) =>
      request<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),
    sync: (id: string) =>
      request<{ result: { ok: boolean; created: number; updated: number; deleted: number; error?: string } }>(
        `/api/accounts/${id}/sync`,
        { method: 'POST' }
      ),
  },

  // Calendar
  calendar: (params: { from?: string; to?: string; accountId?: string; includeHidden?: boolean } = {}) =>
    request<CalendarResponse>(
      `/api/calendar${qs({
        from: params.from,
        to: params.to,
        accountId: params.accountId,
        includeHidden: params.includeHidden ? 'true' : undefined,
      })}`
    ),
  calendarEvents: {
    setHidden: (id: string, userHidden: boolean) =>
      request<{ event: { id: string; userHidden: boolean } }>(
        `/api/calendar-events/${id}`,
        { method: 'PATCH', body: JSON.stringify({ userHidden }) }
      ),
  },

  // Notifications
  devices: {
    list: () =>
      request<{
        devices: Array<{
          id: string;
          userAgent: string | null;
          label: string | null;
          createdAt: string;
          lastUsedAt: string;
        }>;
      }>('/api/devices'),
    register: (input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
      label?: string;
    }) =>
      request<{ device: unknown }>('/api/devices', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/api/devices/${id}`, { method: 'DELETE' }),
  },
  notifications: {
    list: (limit = 50) =>
      request<{
        notifications: Array<{
          id: string;
          kind: string;
          channel: string;
          priority: string;
          title: string;
          body: string;
          url: string | null;
          status: string;
          scheduledFor: string;
          sentAt: string | null;
          error: string | null;
          createdAt: string;
        }>;
      }>(`/api/notifications${qs({ limit: limit.toString() })}`),
    test: () =>
      request<{ dispatched: number }>('/api/notifications/test', { method: 'POST' }),
    channels: () =>
      request<{
        webPush: { configured: boolean; deviceCount: number };
        ntfy: { configured: boolean; topic: string | null };
        vapidPublicKey: string | null;
        ntfyUrl: string | null;
      }>('/api/notifications/channels'),
  },
  notificationSettings: {
    get: () =>
      request<{
        enableNotifications: boolean;
        reminderMinutesBefore: number;
        quietHoursStart: string | null;
        quietHoursEnd: string | null;
      }>('/api/settings/notifications'),
    update: (patch: {
      enableNotifications?: boolean;
      reminderMinutesBefore?: number;
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
    }) =>
      request<{
        enableNotifications: boolean;
        reminderMinutesBefore: number;
        quietHoursStart: string | null;
        quietHoursEnd: string | null;
      }>('/api/settings/notifications', { method: 'PATCH', body: JSON.stringify(patch) }),
  },

  // Agent
  agent: {
    runs: (limit = 20) =>
      request<{ runs: AgentRun[] }>(`/api/agent-runs${qs({ limit: limit.toString() })}`),
    run: (id: string) => request<{ run: AgentRun }>(`/api/agent-runs/${id}`),
    trigger: (kind: AgentKind = 'PRIORITIZATION') =>
      request<{ queued: true; jobId: string; kind: AgentKind }>('/api/agent/run', {
        method: 'POST',
        body: JSON.stringify({ kind }),
      }),
    proposedActions: (status?: ProposedActionStatus) =>
      request<{ actions: ProposedAction[] }>(
        `/api/proposed-actions${qs({ status: status })}`
      ),
    approve: (id: string) =>
      request<{ action: ProposedAction }>(`/api/proposed-actions/${id}/approve`, {
        method: 'POST',
      }),
    deny: (id: string) =>
      request<{ action: ProposedAction }>(`/api/proposed-actions/${id}/deny`, {
        method: 'POST',
      }),
  },

  // Calendar sources (per-calendar labels + category mapping + hide flag)
  calendarSources: {
    list: () =>
      request<{ sources: CalendarSource[]; unmapped: UnmappedCalendar[] }>('/api/calendar-sources'),
    upsert: (input: CalendarSourceUpsertInput) =>
      request<{ source: CalendarSource }>('/api/calendar-sources', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (
      id: string,
      patch: {
        label?: string;
        categoryId?: string | null;
        hidden?: boolean;
        color?: string | null;
        notes?: string | null;
      }
    ) =>
      request<{ source: CalendarSource }>(`/api/calendar-sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/api/calendar-sources/${id}`, { method: 'DELETE' }),
  },

  // Share-target (PWA)
  share: {
    submit: (input: { title?: string; text?: string; url?: string; receivedAt?: string; externalAccountId?: string | null }) =>
      request<{ share: SharedItem }>('/api/share', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    get: (id: string) => request<{ share: SharedItem }>(`/api/share/${id}`),
    pending: () =>
      request<{ pending: SharedItem[]; count: number }>('/api/share/pending'),
    triage: (
      id: string,
      action: 'CONVERTED_TO_TASK' | 'ATTACHED_TO_GOAL' | 'NOTED' | 'DISCARDED',
      externalAccountId?: string | null
    ) =>
      request<{ share: SharedItem }>(`/api/share/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, externalAccountId }),
      }),
    // Dismiss this message AND create a SignalRule so future messages from
    // the same sender/package are auto-DISCARDED at ingestion time.
    dismissAndSuppress: (id: string) =>
      request<{ share: SharedItem; rule?: { id: string; name: string } }>(
        `/api/share/${id}/suppress`,
        { method: 'POST', body: JSON.stringify({}) }
      ),
  },

  sheetSources: {
    list: () => request<{ sources: SheetSource[] }>('/api/sheet-sources'),
    register: (input: SheetSourceRegisterInput) =>
      request<{ source: SheetSource }>('/api/sheet-sources', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: SheetSourceUpdateInput) =>
      request<{ source: SheetSource }>(`/api/sheet-sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/api/sheet-sources/${id}`, { method: 'DELETE' }),
    sync: (id: string) =>
      request<{ result: { ok: boolean; error?: string } }>(`/api/sheet-sources/${id}/sync`, {
        method: 'POST',
      }),
  },

  chat: {
    resolveThread: (anchorType: ChatAnchorType, anchorId: string | null) =>
      request<{ thread: ChatThread }>('/api/chat-threads/resolve', {
        method: 'POST',
        body: JSON.stringify({ anchorType, anchorId }),
      }),
    listThreads: () => request<{ threads: ChatThread[] }>('/api/chat-threads'),
    createGeneralThread: (title?: string) =>
      request<{ thread: ChatThread }>('/api/chat-threads', {
        method: 'POST',
        body: JSON.stringify({ anchorType: 'general', title: title ?? null }),
      }),
    renameThread: (id: string, title: string) =>
      request<{ thread: ChatThread }>(`/api/chat-threads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    deleteThread: (id: string) =>
      request<{ ok: true }>(`/api/chat-threads/${id}`, { method: 'DELETE' }),
    getThread: (id: string) =>
      request<{ thread: ChatThread & { messages: AgentChatMessage[] } }>(`/api/chat-threads/${id}`),
    postMessage: (threadId: string, body: string) =>
      request<{ message: AgentChatMessage; jobId: string }>(
        `/api/chat-threads/${threadId}/messages`,
        { method: 'POST', body: JSON.stringify({ body }) }
      ),
  },

  projects: {
    list: (params: { includeArchived?: boolean; status?: string } = {}) =>
      request<{ projects: Project[] }>(
        `/api/projects${qs({
          includeArchived: params.includeArchived ? 'true' : undefined,
          status: params.status,
        })}`
      ),
    get: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),
    create: (input: ProjectCreateInput) =>
      request<{ project: Project }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: ProjectUpdateInput) =>
      request<{ project: Project }>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
    import: (input: ProjectImportInput) =>
      request<{ project: Project; thread: AgentChatThread; jobId: string }>(
        '/api/projects/import',
        { method: 'POST', body: JSON.stringify(input) }
      ),
    importFiles: async (input: {
      files: File[];
      titleHint?: string;
      categoryId?: string | null;
      secondaryCategoryIds?: string[];
      pastedText?: string;
    }) => {
      const form = new FormData();
      if (input.titleHint) form.append('titleHint', input.titleHint);
      if (input.categoryId) form.append('categoryId', input.categoryId);
      if (input.secondaryCategoryIds?.length) {
        form.append('secondaryCategoryIds', JSON.stringify(input.secondaryCategoryIds));
      }
      if (input.pastedText) form.append('pastedText', input.pastedText);
      for (const f of input.files) form.append('files', f, f.name);

      const { token } = (await import('./auth')).useAuth.getState();
      const res = await fetch(`${API_URL}/api/projects/import-files`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Import failed: ${res.status} ${t.slice(0, 200)}`);
      }
      return (await res.json()) as {
        project: Project;
        thread: AgentChatThread;
        jobId: string;
        attachmentCount: number;
      };
    },
  },

  dataSources: {
    list: () => request<{ sources: DataSource[] }>('/api/data-sources'),
    create: (input: DataSourceCreateInput) =>
      request<{ source: DataSource }>('/api/data-sources', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: DataSourceUpdateInput) =>
      request<{ source: DataSource }>(`/api/data-sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/api/data-sources/${id}`, { method: 'DELETE' }),
    sync: (id: string) =>
      request<{ result: { ok: boolean; error?: string; sizeBytes?: number; truncated?: boolean } }>(
        `/api/data-sources/${id}/sync`,
        { method: 'POST' }
      ),
  },

  dashboard: (windowDays = 30) =>
    request<{ metrics: import('@time-keeper/shared').DashboardMetrics }>(
      `/api/dashboard${qs({ windowDays: String(windowDays) })}`
    ),

  dayRatings: {
    list: (days = 60) =>
      request<{
        ratings: import('@time-keeper/shared').DayRating[];
        today: string;
      }>(`/api/day-ratings${qs({ days: String(days) })}`),
    upsert: (input: { dateKey?: string; rating: number; note?: string | null }) =>
      request<{ rating: import('@time-keeper/shared').DayRating }>('/api/day-ratings', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    delete: (dateKey: string) =>
      request<{ ok: true }>(`/api/day-ratings/${dateKey}`, { method: 'DELETE' }),
  },

  todayCuration: {
    get: () =>
      request<{
        curation: {
          headline: string;
          pinned: Array<{ type: 'task' | 'event' | 'project'; id: string; reason: string }>;
          sourceRunId: string | null;
          updatedAt: string;
        } | null;
      }>('/api/today-curation'),
    clear: () => request<{ ok: true }>('/api/today-curation', { method: 'DELETE' }),
  },

  observations: {
    list: (params: { kind?: ObservationKind; includeArchived?: boolean; includeSuperseded?: boolean } = {}) =>
      request<{ observations: Observation[] }>(
        `/api/observations${qs({
          kind: params.kind,
          includeArchived: params.includeArchived ? 'true' : undefined,
          includeSuperseded: params.includeSuperseded ? 'true' : undefined,
        })}`
      ),
    create: (input: {
      kind: ObservationKind;
      subject: string;
      body: string;
      confidence?: number;
      expiresAt?: string | null;
      enforceLevel?: CommitmentEnforce;
      relatedCategoryIds?: string[];
      relatedGoalIds?: string[];
      relatedTaskIds?: string[];
    }) =>
      request<{ observation: Observation }>('/api/observations', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (
      id: string,
      patch: {
        subject?: string;
        body?: string;
        kind?: ObservationKind;
        confidence?: number;
        expiresAt?: string | null;
        enforceLevel?: CommitmentEnforce;
        confirmedByUser?: boolean;
        archived?: boolean;
      }
    ) =>
      request<{ observation: Observation }>(`/api/observations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/api/observations/${id}`, { method: 'DELETE' }),
  },

  messages: {
    list: (params: { status?: 'pending' | 'all'; source?: 'GMAIL' | 'OUTLOOK' | 'SHARED' | 'all'; accountId?: string; limit?: number } = {}) =>
      request<{
        messages: SharedItem[];
        pendingCount: number;
        bySource: Array<{ source: 'GMAIL' | 'OUTLOOK' | 'SHARED'; count: number }>;
      }>(`/api/messages${qs({
        status: params.status,
        source: params.source,
        accountId: params.accountId,
        limit: params.limit?.toString(),
      })}`),
  },

  // Conversations
  conversations: {
    listMessages: (entity: 'task' | 'goal', entityId: string) =>
      request<{ messages: Message[] }>(`/api/conversations/${entity}/${entityId}/messages`),
    postMessage: (entity: 'task' | 'goal', entityId: string, kind: MessageKind, body: string) =>
      request<{ message: Message }>(`/api/conversations/${entity}/${entityId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ kind, body }),
      }),
  },
};
