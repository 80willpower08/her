// Phase 4 agent loop.
// Consumes BullMQ jobs of kind "agent-run" and shells out to Claude Code CLI
// for inference. All persistence happens via the api's /internal/* endpoints —
// the agent container itself is thin and stateless.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';
const SECRET = process.env.INTERNAL_API_SECRET;
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'sonnet';
const AGENT_WORKSPACE = process.env.AGENT_WORKSPACE ?? '/app/agent-workspace';

if (!REDIS_URL) throw new Error('REDIS_URL required');
if (!SECRET) {
  console.warn(
    JSON.stringify({
      service: 'agent',
      ts: new Date().toISOString(),
      msg: 'INTERNAL_API_SECRET missing — agent idle',
    })
  );
}

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ service: 'agent', ts: new Date().toISOString(), msg, ...extra }));
}

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('agent-run', { connection });

interface AgentJobData {
  userId: string;
  kind: 'PRIORITIZATION' | 'ORCHESTRATOR' | 'EMAIL_TRIAGE' | 'CALENDAR_CONFLICT' | 'STATUS_SUMMARY' | 'CHAT';
  trigger: string;
  // CHAT-specific
  chatThreadId?: string;
  userMessageId?: string;
}

const SKILL_BY_KIND: Record<AgentJobData['kind'], string> = {
  PRIORITIZATION: 'prioritization',
  ORCHESTRATOR: 'prioritization', // orchestrator falls back to prioritization in Phase 4.0
  EMAIL_TRIAGE: 'email-triage',
  CALENDAR_CONFLICT: 'prioritization',
  STATUS_SUMMARY: 'prioritization',
  CHAT: 'chat',
};

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-Internal-Secret': SECRET!,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`api ${path} HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

function loadFile(rel: string): string {
  const p = join(AGENT_WORKSPACE, rel);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf-8');
}

function buildPrompt(kind: AgentJobData['kind'], agentRunId: string, context: unknown): string {
  const skillName = SKILL_BY_KIND[kind];
  const skillContent = loadFile(`.claude/skills/${skillName}.md`);
  const claudeMd = loadFile('CLAUDE.md');

  return [
    '# Project orientation',
    claudeMd,
    '',
    `# Active skill: ${skillName}`,
    skillContent,
    '',
    '# This invocation',
    `Your agent run ID is **${agentRunId}** — pass it as the agentRunId parameter on every MCP tool call.`,
    '',
    'Apply the skill to the input context. Use the MCP tools to record observations and recommendations. Be willing to call multiple different tools — the user has a clean approve/deny path for everything REVIEW-mode.',
    '',
    'When done, call `record_run_summary` once. Do not produce any final text output for the user — your output channel is the MCP tools.',
    '',
    '## INPUT CONTEXT (JSON)',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
  ].join('\n');
}

interface ChatThreadData {
  thread: { id: string; anchorType: string; anchorId: string | null };
  anchor: unknown;
}

/** Pull category/goal/task ids out of the chat anchor for observation
 * relevance scoring. We look at the anchor entity's category links — best
 * effort, the api side handles missing fields gracefully. */
function buildAnchorQueryString(
  kind: string,
  threadData: ChatThreadData | null
): string {
  if (kind !== 'CHAT' || !threadData) return '';
  const anchor = threadData.anchor as
    | {
        id?: string;
        categoryId?: string | null;
        primaryCategoryId?: string | null;
        category?: { id: string } | null;
        goalTasks?: Array<{ goal: { id: string } }>;
      }
    | null;
  const cats: string[] = [];
  const goals: string[] = [];
  const tasks: string[] = [];

  if (threadData.thread.anchorType === 'task' && threadData.thread.anchorId) {
    tasks.push(threadData.thread.anchorId);
    if (anchor?.categoryId) cats.push(anchor.categoryId);
    if (anchor?.category?.id) cats.push(anchor.category.id);
    for (const gt of anchor?.goalTasks ?? []) goals.push(gt.goal.id);
  } else if (threadData.thread.anchorType === 'goal' && threadData.thread.anchorId) {
    goals.push(threadData.thread.anchorId);
    if (anchor?.primaryCategoryId) cats.push(anchor.primaryCategoryId);
  } else if (threadData.thread.anchorType === 'category' && threadData.thread.anchorId) {
    cats.push(threadData.thread.anchorId);
  } else if (threadData.thread.anchorType === 'project' && threadData.thread.anchorId) {
    // Project anchor: pull its primary category for observation/sheet/etc.
    // relevance scoring.
    const proj = (threadData.anchor as { project?: { primaryCategoryId?: string | null } } | null)
      ?.project;
    if (proj?.primaryCategoryId) cats.push(proj.primaryCategoryId);
  }

  const parts: string[] = [];
  if (cats.length) parts.push(`anchorCategoryIds=${encodeURIComponent(cats.join(','))}`);
  if (goals.length) parts.push(`anchorGoalIds=${encodeURIComponent(goals.join(','))}`);
  if (tasks.length) parts.push(`anchorTaskIds=${encodeURIComponent(tasks.join(','))}`);
  return parts.length ? '&' + parts.join('&') : '';
}

