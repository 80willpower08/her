// Seeds default SignalRule entries for the single-user account. Idempotent:
// rules are keyed by (userId, name); re-running updates existing rules in
// place without duplicating.
//
// Usage:
//   pnpm --filter @time-keeper/api exec tsx scripts/seed-signal-rules.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const USER_ID = 'default';

interface SeedRule {
  name: string;
  priority: number;
  sources?: ('GMAIL' | 'OUTLOOK' | 'SHARED' | 'SMS' | 'NOTIFICATION')[];
  toMatches?: string[];
  fromMatches?: string[];
  subjectMatches?: string[];
  bodyMatches?: string[];
  labelMatches?: string[];
  setImportance?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  addLabels?: string[];
  pushToPhone?: boolean;
  suppressDaily?: boolean;
}

const RULES: SeedRule[] = [
  // ── Identity tagging: which "hat" is this message for? ──
  {
    name: 'Transamerica work email',
    priority: 10,
    sources: ['GMAIL', 'OUTLOOK'],
    toMatches: ['@transamerica.com'],
    addLabels: ['context:Transamerica', 'work'],
    setImportance: 'HIGH',
    pushToPhone: true,
  },
  {
    name: 'PDS work email',
    priority: 10,
    sources: ['GMAIL', 'OUTLOOK'],
    toMatches: ['@prescriptive.solutions'],
    addLabels: ['context:PDS', 'work'],
    setImportance: 'HIGH',
    pushToPhone: true,
  },
  {
    name: 'Personal email',
    priority: 20,
    sources: ['GMAIL', 'OUTLOOK'],
    toMatches: ['willpower3039@gmail.com'],
    addLabels: ['context:Personal'],
    setImportance: 'NORMAL',
    pushToPhone: false,
  },

  // ── Notification-source tagging: which phone app posted this? ──
  {
    name: 'Microsoft Teams notification',
    priority: 30,
    sources: ['NOTIFICATION'],
    labelMatches: ['package:com.microsoft.teams'],
    addLabels: ['context:Teams', 'work'],
    setImportance: 'HIGH',
    // Default push behavior — HIGH/URGENT will buzz the phone. Tune later
    // if Teams chat noise becomes a problem.
  },
  {
    name: 'SMS catch-all',
    priority: 30,
    sources: ['SMS'],
    addLabels: ['context:SMS'],
    setImportance: 'NORMAL',
    // NORMAL importance won't trigger a push regardless; add specific
    // higher-importance rules for known senders (wife, family) below.
  },

  // ── Noise suppression — adjust over time as the user observes patterns ──
  {
    name: 'Calendar reminder noise (Google)',
    priority: 200,
    sources: ['NOTIFICATION'],
    labelMatches: ['package:com.google.android.calendar'],
    addLabels: ['noise:calendar'],
    setImportance: 'LOW',
    pushToPhone: false,
    suppressDaily: true,
  },
];

async function main() {
  for (const rule of RULES) {
    const existing = await prisma.signalRule.findFirst({
      where: { userId: USER_ID, name: rule.name },
    });

    const data = {
      userId: USER_ID,
      name: rule.name,
      enabled: true,
      priority: rule.priority,
      sources: rule.sources ?? [],
      toMatches: rule.toMatches ?? [],
      fromMatches: rule.fromMatches ?? [],
      subjectMatches: rule.subjectMatches ?? [],
      bodyMatches: rule.bodyMatches ?? [],
      labelMatches: rule.labelMatches ?? [],
      setImportance: rule.setImportance ?? null,
      addLabels: rule.addLabels ?? [],
      pushToPhone: rule.pushToPhone ?? true,
      suppressDaily: rule.suppressDaily ?? false,
      source: 'DEFAULT_SEED' as const,
    };

    if (existing) {
      await prisma.signalRule.update({ where: { id: existing.id }, data });
      console.log(`updated: ${rule.name}`);
    } else {
      await prisma.signalRule.create({ data });
      console.log(`created: ${rule.name}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
