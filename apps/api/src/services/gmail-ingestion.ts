// Pull recent Gmail messages into EmailMessage rows.
// Idempotent on (externalAccountId, sourceMessageId).

import type { ExternalAccount, IngestionRunStatus } from '@prisma/client';
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { prisma } from '../prisma.js';
import { getAuthenticatedClient } from './google.js';

const WINDOW_DAYS = 7;
const MAX_MESSAGES = 200;
const BODY_MAX_CHARS = 2000;

export interface IngestionResult {
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  error?: string;
}

function decodeBase64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/** Walk parts to find the first text/plain (or text/html as fallback) body. */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): {
  text: string | null;
  html: string | null;
} {
  if (!payload) return { text: null, html: null };
  let text: string | null = null;
  let html: string | null = null;

  function walk(part: gmail_v1.Schema$MessagePart) {
    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (part.mimeType === 'text/plain' && !text) text = decoded;
      else if (part.mimeType === 'text/html' && !html) html = decoded;
    }
    if (part.parts) for (const p of part.parts) walk(p);
  }
  walk(payload);
  return { text, html };
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/** Parse a "Name <email@addr>" header into separate fields. */
function parseAddress(raw: string | null): { name: string | null; address: string } {
  if (!raw) return { name: null, address: '' };
  const m = raw.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), address: m[2].trim() };
  return { name: null, address: raw.trim() };
}

function parseAddressList(raw: string | null): string[] {
  if (!raw) return [];
  // Split on commas not inside quotes; simple heuristic
  return raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((p) => parseAddress(p).address)
    .filter(Boolean);
}

export async function ingestGmail(account: ExternalAccount): Promise<IngestionResult> {
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
    const auth = await getAuthenticatedClient(account);
    const gmail = google.gmail({ version: 'v1', auth });

    // Use Gmail search syntax: messages newer than N days, in inbox or labeled
    const query = `newer_than:${WINDOW_DAYS}d`;

    const messageIds: string[] = [];
    let pageToken: string | undefined;
    do {
      const list = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken,
      });
      for (const m of list.data.messages ?? []) {
        if (m.id) messageIds.push(m.id);
        if (messageIds.length >= MAX_MESSAGES) break;
      }
      pageToken = list.data.nextPageToken ?? undefined;
    } while (pageToken && messageIds.length < MAX_MESSAGES);

    result.fetched = messageIds.length;

    // Fetch + upsert each message
    for (const id of messageIds) {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const msg = res.data;
      if (!msg.id || !msg.payload) continue;

      const headers = msg.payload.headers ?? undefined;
      const from = parseAddress(headerValue(headers, 'From'));
      const to = parseAddressList(headerValue(headers, 'To'));
      const subject = headerValue(headers, 'Subject') ?? '(no subject)';
      const dateHeader = headerValue(headers, 'Date');

      const { text, html } = extractBody(msg.payload);
      const bodyText = text ? text.slice(0, BODY_MAX_CHARS) : null;
      const bodyHtml = !text && html ? html.slice(0, BODY_MAX_CHARS) : null;

      const labels = msg.labelIds ?? [];
      const receivedAt = msg.internalDate
        ? new Date(parseInt(msg.internalDate, 10))
        : dateHeader
          ? new Date(dateHeader)
          : new Date();

      const data = {
        userId: account.userId,
        externalAccountId: account.id,
        sourceMessageId: msg.id,
        sourceThreadId: msg.threadId ?? null,
        fromAddress: from.address,
        fromName: from.name,
        toAddresses: to,
        subject,
        snippet: msg.snippet ?? null,
        bodyText,
        bodyHtml,
        labels,
        isUnread: labels.includes('UNREAD'),
        isStarred: labels.includes('STARRED'),
        isImportant: labels.includes('IMPORTANT'),
        receivedAt,
      };

      const before = await prisma.emailMessage.findUnique({
        where: {
          externalAccountId_sourceMessageId: {
            externalAccountId: account.id,
            sourceMessageId: msg.id,
          },
        },
        select: { id: true },
      });

      await prisma.emailMessage.upsert({
        where: {
          externalAccountId_sourceMessageId: {
            externalAccountId: account.id,
            sourceMessageId: msg.id,
          },
        },
        update: data,
        create: data,
      });

      if (before) result.updated += 1;
      else result.created += 1;
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
    if (lower.includes('insufficient permission') || lower.includes('insufficientpermissions')) {
      // User connected before Gmail scope was added. Mark for re-auth.
      await prisma.externalAccount.update({
        where: { id: account.id },
        data: { status: 'NEEDS_REAUTH', lastError: 'Gmail scope not granted — reconnect to authorize email access.' },
      });
    }
    return result;
  }
}