interface ChatMessage {
  id: string;
  role: 'USER' | 'AGENT' | 'SYSTEM';
  body: string;
  createdAt: string;
}

function buildChatPrompt(
  agentRunId: string,
  thread: ChatThreadData,
  messages: ChatMessage[],
  agentContext: unknown
): string {
  const skillName = SKILL_BY_KIND.CHAT;
  const skillContent = loadFile(`.claude/skills/${skillName}.md`);
  const claudeMd = loadFile('CLAUDE.md');

  const historyText = messages
    .map((m) => {
      const speaker = m.role === 'USER' ? 'User' : m.role === 'AGENT' ? 'Agent (you)' : 'System';
      return `### ${speaker}\n${m.body}`;
    })
    .join('\n\n');

  return [
    '# Project orientation',
    claudeMd,
    '',
    `# Active skill: ${skillName}`,
    skillContent,
    '',
    '# This invocation',
    `Your agent run ID is **${agentRunId}** — pass it as the agentRunId parameter on every MCP tool call.`,
    '',
    `**chatThreadId for this conversation: \`${thread.thread.id}\`** — you MUST pass this exact value as the chatThreadId parameter to \`post_chat_reply\`. Do NOT use the anchor entity id, the agent run id, or any other id.`,
    '',
    `Thread is anchored to **${thread.thread.anchorType}**${thread.thread.anchorId ? ` (id: ${thread.thread.anchorId})` : ''}. The most recent USER message is what you must respond to.`,
    '',
    'After thinking, call `post_chat_reply` once with the final text the user should see. Use `propose_*` MCP tools first for any concrete actions (notes, weight changes, task creations) — those execute or queue for review as usual. **Do not** call `record_run_summary` for CHAT — the chat reply itself is your summary.',
    '',
    '## ANCHOR ENTITY',
    '```json',
    JSON.stringify(thread.anchor, null, 2),
    '```',
    '',
    '## CONVERSATION HISTORY',
    historyText,
    '',
    '## AGENT CONTEXT (same prioritization input you get on daily runs)',
    '```json',
    JSON.stringify(agentContext, null, 2),
    '```',
  ].join('\n');
}

/** Run claude -p in the prepared workspace, capture stdout. */
function runClaude(prompt: string, signal: AbortSignal): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE_BIN,
      ['-p', '--output-format', 'json', '--model', CLAUDE_MODEL],
      {
        cwd: AGENT_WORKSPACE,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, IS_SANDBOX: '1' },
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));

    signal.addEventListener('abort', () => child.kill('SIGTERM'));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

interface ClaudeOutput {
  result?: string; // when --output-format json, the actual completion text is in `result`
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AgentDecision {
  summary?: string;
  observations?: string[];
  actions?: Array<{
    kind: string;
    rationale: string;
    targetType?: string | null;
    targetId?: string | null;
    payload: unknown;
    mode?: 'AUTO' | 'REVIEW' | 'ASK';
    expiresAt?: string | null;
  }>;
}

/** Strip code fences and parse the JSON object from a model output. */
function extractJson(text: string): AgentDecision | null {
  const trimmed = text.trim();
  // Direct JSON
  try {
    return JSON.parse(trimmed) as AgentDecision;
  } catch {
    // Try inside ```json ... ```
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try {
        return JSON.parse(fence[1]) as AgentDecision;
      } catch {
        // fall through
      }
    }
    // Last resort: find first { ... last }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as AgentDecision;
      } catch {
        // fall through
      }
    }
    return null;
  }
}

