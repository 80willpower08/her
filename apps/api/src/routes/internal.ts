// Routes called by the worker (and other internal services) — auth via
// shared secret header instead of JWT.

import type { FastifyPluginAsync } from 'fastify';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { ingestGoogleCalendar } from '../services/calendar-ingestion.js';
import { ingestGmail } from '../services/gmail-ingestion.js';
import { ingestMicrosoftCalendar } from '../services/microsoft-calendar.js';
import { ingestOutlookMail } from '../services/outlook-mail-ingestion.js';
import { autoHideAvailabilityCalendars } from '../services/calendar-source-detect.js';
import { dispatchDueReminders } from '../services/reminders.js';
import { findDueSheets, findSheetsNeedingReminder, syncSheet } from '../services/sheets.js';
import { findDueDataSources, syncDataSource } from '../services/data-sources.js';
import { dispatchNotification } from '../services/notifications.js';

const HEADER = 'x-internal-secret';

export const internalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (!env.internalApiSecret) {
      return reply.code(503).send({ error: 'Internal API not configured' });
    }
    if (req.headers[HEADER] !== env.internalApiSecret) {
      return reply.unauthorized();
    }
  });

  // List accounts the worker should sync.
  app.get('/internal/syncable-accounts', async () => {
    const accounts = await prisma.externalAccount.findMany({
      where: {
        kind: 'OAUTH',
        status: { in: ['ACTIVE', 'ERROR'] },
      },
      select: { id: true, provider: true, accountEmail: true, lastSyncedAt: true },
    });
    return { accounts };
  });

  // Trigger a sync for one account.
  app.post<{ Params: { id: string } }>('/internal/sync-account/:id', async (req, reply) => {
    const account = await prisma.externalAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return reply.notFound();
    if (account.kind !== 'OAUTH') {
      return reply.badRequest(`Sync not implemented for kind=${account.kind}`);
    }
    if (account.provider === 'GOOGLE') {
      const calendarResult = await ingestGoogleCalendar(account);
      const hasGmailScope = account.scopes.some((s) => s.includes('gmail'));
      const mailResult = hasGmailScope ? await ingestGmail(account) : null;
      const detect = calendarResult.ok
        ? await autoHideAvailabilityCalendars(account.id, account.userId)
        : { autoHidden: 0 };
      return { result: calendarResult, mail: mailResult ?? undefined, detect };
    }
    if (account.provider === 'MICROSOFT') {
      const calendarResult = await ingestMicrosoftCalendar(account);
      const hasMailScope = account.scopes.some(
        (s) => s.toLowerCase() === 'mail.read' || s.toLowerCase().endsWith('/mail.read')
      );
      const mailResult = hasMailScope ? await ingestOutlookMail(account) : null;
      const detect = calendarResult.ok
        ? await autoHideAvailabilityCalendars(account.id, account.userId)
        : { autoHidden: 0 };
      return { result: calendarResult, mail: mailResult ?? undefined, detect };
    }
    return reply.badRequest(`Unsupported provider: ${account.provider}`);
  });

  // Dispatch any reminders whose fire-time has arrived.
  app.post('/internal/dispatch-due-reminders', async () => {
    const summary = await dispatchDueReminders();
    return { summary };
  });

  // Tick the sheet sync schedule: send pre-update reminders for sheets whose
  // reminder window opened, and sync any sheets whose cadence is due.
  app.post('/internal/tick-sheet-sync', async () => {
    const remindersToSend = await findSheetsNeedingReminder();
    let remindersSent = 0;
    for (const sheet of remindersToSend) {
      try {
        await dispatchNotification({
          userId: sheet.userId,
          kind: 'AGENT_PROPOSAL',
          title: `Time to refresh ${sheet.label}`,
          body: `Agent reads "${sheet.label}" in ~${sheet.preUpdateReminderHoursBefore}h. Take a few minutes to update balances/numbers so its picture is current.`,
          url: '/settings',
          sourceType: 'sheet_source',
          sourceId: sheet.id,
          sourceVersion: 'v1',
          priority: 'NORMAL',
        });
        await prisma.sheetSource.update({
          where: { id: sheet.id },
          data: { lastReminderSentAt: new Date() },
        });
        remindersSent += 1;
      } catch {
        // best-effort
      }
    }

    const dueSheets = await findDueSheets();
    let syncedOk = 0;
    let syncedErr = 0;
    for (const s of dueSheets) {
      const r = await syncSheet(s);
      if (r.ok) syncedOk += 1;
      else syncedErr += 1;
    }

    return { remindersSent, syncedOk, syncedErr };
  });

  // Tick the DataSource sync schedule. Called by the worker on a cadence.
  app.post('/internal/tick-data-source-sync', async () => {
    const dueSources = await findDueDataSources();
    let syncedOk = 0;
    let syncedErr = 0;
    for (const s of dueSources) {
      const r = await syncDataSource(s);
      if (r.ok) syncedOk += 1;
      else syncedErr += 1;
    }
    return { syncedOk, syncedErr, considered: dueSources.length };
  });
};
