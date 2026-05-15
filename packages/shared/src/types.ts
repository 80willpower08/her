// Domain types matching API JSON responses (dates serialized as ISO strings).

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type DerivedPriority = TaskPriority;

export interface Category {
  id: string;
  userId: string;
  slug: string;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  weight: number;
  isDefault: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  // Decorated by API:
  progress: number;
}

export interface RankBreakdown {
  importance: number;
  urgency: number;
  performance: number;
  rank: number;
  derivedPriority: DerivedPriority;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  priority: TaskPriority;
  weight: number;
  dueDate: string | null;
  scheduledFor: string | null;
  estimatedMinutes: number | null;
  recurrence: unknown | null;
  completed: boolean;
  completedAt: string | null;
  timeSpent: number;
  streakCount: number;
  tags: string[];
  notes: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  linkedCalendarEventId: string | null;
  // Decorated by API:
  isBlocked: boolean;
  prerequisiteIds: string[];
  subtaskIds: string[];
  progress: number;
  importance: number;
  urgency: number;
  rank: number;
  rankBreakdown: RankBreakdown;
  derivedPriority: DerivedPriority;
  linkedCalendarEvent: { id: string; title: string; startsAt: string } | null;
}

export interface GoalCategoryMapping {
  categoryId: string;
  isPrimary: boolean;
  percentage: number;
}

export interface Goal {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  weight: number;
  primaryCategoryId: string | null;
  targetDate: string | null;
  targetValue: number | null;
  currentValue: number | null;
  completed: boolean;
  completedAt: string | null;
  archived: boolean;
  progress: number;
  createdAt: string;
  updatedAt: string;
  // Decorated by API:
  linkedTaskIds: string[];
  totalTasks: number;
  completedTasks: number;
  weightedProgress: number;
  categoryMappings: GoalCategoryMapping[];
  prerequisiteIds: string[];
  isBlocked: boolean;
}

export type MessageKind =
  | 'NOTE'
  | 'QUESTION'
  | 'INSTRUCTION'
  | 'AGENT_REPLY'
  | 'AGENT_ACTION'
  | 'AGENT_STATUS';

export type MessageAuthorType = 'USER' | 'AGENT';

export interface Message {
  id: string;
  conversationId: string;
  kind: MessageKind;
  body: string;
  authorType: MessageAuthorType;
  authorId: string | null;
  createdAt: string;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  categoryId?: string | null;
  priority?: TaskPriority;
  weight?: number;
  dueDate?: string | null;
  scheduledFor?: string | null;
  estimatedMinutes?: number | null;
  parentId?: string | null;
  tags?: string[];
  notes?: string | null;
  linkedCalendarEventId?: string | null;
}

export interface GoalInput {
  title: string;
  description?: string | null;
  primaryCategoryId?: string | null;
  targetDate?: string | null;
  targetValue?: number | null;
  archived?: boolean;
  completed?: boolean;
  weight?: number;
}

export interface CategoryUpdate {
  name?: string;
  color?: string;
  icon?: string | null;
  weight?: number;
  sortOrder?: number;
  archived?: boolean;
}

// --- Overview ---
export interface OverviewTaskNode extends Task {
  subtasks: OverviewTaskNode[];
}

export interface OverviewGoalNode {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  completed: boolean;
  archived: boolean;
  targetDate: string | null;
  contributionPercentage: number;
  isSecondary: boolean;
  tasks: OverviewTaskNode[];
}

export interface OverviewCategoryNode {
  category: Category;
  primaryGoals: OverviewGoalNode[];
  secondaryGoals: OverviewGoalNode[];
  looseTasks: OverviewTaskNode[];
}

export interface Overview {
  categories: OverviewCategoryNode[];
  uncategorized: {
    looseTasks: OverviewTaskNode[];
    goals: OverviewGoalNode[];
  };
}

// --- Patterns ---
export interface CategoryPatternStats {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  sampleSize: number;
  completionRate: number;
  onTimeRate: number;
  avgEstimatedAccuracy: number | null;
  classification: 'strength' | 'neutral' | 'struggle' | 'unknown';
}