async function handleJob(job: Job<AgentJobData>) {
  if (!SECRET) throw new Error('INTERNAL_API_SECRET missing');
  const { userId, kind, trigger } = job.data;

  log('agent run starting', { userId, kind, trigger });

  // 1) For CHAT: fetch thread first so we know what to anchor context to.
  let chatThreadData: ChatThreadData | null = null;
  let chatMessages: ChatMessage[] = [];
  if (kind === 'CHAT') {
    if (!job.data.chatThreadId) throw new Error('CHAT job missing chatThreadId');
    const res = await api<{
      thread: ChatThreadData['thread'] & { messages: ChatMessage[] };
      anchor: unknown;
    }>(`/internal/chat-threads/${job.data.chatThreadId}`);
    chatThreadData = { thread: res.thread, anchor: res.anchor };
    chatMessages = res.thread.messages;
  }

  // 2) Build context — pass anchor hints for CHAT so observation curation
  //    favors the thread topic.
  const anchorQs = buildAnchorQueryString(kind, chatThreadData);
  const contextKind = kind === 'CHAT' ? 'PRIORITIZATION' : kind;
  const { context } = await api<{ context: unknown }>(
    `/internal/agent-context?userId=${encodeURIComponent(userId)}&kind=${contextKind}${anchorQs}`
  );

  // 2) Create AgentRun (RUNNING)
  const inputContext = kind === 'CHAT'
    ? { chatThreadId: job.data.chatThreadId, anchor: chatThreadData?.anchor, history: chatMessages, agentContext: context }
    : context;
  const { run } = await api<{ run: { id: string } }>('/internal/agent-runs', {
    method: 'POST',
    body: { userId, kind, trigger, inputContext },
  });

  // 3) Shell out to claude — passes agentRunId so MCP tool calls can attach to the run
  const prompt = kind === 'CHAT'
    ? buildChatPrompt(run.id, chatThreadData!, chatMessages, context)
    : buildPrompt(kind, run.id, context);
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 5 * 60_000); // 5 min ceiling
  let stdout = '';
  let stderr = '';
  let code = -1;
  try {
    const result = await runClaude(prompt, ac.signal);
    stdout = result.stdout;
    stderr = result.stderr;
    code = result.code;
  } finally {
    clearTimeout(timeout);
  }

  if (code !== 0) {
    log('claude exited non-zero', { code, stderr: stderr.slice(0, 500) });
    await api(`/internal/agent-runs/${run.id}`, {
      method: 'PATCH',
      body: {
        status: 'ERROR',
        error: `claude exited ${code}: ${stderr.slice(0, 1000)}`,
        rawOutput: stdout,
      },
    });
    return { ok: false, error: `claude exit ${code}` };
  }

  // 4) Parse claude's wrapper output for token usage. Decision content is
  //    already in the DB — record_run_summary tool wrote it during inference,
  //    plus any propose_* tools created their ProposedActions directly.
  let claudeOut: ClaudeOutput | null = null;
  try {
    claudeOut = JSON.parse(stdout) as ClaudeOutput;
  } catch {
    // not JSON wrapper — that's fine, just no token info
  }

  // 5) Mark run OK + record token usage. record_run_summary tool already
  //    set decision (if claude called it); we don't overwrite it here.
  await api(`/internal/agent-runs/${run.id}`, {
    method: 'PATCH',
    body: {
      status: 'OK',
      rawOutput: stdout,
      inputTokens: claudeOut?.usage?.input_tokens ?? 0,
      outputTokens: claudeOut?.usage?.output_tokens ?? 0,
    },
  });

  // 5b) CHAT safety net: if the agent finished without posting a chat reply
  //     (e.g., called the tool with a bad chatThreadId, or didn't call it),
  //     fall back to posting whatever it emitted as the result so the user
  //     isn't left staring at "Agent is thinking" forever.
  if (kind === 'CHAT' && chatThreadData) {
    const existing = await api<{ thread: { messages: { role: string; agentRunId: string | null }[] } }>(
      `/internal/chat-threads/${chatThreadData.thread.id}`
    );
    const alreadyReplied = existing.thread.messages.some(
      (m) => m.role === 'AGENT' && m.agentRunId === run.id
    );
    if (!alreadyReplied) {
      const fallback = (claudeOut?.result ?? '').trim() ||
        '_The agent finished but did not produce a reply. Try rephrasing your question._';
      await api(`/internal/chat-threads/${chatThreadData.thread.id}/messages`, {
        method: 'POST',
        body: { body: fallback, agentRunId: run.id },
      });
      log('agent chat fallback reply posted', { runId: run.id });
    }
  }

  // Look up actions created during this run for the log line.
  const { actions } = await api<{ actions: { kind: string }[] }>(
    `/internal/agent-runs/${run.id}/actions`
  ).catch(() => ({ actions: [] as { kind: string }[] }));

  log('agent run finished', {
    userId,
    kind,
    actions: actions.length,
    kinds: actions.map((a) => a.kind),
  });
  return { ok: true, actionCount: actions.length };
}

/**
 * Idempotently register our MCP server with Claude Code at startup. This
 * writes a project-scoped entry into the mounted /root/.claude.json so
 * `claude -p` invocations from /app/agent-workspace can call our tools.
 */
async function registerMcpServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(
      CLAUDE_BIN,
      ['mcp', 'add', '--scope', 'local', '--transport', 'http', 'time-keeper', `${API_URL}/mcp`],
      { cwd: AGENT_WORKSPACE, stdio: 'pipe' }
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('close', (code) => {
      // exit 0 = added; non-zero with "already exists" wording also fine
      log('mcp registration', { code, out: out.trim().slice(0, 200) });
      resolve();
    });
  });
}

await registerMcpServer();

const worker = new Worker<AgentJobData>('agent-run', handleJob, {
  connection,
  concurrency: 1,
});

worker.on('failed', (job, err) => {
  log('job failed', { id: job?.id, kind: job?.data?.kind, error: err.message });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    log(`received ${sig}`);
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  });
}

log('agent worker started');
