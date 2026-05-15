// Google Sheets sync — pull a registered sheet range, store header + rows
// as a JSON snapshot the agent reads.

import { google } from 'googleapis';
import type { SheetSource } from '@prisma/client';
import { prisma } from '../prisma.js';
import { getAuthenticatedClient, GOOGLE_SCOPE_SHEETS } from './google.js';

const DEFAULT_ROW_LIMIT = 200;
const DEFAULT_COL_LIMIT = 26; // A..Z

export interface SheetSnapshot {
  header: string[];
  rows: Array<Array<string | number | null>>;
  rowCount: number;
  fetchedAt: string;
  rangeUsed: string;
}

function quoteSheetName(name: string): string {
  // A1 notation requires single-quoting any sheet name that isn't pure
  // alphanumeric/underscore. Embedded single quotes are doubled.
  if (/^[A-Za-z0-9_]+$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

function buildRange(source: SheetSource): string {
  // If user gave explicit range, use it. Otherwise default to first N rows × cols.
  const sheetPart = source.sheetName ? `${quoteSheetName(source.sheetName)}!` : '';
  if (source.range && source.range.trim()) {
    return `${sheetPart}${source.range.trim()}`;
  }
  const endCol = colLetter(DEFAULT_COL_LIMIT);
  return `${sheetPart}A1:${endCol}${DEFAULT_ROW_LIMIT}`;
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}

export async function syncSheet(source: SheetSource): Promise<{
  ok: true;
  snapshot: SheetSnapshot;
} | { ok: false; error: string }> {
  const account = await prisma.externalAccount.findUnique({
    where: { id: source.externalAccountId },
  });
  if (!account) return { ok: false, error: 'External account not found' };

  if (!account.scopes.some((s) => s === GOOGLE_SCOPE_SHEETS || s.includes('spreadsheets'))) {
    return {
      ok: false,
      error: 'Spreadsheets scope not granted — reconnect the Google account.',
    };
  }

  const auth = await getAuthenticatedClient(account);
  const sheets = google.sheets({ version: 'v4', auth });

  const range = buildRange(source);

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: source.spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    // success path continues below

    const values = (res.data.values ?? []) as Array<Array<string | number | null>>;
    const header = (values[0] ?? []).map((c) => (c == null ? '' : String(c)));
    const rows = values.slice(1).map((row) =>
      row.map((cell) => (cell == null || cell === '' ? null : cell))
    );

    const snapshot: SheetSnapshot = {
      header,
      rows,
      rowCount: rows.length,
      fetchedAt: new Date().toISOString(),
      rangeUsed: range,
    };

    await prisma.sheetSource.update({
      where: { id: source.id },
      data: {
        snapshot: snapshot as unknown as object,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    return { ok: true, snapshot };
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);

    // If the failure is "Unable to parse range" — usually a wrong tab name —
    // ask Google for the real tab list and include it in the error so the
    // user can pick the right one.
    if (msg.toLowerCase().includes('unable to parse range')) {
      try {
        const meta = await sheets.spreadsheets.get({
          spreadsheetId: source.spreadsheetId,
          fields: 'sheets(properties(title,sheetId,gridProperties(rowCount,columnCount)))',
        });
        const tabs = (meta.data.sheets ?? []).map((s) => {
          const p = s.properties!;
          const grid = p.gridProperties;
          return `"${p.title}" (${grid?.rowCount ?? '?'} rows × ${grid?.columnCount ?? '?'} cols)`;
        });
        msg = `${msg}\n\nAvailable tabs in this spreadsheet:\n  - ${tabs.join('\n  - ')}\n\nClear the "Tab name" field to use the first tab, or set it to one of the names above (without the quotes).`;
      } catch {
        // If meta also fails, leave the original message alone.
      }
    }

    await prisma.sheetSource.update({
      where: { id: source.id },
      data: { lastError: msg.slice(0, 2000), lastSyncedAt: new Date() },
    });
    return { ok: false, error: msg };
  }
}

/** Extract the spreadsheet id from a Google Sheets URL. */
export function parseSpreadsheetId(input: string): string | null {
  // Direct id (44 chars, alnum/-/_)
  if (/^[A-Za-z0-9_-]{30,}$/.test(input.trim())) return input.trim();
  const m = input.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Return the IDs of sheets whose next sync is due. */
export async function findDueSheets(now = new Date()): Promise<SheetSource[]> {
  const candidates = await prisma.sheetSource.findMany({
    where: { enabled: true, syncCadence: { in: ['DAILY', 'WEEKLY'] } },
  });
  return candidates.filter((s) => {
    if (!s.lastSyncedAt) return true; // never synced
    const intervalMs = s.syncCadence === 'DAILY' ? 86_400_000 : 7 * 86_400_000;
    return now.getTime() - s.lastSyncedAt.getTime() >= intervalMs;
  });
}

/** Sheets whose pre-update reminder fire-time has arrived (and reminder not yet sent for this cycle). */
export async function findSheetsNeedingReminder(now = new Date()): Promise<SheetSource[]> {
  const candidates = await prisma.sheetSource.findMany({
    where: {
      enabled: true,
      preUpdateReminderEnabled: true,
      syncCadence: { in: ['DAILY', 'WEEKLY'] },
    },
  });
  return candidates.filter((s) => {
    const intervalMs = s.syncCadence === 'DAILY' ? 86_400_000 : 7 * 86_400_000;
    const reminderLeadMs = s.preUpdateReminderHoursBefore * 3_600_000;
    const nextSyncDue = s.lastSyncedAt
      ? new Date(s.lastSyncedAt.getTime() + intervalMs)
      : now;
    const fireAt = new Date(nextSyncDue.getTime() - reminderLeadMs);
    if (now < fireAt) return false;
    if (now >= nextSyncDue) return false; // sync already due — skip reminder
    if (s.lastReminderSentAt && s.lastReminderSentAt > new Date(nextSyncDue.getTime() - intervalMs)) {
      return false; // already sent this cycle
    }
    return true;
  });
}
