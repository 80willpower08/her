// Pull events from Google Calendar (primary) into CalendarEvent rows.
// Idempotent on (externalAccountId, sourceEventId).

import type { ExternalAccount, IngestionRunStatus } from '@prisma/client';
import type { calendar_v3 } from 'googleapis';
import { prisma } from '../prisma.js';
import { getCalendarClient } from './google.js';

const WINDOW_DAYS_PAST = 7;
const WINDOW_DAYS_FUTURE = 60;

export interface IngestionResult {
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  error?: string;
}

function normalizeStatus(status: string | null | undefined): 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' {
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'tentative') return 'TENTATIVE';
  return 'CONFIRMED';
}

function normalizeTransparency(t: string | null | undefined): 'BUSY' | 'FREE' {
  return t === 'transparent' ? 'FREE' : 'BUSY';
}

function eventBounds(ev: calendar_v3.Schema$Event): { startsAt: Date; endsAt: Date; allDay: boolean } | null {
  const startStr = ev.start?.dateTime ?? ev.start?.date;
  const endStr = ev.end?.dateTime ?? ev.end?.date;
  if (!startStr || !endStr) return null;
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  return {
    startsAt: new Date(startStr),
    endsAt: new Date(endStr),
    allDay,
  };
}

export async function ingestGoogleCalendar(account: ExternalAccount): Promise<IngestionResult> {
  const run = await prisma.ingestionRun.create({
    data: { externalAccountId: account.id, status: 'RUNNING' },
  });

  const result: IngestionResult = { ok: false, fetched: 0, created: 0, updated: 0, deleted: 0 };

  try {
    const calendar = await getCalendarClient(account);
    const timeMin = new Date(Date.now() - WINDOW_DAYS_PAST * 86_400_000).toISOString();
    const timeMax = new Date(Date.now() + WINDOW_DAYS_FUTURE * 86_400_000).toISOString();

    // Enumerate all calendars the user has marked as visible in their UI
    // (shared calendars, family, work — not just "primary"). minAccessRole=reader
    // filters out calendars we can't actually read.
    const calendarListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
    const calendarsToSync = (calendarListRes.data.items ?? []).filter(
      (c) => c.id && c.selected !== false && !c.deleted
    );

    const events: { ev: calendar_v3.Schema$Event; calendarId: string }[] = [];
    for (const cal of calendarsToSync) {
      let pageToken: string | undefined;
      do {
        const res = await calendar.events.list({
          calendarId: cal.id!,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
          pageToken,
          showDeleted: false,
        });
        for (const item of res.data.items ?? []) {
          events.push({ ev: item, calendarId: cal.id! });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    result.fetched = events.length;

    // Upsert in a transaction, then prune events no longer present in window
    const seenSourceIds = new Set<string>();
    for (const { ev, calendarId } of events) {
      if (!ev.id) continue;
      const bounds = eventBounds(ev);
      if (!bounds) continue;
      seenSourceIds.add(ev.id);

      const data = {
        userId: account.userId,
        externalAccountId: account.id,
        sourceEventId: ev.id,
        sourceCalendarId: calendarId,
        iCalUid: ev.iCalUID ?? null,
        recurringEventId: ev.recurringEventId ?? null,
        title: ev.summary ?? '(untitled)',
        description: ev.description ?? null,
        location: ev.location ?? null,
        startsAt: bounds.startsAt,
        endsAt: bounds.endsAt,
        allDay: bounds.allDay,
        isRecurring: Boolean(ev.recurringEventId) || Boolean(ev.recurrence?.length),
        htmlLink: ev.htmlLink ?? null,
        attendees: (ev.attendees ?? []) as object,
        status: normalizeStatus(ev.status),
        transparency: normalizeTransparency(ev.transparency),
        raw: ev as object,
      };

      const before = await prisma.calendarEvent.findUnique({
        where: {
          externalAccountId_sourceEventId: {
            externalAccountId: account.id,
            sourceEventId: ev.id,
          },
        },
        select: { id: true },
      });

      await prisma.calendarEvent.upsert({
        where: {
          externalAccountId_sourceEventId: {
            externalAccountId: account.id,
            sourceEventId: ev.id,
          },
        },
        update: data,
        create: data,
      });

      if (before) result.updated += 1;
      else result.created += 1;
    }

    // Prune events that fell out of the window or were deleted upstream
    const stale = await prisma.calendarEvent.findMany({
      where: {
        externalAccountId: account.id,
        startsAt: { gte: new Date(timeMin), lt: new Date(timeMax) },
        sourceEventId: { notIn: [...seenSourceIds] },
      },
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.calendarEvent.deleteMany({ where: { id: { in: stale.map((e) => e.id) } } });
      result.deleted = stale.length;
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
        itemsDeleted: result.deleted,
      },
    });

    await prisma.externalAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date(), status: 'ACTIVE', lastError: null },
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
        itemsDeleted: result.deleted,
        error: message,
      },
    });
    await prisma.externalAccount.update({
      where: { id: account.id },
      data: {
        status: message.toLowerCase().includes('invalid_grant') ? 'NEEDS_REAUTH' : 'ERROR',
        lastError: message,
      },
    });
    return result;
  }
}
