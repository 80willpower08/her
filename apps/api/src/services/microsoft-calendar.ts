// Pull events from Microsoft Graph (/me/calendarView) into CalendarEvent rows.
// Mirrors the Google ingestion pattern: idempotent upsert on (accountId, sourceEventId).

import type { ExternalAccount, IngestionRunStatus } from '@prisma/client';
import { prisma } from '../prisma.js';
import { getMsAccessToken, msGraphFetch } from './microsoft.js';

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

interface MsAttendee {
  type?: string;
  status?: { response?: string; time?: string };
  emailAddress?: { name?: string; address?: string };
}

interface MsEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  responseStatus?: { response?: string };
  showAs?: string;
  recurrence?: unknown;
  seriesMasterId?: string | null;
  type?: string;
  webLink?: string;
  attendees?: MsAttendee[];
  organizer?: { emailAddress?: { name?: string; address?: string } };
}

interface MsCalendarListItem {
  id: string;
  name?: string;
  isDefaultCalendar?: boolean;
}

function normalizeStatus(ev: MsEvent): 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' {
  if (ev.isCancelled) return 'CANCELLED';
  // Microsoft uses showAs: free|tentative|busy|oof|workingElsewhere|unknown
  if (ev.showAs === 'tentative') return 'TENTATIVE';
  return 'CONFIRMED';
}

function normalizeTransparency(ev: MsEvent): 'BUSY' | 'FREE' {
  return ev.showAs === 'free' ? 'FREE' : 'BUSY';
}

function eventBounds(
  ev: MsEvent
): { startsAt: Date; endsAt: Date; allDay: boolean } | null {
  const startStr = ev.start?.dateTime;
  const endStr = ev.end?.dateTime;
  if (!startStr || !endStr) return null;
  // Graph returns datetime as 'YYYY-MM-DDTHH:mm:ss.fffffff' without Z, with timeZone separately.
  // For simplicity we treat it as UTC if no offset — tz handling can refine later.
  const startsAt = new Date(/[Z+-]\d/.test(startStr) ? startStr : startStr + 'Z');
  const endsAt = new Date(/[Z+-]\d/.test(endStr) ? endStr : endStr + 'Z');
  return { startsAt, endsAt, allDay: Boolean(ev.isAllDay) };
}

export async function ingestMicrosoftCalendar(
  account: ExternalAccount
): Promise<IngestionResult> {
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

    // Enumerate calendars the user can read
    const listRes = await msGraphFetch<{ value: MsCalendarListItem[] }>(
      accessToken,
      '/me/calendars'
    );
    const calendars = listRes.value;

    const timeMin = new Date(Date.now() - WINDOW_DAYS_PAST * 86_400_000).toISOString();
    const timeMax = new Date(Date.now() + WINDOW_DAYS_FUTURE * 86_400_000).toISOString();

    const events: { ev: MsEvent; calendarId: string }[] = [];

    for (const cal of calendars) {
      // Use calendarView to expand recurring events into instances within the window
      let nextLink: string | null =
        `/me/calendars/${cal.id}/calendarView?` +
        new URLSearchParams({
          startDateTime: timeMin,
          endDateTime: timeMax,
          $top: '250',
          $orderby: 'start/dateTime',
        }).toString();

      while (nextLink) {
        const page: { value: MsEvent[]; '@odata.nextLink'?: string } = await msGraphFetch<{
          value: MsEvent[];
          '@odata.nextLink'?: string;
        }>(accessToken, nextLink);
        for (const ev of page.value) {
          events.push({ ev, calendarId: cal.id });
        }
        nextLink = page['@odata.nextLink'] ?? null;
      }
    }

    result.fetched = events.length;

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
        iCalUid: ev.iCalUId ?? null,
        recurringEventId: ev.seriesMasterId ?? null,
        title: ev.subject ?? '(untitled)',
        description: ev.bodyPreview ?? null,
        location: ev.location?.displayName ?? null,
        startsAt: bounds.startsAt,
        endsAt: bounds.endsAt,
        allDay: bounds.allDay,
        isRecurring: Boolean(ev.seriesMasterId) || Boolean(ev.recurrence),
        htmlLink: ev.webLink ?? null,
        attendees: (ev.attendees ?? []) as object,
        status: normalizeStatus(ev),
        transparency: normalizeTransparency(ev),
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

    // Prune stale events from this account within window
    const stale = await prisma.calendarEvent.findMany({
      where: {
        externalAccountId: account.id,
        startsAt: { gte: new Date(timeMin), lt: new Date(timeMax) },
        sourceEventId: { notIn: [...seenSourceIds] },
      },
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.calendarEvent.deleteMany({
        where: { id: { in: stale.map((e) => e.id) } },
      });
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
    const lower = message.toLowerCase();
    const status =
      lower.includes('invalid_grant') || lower.includes('aadsts70008') || lower.includes('aadsts50173')
        ? 'NEEDS_REAUTH'
        : 'ERROR';
    await prisma.externalAccount.update({
      where: { id: account.id },
      data: { status, lastError: message },
    });
    return result;
  }
}
