// Pull recent Outlook messages via Microsoft Graph into EmailMessage rows.
// Idempotent on (externalAccountId, sourceMessageId). Mirrors the Gmail
// ingestion shape so the rest of the app doesn't care which provider a
// message came from.

import type { ExternalAccount, IngestionRunStatus } from '@prisma/client';
import { prisma } from '../prisma.js';
import { getMsAccessToken, msGraphFetch } from './microsoft.js';
import { processNewMessage } from './signal-rules.js';

const WINDOW_DAYS = 7;
const MAX_MESSAGES = 200;
const BODY_MAX_CHARS = 2000;

export interface IngestionResult {
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  /** Messages skipped at ingestion time (junk, deleted folders). */
  skipped?: number;
  error?: string;
}

/**
 * Resolve well-known folder IDs we want to skip (Junk + Deleted Items).
 * Microsoft Graph exposes /me/mailFolders/<wellKnownName> which returns the
 * tenant-specific ID. We tolerate failure on either — if the user has an
 * unusual mailbox setup where one of these is missing, we still proceed.
 */
async function getSkipFolderIds(accessToken: string): Promise<Set<string>> {
  const skip = new Set<string>();
  for (const wellKnown of ['junkemail', 'deleteditems']) {
    try {
      const folder = await msGraphFetch<{ id?: string }>(
        accessToken,
        `/me/mailFolders/${wellKnown}`
      );
      if (folder.id) skip.add(folder.id);
    } catch {
      // Tolerated: continue with whatever we did resolve.
    }
  }
  return skip;
}

interface MsAddress {
  emailAddress?: {
    name?: string | null;
    address?: string | null;
  };
}

interface MsMessage {
  id: string;
  conversationId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: {
    contentType?: 'text' | 'html';
    content?: string;
  };
  from?: MsAddress | null;
  sender?: MsAddress | null;
  toRecipients?: MsAddress[];
  receivedDateTime?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  importance?: 'low' | 'normal' | 'high';
  categories?: string[];
  parentFolderId?: string | null;
}

interface MsListResp {
  value: MsMessage[];
  '@odata.nextLink'?: string;
}

function addressList(arr: MsAddress[] | undefined): string[] {
  if (!arr) return [];
  return arr
    .map((a) => a.emailAddress?.address ?? '')
    .filter((s): s is string => Boolean(s));
}

