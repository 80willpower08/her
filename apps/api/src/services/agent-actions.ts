// Shared helper for creating proposed actions (used by both the legacy JSON-output
// internal endpoint and the new MCP tools). Handles mode defaulting, AUTO-execute,
// and REVIEW/ASK notification dispatch — single source of truth for that behavior.

import type {
  AgentRun,
  ProposedAction,
  ProposedActionKind,
  ProposedActionMode,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { DEFAULT_ACTION_MODE, executeProposedAction } from './agent.js';
import { dispatchNotification } from './notifications.js';

export interface RecordActionInput {
  kind: ProposedActionKind;
  mode?: ProposedActionMode;
  targetType?: string | null;
  targetId?: string | null;
  rationale: string;
  payload: unknown;
  expiresAt?: string | null;
}

/**
 * Create a ProposedAction. If AUTO, execute immediately. If REVIEW/ASK,
 * dispatch a push notification so the user sees there's something to review.
 */
export async function recordProposedAction(
  run: AgentRun,
  input: RecordActionInput
): Promise<ProposedAction> {
  const mode = input.mode ?? DEFAULT_ACTION_MODE[input.kind];
  let action = await prisma.proposedAction.create({
    data: {
      userId: run.userId,
      agentRunId: run.id,
      kind: input.kind,
      mode,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      rationale: input.rationale,
      payload: input.payload as never,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
  });

  if (mode === 'AUTO') {
    const result = await executeProposedAction(action);
    if ('error' in result) {
      action = await prisma.proposedAction.update({
        where: { id: action.id },
        data: { status: 'FAILED', error: result.error },
      });
    } else {
      action = await prisma.proposedAction.update({
        where: { id: action.id },
        data: { status: 'EXECUTED', decidedAt: new Date(), executedAt: new Date() },
      });
    }
  } else {
    const kindLabel = input.kind.toLowerCase().replace(/_/g, ' ');
    await dispatchNotification({
      userId: run.userId,
      kind: 'AGENT_PROPOSAL',
      title: `Agent proposes: ${kindLabel}`,
      body: input.rationale.slice(0, 300),
      url: '/agent',
      sourceType: 'proposed_action',
      sourceId: action.id,
      sourceVersion: 'v1',
      priority: mode === 'ASK' ? 'URGENT' : 'NORMAL',
    }).catch(() => undefined);
  }

  return action;
}

/** Update an AgentRun's summary + observations + final status. */
export async function recordRunSummary(
  run: AgentRun,
  input: { summary: string; observations: string[] }
): Promise<AgentRun> {
  const decision = {
    summary: input.summary,
    observations: input.observations,
    actions: [], // tools created actions; we no longer carry them in decision JSON
  };
  return prisma.agentRun.update({
    where: { id: run.id },
    data: {
      decision: decision as never,
      // status remains RUNNING; the worker flips to OK after claude exits cleanly.
    },
  });
}
