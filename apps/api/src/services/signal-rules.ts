// Evaluates SignalRule patterns against incoming EmailMessage data and
// applies the resulting importance + labels. If any matching rule wants
// to push and importance >= HIGH, fires an immediate phone push.
//
// Called from all three ingestion paths: /api/share, gmail-ingestion,
// outlook-mail-ingestion.

import type { EmailSource, NotificationPriority, SignalRule } from '@prisma/client';
import { prisma } from '../prisma.js';
import { dispatchNotification } from './notifications.js';
import { agentRunQueue } from '../lib/queue.js';

export interface ScoringInput {
  source: EmailSource;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string;
  bodyText: string | null;
  labels: string[];
}

export interface ScoringResult {
  importance: NotificationPriority;
  addedLabels: string[];
  shouldPush: boolean;
  matchedRules: Array<{ id: string; name: string }>;
}

const PRIORITY_RANK: Record<NotificationPriority, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3,
};

function lcContains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matchesAny(values: string[], patterns: string[]): boolean {
  if (patterns.length === 0) return true; // No filter = match
  return patterns.some((p) => values.some((v) => lcContains(v, p)));
}

function ruleMatches(input: ScoringInput, rule: SignalRule): boolean {
  if (rule.sources.length > 0 && !rule.sources.includes(input.source)) return false;
  if (!matchesAny(input.toAddresses, rule.toMatches)) return false;
  if (!matchesAny([input.fromAddress, input.fromName ?? ''], rule.fromMatches)) return false;
  if (!matchesAny([input.subject], rule.subjectMatches)) return false;
  if (!matchesAny([input.bodyText ?? ''], rule.bodyMatches)) return false;
  if (!matchesAny(input.labels, rule.labelMatches)) return false;
  return true;
}

/**
 * Evaluate all enabled rules for a user against the incoming message.
 * Multiple rules can match — labels accumulate, importance takes the max.
 */
export async function scoreMessage(
  userId: string,
  input: ScoringInput
): Promise<ScoringResult> {
  const rules = await prisma.signalRule.findMany({
    where: { userId, enabled: true },
    orderBy: { priority: 'asc' },
  });

  let importance: NotificationPriority = 'NORMAL';
  const addedLabels = new Set<string>();
  // Default behavior: anything that ends up HIGH/URGENT will push. A matching
  // rule with pushToPhone=false suppresses that push (opt-out for known noise).
  let pushSuppressed = false;
  const matched: Array<{ id: string; name: string }> = [];

  for (const rule of rules) {
    if (!ruleMatches(input, rule)) continue;
    matched.push({ id: rule.id, name: rule.name });
    if (rule.setImportance && PRIORITY_RANK[rule.setImportance] > PRIORITY_RANK[importance]) {
      importance = rule.setImportance;
    }
    for (const label of rule.addLabels) addedLabels.add(label);
    if (rule.pushToPhone === false) pushSuppressed = true;
  }

  const shouldPush =
    !pushSuppressed && PRIORITY_RANK[importance] >= PRIORITY_RANK.HIGH;

  return { importance, addedLabels: [...addedLabels], shouldPush, matchedRules: matched };
}

/**
 * Apply a scoring result to a freshly-created EmailMessage row and, if the
 * rules say so, fire a phone push. Idempotent on re-runs.
 */
export async function applyScoringToMessage(
  messageId: string,
  userId: string,
  input: ScoringInput,
  result: ScoringResult
): Promise<void> {
  if (
    result.importance === 'NORMAL' &&
    result.addedLabels.length === 0 &&
    !result.shouldPush
  ) {
    return; // No rule fired — nothing to do
  }

  // Merge new labels into the existing labels array.
  const mergedLabels = Array.from(new Set([...input.labels, ...result.addedLabels]));

  // If a user-authored suppression rule matched (recognizable by the
  // "noise:" label prefix), auto-discard at ingestion so the user never
  // sees the row in their PENDING inbox.
  const wasSuppressed = result.addedLabels.some((l) => l.startsWith('noise:'));

  await prisma.emailMessage.update({
    where: { id: messageId },
    data: {
      importance: result.importance,
      labels: mergedLabels,
      isImportant: PRIORITY_RANK[result.importance] >= PRIORITY_RANK.HIGH,
      ...(wasSuppressed ? { triageStatus: 'DISCARDED' as const } : {}),
    },
  });

  if (result.shouldPush) {
    const senderName = input.fromName || input.fromAddress;
    const snippet = (input.bodyText ?? input.subject ?? '').slice(0, 180);
    await dispatchNotification({
      userId,
      kind: 'AGENT_PROPOSAL',
      title: `${senderName}`,
      body: snippet || input.subject || 'New priority message',
      url: '/inbox',
      sourceType: 'email_message',
      sourceId: messageId,
      sourceVersion: 'v1',
      priority: result.importance === 'URGENT' ? 'URGENT' : 'HIGH',
    });
  }
}

/**
 * Convenience: combine scoring + persistence + push for a fresh message.
 * After rule-based scoring, also enqueues a per-message agent scoring job
 * so the AI can refine importance + tag projects + propose noise dismissal.
 */
export async function processNewMessage(
  messageId: string,
  userId: string,
  input: ScoringInput
): Promise<ScoringResult> {
  const result = await scoreMessage(userId, input);
  await applyScoringToMessage(messageId, userId, input, result);

  // Enqueue per-arrival AI scoring. Fire-and-forget — agent processes
  // asynchronously and updates the message via the apply_message_score
  // MCP tool when done. Failure to enqueue is non-fatal; the row keeps
  // whatever the rules engine gave it.
  agentRunQueue
    .add(
      'run',
      { userId, kind: 'SCORE_MESSAGE', trigger: 'message-arrival', messageId },
      { removeOnComplete: 50, removeOnFail: 50 }
    )
    .catch(() => {
      // Swallow; rules-engine importance already applied above.
    });

  return result;
}