export async function ingestOutlookMail(account: ExternalAccount): Promise<IngestionResult> {
  const run = await prisma.ingestionRun.create({
    data: { externalAccountId: account.id, status: 'RUNNING' },
  });

  const result: IngestionResult = {
    ok: false,
    fetched: 0,
    created: 0,
    updated: 0,
    deleted: 0,
  };

  try {
    const accessToken = await getMsAccessToken(account);

    // Cache of folder IDs to skip (Junk + Deleted Items). Resolved once per run.
    const skipFolderIds = await getSkipFolderIds(accessToken);

    // Cutoff in ISO 8601 — Graph wants UTC Zulu format
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    // /me/messages returns messages from the user's mailbox (default folder = Inbox + Sent).
    // We use $filter on receivedDateTime, $top for paging, $select to slim the payload.
    const selectFields = [
      'id',
      'conversationId',
      'subject',
      'bodyPreview',
      'body',
      'from',
      'sender',
      'toRecipients',
      'receivedDateTime',
      'isRead',
      'flag',
      'importance',
      'categories',
      'parentFolderId',
    ].join(',');
    const initialPath =
      '/me/messages?' +
      `$filter=receivedDateTime ge ${cutoff}` +
      `&$select=${selectFields}` +
      `&$top=50` +
      `&$orderby=receivedDateTime desc`;

    const messages: MsMessage[] = [];
    let nextLink: string | undefined = initialPath;
    while (nextLink && messages.length < MAX_MESSAGES) {
      const page: MsListResp = await msGraphFetch<MsListResp>(accessToken, nextLink);
      messages.push(...(page.value ?? []));
      nextLink = page['@odata.nextLink'];
    }
    const slice = messages.slice(0, MAX_MESSAGES);
    result.fetched = slice.length;

    for (const m of slice) {
      if (!m.id) continue;

      // Skip messages in Junk / Deleted Items — never create the row.
      if (m.parentFolderId && skipFolderIds.has(m.parentFolderId)) {
        result.skipped = (result.skipped ?? 0) + 1;
        continue;
      }

      const fromAddr = m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address ?? '';
      const fromName = m.from?.emailAddress?.name ?? m.sender?.emailAddress?.name ?? null;
      const subject = m.subject ?? '(no subject)';

      // Body content arrives as either text or html based on Graph's choice.
      // We capture whichever and truncate.
      let bodyText: string | null = null;
      let bodyHtml: string | null = null;
      if (m.body?.content) {
        if (m.body.contentType === 'html') {
          bodyHtml = m.body.content.slice(0, BODY_MAX_CHARS);
        } else {
          bodyText = m.body.content.slice(0, BODY_MAX_CHARS);
        }
      }

      // "Labels" don't map 1:1; we synthesize a small list from MS flags.
      const labels: string[] = [];
      if (m.parentFolderId) labels.push(`folder:${m.parentFolderId}`);
      if (m.flag?.flagStatus === 'flagged') labels.push('FLAGGED');
      if (m.importance === 'high') labels.push('IMPORTANT');
      if (m.categories && m.categories.length) {
        for (const c of m.categories) labels.push(`cat:${c}`);
      }

      const receivedAt = m.receivedDateTime ? new Date(m.receivedDateTime) : new Date();

      const data = {
        userId: account.userId,
        externalAccountId: account.id,
        sourceMessageId: m.id,
        sourceThreadId: m.conversationId ?? null,
        fromAddress: fromAddr,
        fromName,
        toAddresses: addressList(m.toRecipients),
        subject,
        snippet: m.bodyPreview ?? null,
        bodyText,
        bodyHtml,
        labels,
        isUnread: m.isRead === false,
        isStarred: m.flag?.flagStatus === 'flagged',
        isImportant: m.importance === 'high',
        receivedAt,
        source: 'OUTLOOK' as const,
      };

      const before = await prisma.emailMessage.findUnique({
        where: {
          externalAccountId_sourceMessageId: {
            externalAccountId: account.id,
            sourceMessageId: m.id,
          },
        },
        select: { id: true },
      });

      const stored = await prisma.emailMessage.upsert({
        where: {
          externalAccountId_sourceMessageId: {
            externalAccountId: account.id,
            sourceMessageId: m.id,
          },
        },
        update: data,
        create: data,
        select: { id: true },
      });

      if (before) {
        result.updated += 1;
      } else {
        result.created += 1;
        await processNewMessage(stored.id, account.userId, {
          source: 'OUTLOOK',
          fromAddress: data.fromAddress,
          fromName: data.fromName,
          toAddresses: data.toAddresses,
          subject: data.subject,
          bodyText: data.bodyText,
          labels: data.labels,
        });
      }
    }

    result.ok = true;

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: 'OK' satisfies IngestionRunStatus,
        itemsFetched: result.fetched,
        itemsCreated: result.created,
        itemsUpdated: result.updated,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: 'ERROR' satisfies IngestionRunStatus,
        itemsFetched: result.fetched,
        itemsCreated: result.created,
        itemsUpdated: result.updated,
        error: message,
      },
    });
    const lower = message.toLowerCase();
    // Permission issues = scope wasn't granted at OAuth time. Mark for re-auth.
    if (
      lower.includes('forbidden') ||
      lower.includes('http 403') ||
      lower.includes('insufficient') ||
      lower.includes('accessdenied') ||
      lower.includes('mailboxnotenabledforrestapi')
    ) {
      await prisma.externalAccount.update({
        where: { id: account.id },
        data: {
          status: 'NEEDS_REAUTH',
          lastError: 'Outlook mail scope not granted or mailbox unavailable — reconnect to authorize email access.',
        },
      });
    }
    return result;
  }
}
