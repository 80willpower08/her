// One-shot cleanup: deletes EmailMessage rows that match the same noise
// criteria the ingestion services now skip at intake — Outlook Junk +
// Deleted Items folders, Gmail Promotions/Social/Updates categories.
//
// Idempotent (running twice is safe; second run will find nothing).
//
// Usage on the api container:
//   docker exec ix-her-api-1 pnpm exec tsx scripts/cleanup-noise-emails.ts

import { PrismaClient } from '@prisma/client';
import { getMsAccessToken, msGraphFetch } from '../src/services/microsoft.js';

const prisma = new PrismaClient();

const GMAIL_SUPPRESS_LABELS = [
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
];

async function cleanupGmail() {
  const result = await prisma.emailMessage.deleteMany({
    where: {
      source: 'GMAIL',
      labels: { hasSome: GMAIL_SUPPRESS_LABELS },
    },
  });
  console.log(`gmail: deleted ${result.count} rows tagged with suppress categories`);
}

async function cleanupOutlookForAccount(accountId: string, accountEmail: string) {
  const account = await prisma.externalAccount.findUnique({ where: { id: accountId } });
  if (!account) return;

  let accessToken: string;
  try {
    accessToken = await getMsAccessToken(account);
  } catch (e) {
    console.log(`outlook[${accountEmail}]: skipping — token refresh failed`);
    return;
  }

  const skipIds: string[] = [];
  for (const wellKnown of ['junkemail', 'deleteditems']) {
    try {
      const folder = await msGraphFetch<{ id?: string }>(
        accessToken,
        `/me/mailFolders/${wellKnown}`
      );
      if (folder.id) skipIds.push(folder.id);
    } catch {
      // Tolerated.
    }
  }
  if (skipIds.length === 0) {
    console.log(`outlook[${accountEmail}]: no junk/deleted folder IDs resolved`);
    return;
  }

  const folderLabels = skipIds.map((id) => `folder:${id}`);
  const result = await prisma.emailMessage.deleteMany({
    where: {
      source: 'OUTLOOK',
      externalAccountId: accountId,
      labels: { hasSome: folderLabels },
    },
  });
  console.log(
    `outlook[${accountEmail}]: deleted ${result.count} rows from junk/deleted folders (${skipIds.length} folder IDs)`
  );
}

async function main() {
  console.log('Counting before cleanup…');
  const beforeRows = await prisma.emailMessage.groupBy({
    by: ['source'],
    _count: { _all: true },
  });
  for (const row of beforeRows) {
    console.log(`  ${row.source}: ${row._count._all}`);
  }

  await cleanupGmail();

  const msAccounts = await prisma.externalAccount.findMany({
    where: { provider: 'MICROSOFT', status: 'ACTIVE' },
    select: { id: true, accountEmail: true },
  });
  for (const acc of msAccounts) {
    await cleanupOutlookForAccount(acc.id, acc.accountEmail);
  }

  console.log('Counting after cleanup…');
  const afterRows = await prisma.emailMessage.groupBy({
    by: ['source'],
    _count: { _all: true },
  });
  for (const row of afterRows) {
    console.log(`  ${row.source}: ${row._count._all}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