export interface PatternsResponse {
  windowDays: number;
  byCategory: CategoryPatternStats[];
}

// --- External accounts + calendar events ---

export type ExternalAccountKind = 'OAUTH' | 'ICS_URL';
export type ExternalAccountProvider = 'GOOGLE' | 'MICROSOFT' | 'ICS';
export type ExternalAccountStatus = 'ACTIVE' | 'NEEDS_REAUTH' | 'ERROR' | 'DISCONNECTED';

export interface ExternalAccount {
  id: string;
  kind: ExternalAccountKind;
  provider: ExternalAccountProvider;
  accountEmail: string | null;
  displayName: string | null;
  label: string | null;
  defaultCategoryId: string | null;
  color: string;
  status: ExternalAccountStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  scopes: string[];
  createdAt: string;
}

export interface ExternalAccountUpdate {
  label?: string | null;
  color?: string;
  defaultCategoryId?: string | null;
}

export interface CategoryCreateInput {
  name: string;
  color?: string;
  icon?: string | null;
  weight?: number;
}

export type CalendarEventStatus = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
export type CalendarEventTransparency = 'BUSY' | 'FREE';

export interface CalendarEvent {
  id: string;
  externalAccountId: string;
  sourceEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  isRecurring: boolean;
  htmlLink: string | null;
  status: CalendarEventStatus;
  transparency: CalendarEventTransparency;
  userHidden?: boolean;
}

export interface CalendarResponse {
  events: CalendarEvent[];
  accounts: { id: string; color: string; displayName: string | null; accountEmail: string | null }[];
}

// --- Agent runs + proposed actions ---

export type AgentKind =
  | 'ORCHESTRATOR'
  | 'PRIORITIZATION'
  | 'EMAIL_TRIAGE'
  | 'CALENDAR_CONFLICT'
  | 'STATUS_SUMMARY';

export type AgentRunStatus = 'RUNNING' | 'OK' | 'ERROR' | 'CANCELLED';

export type ProposedActionKind =
  | 'POST_NOTE'
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'COMPLETE_TASK'
  | 'ADJUST_WEIGHT'
  | 'RESCHEDULE_TASK'
  | 'LINK_TASK_TO_EVENT'
  | 'ARCHIVE_TASK'
  | 'DECLINE_MEETING';

export type ProposedActionMode = 'AUTO' | 'REVIEW' | 'ASK';

export type ProposedActionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'DENIED'
  | 'EXECUTED'
  | 'EXPIRED'
  | 'FAILED';

export interface ProposedAction {
  id: string;
  agentRunId: string;
  kind: ProposedActionKind;
  mode: ProposedActionMode;
  status: ProposedActionStatus;
  targetType: string | null;
  targetId: string | null;
  rationale: string;
  payload: unknown;
  expiresAt: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  userId: string;
  kind: AgentKind;
  trigger: string;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt: string | null;
  inputContext: unknown;
  rawOutput: string | null;
  decision: {
    summary?: string;
    observations?: string[];
    actions?: unknown[];
  } | null;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  proposedActions: ProposedAction[];
}

export type EmailSource = 'GMAIL' | 'OUTLOOK' | 'SHARED';
export type EmailTriageStatus =
  | 'NONE'
  | 'PENDING'
  | 'CONVERTED_TO_TASK'
  | 'ATTACHED_TO_GOAL'
  | 'NOTED'
  | 'DISCARDED';

export interface CalendarSource {
  id: string;
  userId: string;
  externalAccountId: string;
  sourceCalendarId: string;
  label: string;
  categoryId: string | null;
  hidden: boolean;
  color: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  eventCount?: number;
}

export interface UnmappedCalendar {
  externalAccountId: string;
  sourceCalendarId: string;
  eventCount: number;
  sampleTitles?: string[];
}

export interface CalendarSourceUpsertInput {
  externalAccountId: string;
  sourceCalendarId: string;
  label: string;
  categoryId?: string | null;
  hidden?: boolean;
  color?: string | null;
  notes?: string | null;
}

