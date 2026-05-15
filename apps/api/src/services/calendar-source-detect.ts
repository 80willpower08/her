// Heuristics for auto-classifying newly-seen calendars.
//
// Outlook (and sometimes Google) calendars shared with "availability only"
// permission produce events whose title is just "Free"/"Busy"/"Tentative"/etc.
// These are pure noise for prioritization since the actual meeting they
// shadow already shows up under the user's primary calendar with full
// details. We auto-hide them so they don't pollute agent context.

import { prisma } from '../prisma.js';

// Strings the providers use as the title when permission only exposes status.
const AVAILABILITY_ONLY_TITLES = new Set([
  'Free',
  'Busy',
  'Tentative',
  'Out of office',
  'Working elsewhere',
  'No information',
  'Working Elsewhere',
]);

/**
 * For each calendar feeding `externalAccountId`, if every event on it has an
 * availability-only title AND the user hasn't already mapped it, create a
 * hidden CalendarSource so the agent and UI ignore the noise.
 *
 * This never overrides an existing CalendarSource — once the user has made
 * a decision, we respect it.
 */
export async function autoHideAvailabilityCalendars(
  externalAccountId: string,
  userId: string
): Promise<{ autoHidden: number }> {
  const grouped = await prisma.calendarEvent.groupBy({
    by: ['sourceCalendarId'],
    where: { externalAccountId, sourceCalendarId: { not: null } },
    _count: { _all: true },
  });

  let autoHidden = 0;

  for (const g of grouped) {
    if (!g.sourceCalendarId) continue;
    const total = g._count._all;
    if (total === 0) continue;

    const existing = await prisma.calendarSource.findUnique({
      where: {
        externalAccountId_sourceCalendarId: {
          externalAccountId,
          sourceCalendarId: g.sourceCalendarId,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    const availabilityCount = await prisma.calendarEvent.count({
      where: {
        externalAccountId,
        sourceCalendarId: g.sourceCalendarId,
        title: { in: [...AVAILABILITY_ONLY_TITLES] },
      },
    });

    if (availabilityCount === total) {
      await prisma.calendarSource.create({
        data: {
          userId,
          externalAccountId,
          sourceCalendarId: g.sourceCalendarId,
          label: 'Availability-only (auto-hidden)',
          hidden: true,
        },
      });
      autoHidden += 1;
    }
  }

  return { autoHidden };
}
