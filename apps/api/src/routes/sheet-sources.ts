// SheetSource CRUD + manual sync trigger.
//
// Auth: standard JWT. All ops scoped to req.user.userId.

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { parseSpreadsheetId, syncSheet } from '../services/sheets.js';

const SyncCadences = ['MANUAL', 'DAILY', 'WEEKLY'] as const;

const RegisterSchema = {
  type: 'object',
  required: ['externalAccountId', 'spreadsheetIdOrUrl', 'label'],
  properties: {
    externalAccountId: { type: 'string' },
    spreadsheetIdOrUrl: { type: 'string', minLength: 5, maxLength: 2000 },
    sheetName: { type: ['string', 'null'], maxLength: 200 },
    range: { type: ['string', 'null'], maxLength: 200 },
    label: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    categoryId: { type: ['string', 'null'] },
    syncCadence: { type: 'string', enum: SyncCadences as unknown as string[] },
    enabled: { type: 'boolean' },
    preUpdateReminderEnabled: { type: 'boolean' },
    preUpdateReminderHoursBefore: { type: 'integer', minimum: 1, maximum: 168 },
  },
  additionalProperties: false,
} as const;

const UpdateSchema = {
  type: 'object',
  properties: {
    sheetName: { type: ['string', 'null'], maxLength: 200 },
    range: { type: ['string', 'null'], maxLength: 200 },
    label: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    categoryId: { type: ['string', 'null'] },
    syncCadence: { type: 'string', enum: SyncCadences as unknown as string[] },
    enabled: { type: 'boolean' },
    preUpdateReminderEnabled: { type: 'boolean' },
    preUpdateReminderHoursBefore: { type: 'integer', minimum: 1, maximum: 168 },
  },
  additionalProperties: false,
} as const;

export const sheetSourceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/sheet-sources', async (req) => {
    const sources = await prisma.sheetSource.findMany({
      where: { userId: req.user.userId },
      orderBy: [{ label: 'asc' }],
    });
    return { sources };
  });

  app.post<{
    Body: {
      externalAccountId: string;
      spreadsheetIdOrUrl: string;
      sheetName?: string | null;
      range?: string | null;
      label: string;
      description?: string | null;
      categoryId?: string | null;
      syncCadence?: 'MANUAL' | 'DAILY' | 'WEEKLY';
      enabled?: boolean;
      preUpdateReminderEnabled?: boolean;
      preUpdateReminderHoursBefore?: number;
    };
  }>(
    '/api/sheet-sources',
    { schema: { body: RegisterSchema } },
    async (req, reply) => {
      const userId = req.user.userId;

      const account = await prisma.externalAccount.findFirst({
        where: { id: req.body.externalAccountId, userId, provider: 'GOOGLE' },
      });
      if (!account) return reply.badRequest('Unknown or non-Google externalAccountId');

      const spreadsheetId = parseSpreadsheetId(req.body.spreadsheetIdOrUrl);
      if (!spreadsheetId) return reply.badRequest('Could not parse spreadsheet id from URL');

      if (req.body.categoryId) {
        const cat = await prisma.category.findFirst({
          where: { id: req.body.categoryId, userId },
        });
        if (!cat) return reply.badRequest('Unknown categoryId');
      }

      const source = await prisma.sheetSource.create({
        data: {
          userId,
          externalAccountId: req.body.externalAccountId,
          spreadsheetId,
          sheetName: req.body.sheetName ?? null,
          range: req.body.range ?? null,
          label: req.body.label,
          description: req.body.description ?? null,
          categoryId: req.body.categoryId ?? null,
          syncCadence: req.body.syncCadence ?? 'WEEKLY',
          enabled: req.body.enabled ?? true,
          preUpdateReminderEnabled: req.body.preUpdateReminderEnabled ?? true,
          preUpdateReminderHoursBefore: req.body.preUpdateReminderHoursBefore ?? 24,
        },
      });
      return { source };
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      sheetName?: string | null;
      range?: string | null;
      label?: string;
      description?: string | null;
      categoryId?: string | null;
      syncCadence?: 'MANUAL' | 'DAILY' | 'WEEKLY';
      enabled?: boolean;
      preUpdateReminderEnabled?: boolean;
      preUpdateReminderHoursBefore?: number;
    };
  }>('/api/sheet-sources/:id', { schema: { body: UpdateSchema } }, async (req, reply) => {
    const existing = await prisma.sheetSource.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!existing) return reply.notFound();

    if (req.body.categoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: req.body.categoryId, userId: req.user.userId },
      });
      if (!cat) return reply.badRequest('Unknown categoryId');
    }

    const source = await prisma.sheetSource.update({
      where: { id: req.params.id },
      data: {
        sheetName: req.body.sheetName === undefined ? undefined : req.body.sheetName,
        range: req.body.range === undefined ? undefined : req.body.range,
        label: req.body.label,
        description: req.body.description === undefined ? undefined : req.body.description,
        categoryId: req.body.categoryId === undefined ? undefined : req.body.categoryId,
        syncCadence: req.body.syncCadence,
        enabled: req.body.enabled,
        preUpdateReminderEnabled: req.body.preUpdateReminderEnabled,
        preUpdateReminderHoursBefore: req.body.preUpdateReminderHoursBefore,
      },
    });
    return { source };
  });

  app.delete<{ Params: { id: string } }>('/api/sheet-sources/:id', async (req, reply) => {
    const existing = await prisma.sheetSource.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!existing) return reply.notFound();
    await prisma.sheetSource.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  // Manual sync
  app.post<{ Params: { id: string } }>('/api/sheet-sources/:id/sync', async (req, reply) => {
    const source = await prisma.sheetSource.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!source) return reply.notFound();
    const result = await syncSheet(source);
    return { result };
  });
};