export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETE' | 'ARCHIVED';

export interface Project {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  body: string;
  status: ProjectStatus;
  primaryCategoryId: string | null;
  secondaryCategoryIds: string[];
  nextActionAt: string | null;
  nextActionNote: string | null;
  alwaysInContext: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCreateInput {
  title: string;
  description?: string | null;
  body?: string;
  status?: ProjectStatus;
  primaryCategoryId?: string | null;
  secondaryCategoryIds?: string[];
  nextActionAt?: string | null;
  nextActionNote?: string | null;
  alwaysInContext?: boolean;
}

export interface ProjectUpdateInput {
  title?: string;
  description?: string | null;
  body?: string;
  status?: ProjectStatus;
  primaryCategoryId?: string | null;
  secondaryCategoryIds?: string[];
  nextActionAt?: string | null;
  nextActionNote?: string | null;
  alwaysInContext?: boolean;
  archived?: boolean;
}

export interface ProjectImportInput {
  rawContent: string;
  titleHint?: string | null;
  categoryId?: string | null;
  secondaryCategoryIds?: string[];
}

export type ObservationKind =
  | 'FACT'
  | 'PATTERN'
  | 'PREFERENCE'
  | 'COMMITMENT'
  | 'INSIGHT'
  | 'CONCERN';

export type CommitmentEnforce = 'NORMAL' | 'BLOCK';

export interface Observation {
  id: string;
  userId: string;
  kind: ObservationKind;
  subject: string;
  body: string;
  confidence: number;
  source: string;
  sourceRunId: string | null;
  sourceThreadId: string | null;
  relatedCategoryIds: string[];
  relatedGoalIds: string[];
  relatedTaskIds: string[];
  enforceLevel: CommitmentEnforce;
  supersedesId: string | null;
  supersededAt: string | null;
  archived: boolean;
  expiresAt: string | null;
  confirmedByUser: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardMetrics {
  windowDays: number;
  generatedAt: string;
  timezone: string;
  kpis: {
    tasksCompleted: { current: number; prior: number };
    goalMomentum: { current: number; prior: number };
    approvalRate: { current: number; prior: number };
    procrastinationIndex: { current: number; prior: number };
  };
  categories: Array<{
    id: string;
    name: string;
    color: string;
    weight: number;
    completedInWindow: number;
    activeTaskCount: number;
    staleTaskCount: number;
    medianLeadTimeHours: number | null;
    onTimeRate: number | null;
    sparkline: number[];
  }>;
  goals: Array<{
    id: string;
    title: string;
    primaryCategoryId: string | null;
    weight: number;
    progress: number;
    completed: boolean;
    targetDate: string | null;
    paceState: 'no-target' | 'on-pace' | 'ahead' | 'behind' | 'overdue' | 'done';
    pctTimeElapsed: number | null;
    paceDeltaDays: number | null;
    linkedTaskTotal: number;
    linkedTaskComplete: number;
  }>;
  approvalByKind: Array<{
    kind: string;
    decided: number;
    approved: number;
    rate: number;
  }>;
  streakGrid: Array<{
    date: string;
    count: number;
    byCategory: Record<string, number>;
  }>;
  timeOfDay: number[];
  dayOfWeek: number[];
  growthFeed: Array<{
    date: string;
    kind: 'goal-complete' | 'project-complete' | 'goal-milestone' | 'streak' | 'sheet-update';
    title: string;
    detail: string;
    goalId?: string;
    projectId?: string;
    categoryId?: string;
  }>;
  finance: {
    available: boolean;
    totalDebt: number | null;
    totalCurrentValue: number | null;
    monthlyDebtPayments: number | null;
    lastSyncedAt: string | null;
    sourceLabel: string | null;
    note: string | null;
  };
  dayRatings: {
    average: number | null;
    count: number;
    today: string;
    todaysRating: number | null;
    series: Array<{ date: string; rating: number; note: string | null }>;
    correlation: {
      highDayAvgCompletions: number | null;
      lowDayAvgCompletions: number | null;
      strongestCategoryName: string | null;
      strongestCategoryEffect: number | null;
    };
  };
}

export interface DayRating {
  id: string;
  userId: string;
  dateKey: string;
  rating: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DataSourceAuthMode = 'NONE' | 'BEARER' | 'BASIC' | 'COOKIE_LOGIN' | 'CUSTOM_HEADERS';
export type DataSourceSyncCadence = 'MANUAL' | 'HOURLY' | 'DAILY' | 'WEEKLY';

export interface DataSource {
  id: string;
  userId: string;
  label: string;
  description: string | null;
  baseUrl: string;
  endpointPath: string;
  authMode: DataSourceAuthMode;
  authConfig: Record<string, unknown> | null;
  staticHeaders: Record<string, string> | null;
  categoryId: string | null;
  syncCadence: DataSourceSyncCadence;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  snapshot: {
    data?: unknown;
    fetchedAt?: string;
    status?: number;
    sizeBytes?: number;
    truncated?: boolean;
    contentType?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataSourceCreateInput {
  label: string;
  description?: string | null;
  baseUrl: string;
  endpointPath: string;
  authMode?: DataSourceAuthMode;
  authConfig?: Record<string, unknown> | null;
  staticHeaders?: Record<string, string> | null;
  categoryId?: string | null;
  syncCadence?: DataSourceSyncCadence;
  enabled?: boolean;
}

export interface DataSourceUpdateInput {
  label?: string;
  description?: string | null;
  baseUrl?: string;
  endpointPath?: string;
  authMode?: DataSourceAuthMode;
  authConfig?: Record<string, unknown> | null;
  staticHeaders?: Record<string, string> | null;
  categoryId?: string | null;
  syncCadence?: DataSourceSyncCadence;
  enabled?: boolean;
}

export type SheetSyncCadence = 'MANUAL' | 'DAILY' | 'WEEKLY';

export interface SheetSource {
  id: string;
  userId: string;
  externalAccountId: string;
  spreadsheetId: string;
  sheetName: string | null;
  range: string | null;
  label: string;
  description: string | null;
  categoryId: string | null;
  syncCadence: SheetSyncCadence;
  enabled: boolean;
  preUpdateReminderEnabled: boolean;
  preUpdateReminderHoursBefore: number;
  lastReminderSentAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  snapshot: {
    header?: string[];
    rows?: Array<Array<string | number | null>>;
    rowCount?: number;
    fetchedAt?: string;
    rangeUsed?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SheetSourceRegisterInput {
  externalAccountId: string;
  spreadsheetIdOrUrl: string;
  sheetName?: string | null;
  range?: string | null;
  label: string;
  description?: string | null;
  categoryId?: string | null;
  syncCadence?: SheetSyncCadence;
  enabled?: boolean;
  preUpdateReminderEnabled?: boolean;
  preUpdateReminderHoursBefore?: number;
}

export interface SheetSourceUpdateInput {
  sheetName?: string | null;
  range?: string | null;
  label?: string;
  description?: string | null;
  categoryId?: string | null;
  syncCadence?: SheetSyncCadence;
  enabled?: boolean;
  preUpdateReminderEnabled?: boolean;
  preUpdateReminderHoursBefore?: number;
}

export type ChatAnchorType =
  | 'task'
  | 'goal'
  | 'event'
  | 'message'
  | 'proposed_action'
  | 'category'
  | 'project'
  | 'general';
export type ChatRole = 'USER' | 'AGENT' | 'SYSTEM';

export interface ChatThread {
  id: string;
  userId: string;
  anchorType: ChatAnchorType;
  anchorId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatRole;
  body: string;
  agentRunId: string | null;
  createdAt: string;
}

export interface SharedItem {
  id: string;
  userId: string;
  externalAccountId: string | null;
  source: EmailSource;
  sourceMessageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  sourceUrl: string | null;
  labels: string[];
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  triageStatus: EmailTriageStatus;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}
