// DataSource CRUD + manual sync. Auth-gated to req.user.userId.

import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { syncDataSource } from '../services/data-sources.js';

const AUTH_MODES = ['NONE', 'BEARER', 'BASIC', 'COOKIE_LOGIN', 'CUSTOM_HEADERS'] as const;
const CADENCES = ['MANUAL', 'HOURLY', 'DAILY', 'WEEKLY'] as const;

const CreateSchema = {
  type: 'object',
  required: ['label', 'baseUrl', 'endpointPath'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    baseUrl: { type: 'string', minLength: 5, maxLength: 500 },
    endpointPath: { type: 'string', minLength: 1, maxLength: 500 },
    authMode: { type: 'string', enum: AUTH_MODES as unknown as string[] },
    authConfig: { type: ['object', 'null'] },
    staticHeaders: { type: ['object', 'null'] },
    categoryId: { type: ['string', 'null'] },
    syncCadence: { type: 'string', enum: CADENCES as unknown as string[] },
    enabled: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const PatchSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    baseUrl: { type: 'string', minLength: 5, maxLength: 500 },
    endpointPath: { type: 'string', minLength: 1, maxLength: 500 },
    authMode: { type: 'string', enum: AUTH_MODES as unknown as string[] },
    authConfig: { type: ['object', 'null'] },
    staticHeaders: { type: ['object', 'null'] },
    categoryId: { type: ['string', 'null'] },
    syncCadence: { type: 'string', enum: CADENCES as unknown as string[] },
    enabled: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

// Strip secrets from the response so the UI never re-displays them after save.
function redactAuthConfig(authMode: string, cfg: unknown): unknown {
  if (cfg && typeof cfg === 'object') {
    const c = cfg as Record<string, unknown>;
    if (authMode === 'BEARER' && c.token) return { token: '__set__' };
    if (authMode === 'BASIC' && c.password) return { username: c.username, password: '__set__' };
    if (authMode === 'COOKIE_LOGIN' && c.loginBody) {
      const lb = (c.loginBody as Record<string, unknown>) ?? {};
      const redactedBody = { ...lb };
      if (redactedBody.password) redactedBody.password = '__set__';
      return { ...c, loginBody: redactedBody };
    }
  }
  return cfg ?? null;
}

function shape(src: { id: string; userId: string; label: string; description: string | null; baseUrl: string; endpointPath: string; authMode: string; authConfig: unknown; staticHeaders: unknown; categoryId: string | null; syncCadence: string; enabled: boolean; lastSyncedAt: Date | null; lastError: string | null; snapshot: unknown; createdAt: Date; updatedAt: Date }) {
  return {
    ...src,
    authConfig: redactAuthConfig(src.authMode, src.authConfig),
    lastSyncedAt: src.lastSyncedAt?.toISOString() ?? null,
    createdAt: src.createdAt.toISOString(),
    updatedAt: src.updatedAt.toISOString(),
  };
}

export const dataSourceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/data-sources', async (req) => {
    const sources = await prisma.dataSource.findMany({
      where: { userId: req.user.userId },
      orderBy: [{ label: 'asc' }],
    });
    return { sources: sources.map(shape) };
  });

  app.post<{ Body: Record<string, unknown> }>(
    '/api/data-sources',
    { schema: { body: CreateSchema } },
    async (req, reply) => {
      const b = req.body as {
        label: string;
        description?: string | null;
        baseUrl: string;
        endpointPath: string;
        authMode?: string;
        authConfig?: Record<string, unknown> | null;
        staticHeaders?: Record<string, unknown> | null;
        categoryId?: string | null;
        syncCadence?: string;
        enabled?: boolean;
      };
      if (b.categoryId) {
        const cat = await prisma.category.findFirst({
          where: { id: b.categoryId, userId: req.user.userId },
        });
        if (!cat) return reply.badRequest('Unknown categoryId');
      }
      const created = await prisma.dataSource.create({
        data: {
          userId: req.user.userId,
          label: b.label,
          description: b.description ?? null,
          baseUrl: b.baseUrl,
          endpointPath: b.endpointPath,
          authMode: (b.authMode ?? 'NONE') as 'NONE' | 'BEARER' | 'BASIC' | 'COOKIE_LOGIN' | 'CUSTOM_HEADERS',
          authConfig: b.authConfig
            ? (b.authConfig as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          staticHeaders: b.staticHeaders
            ? (b.staticHeaders as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          categoryId: b.categoryId ?? null,
          syncCadence: (b.syncCadence ?? 'DAILY') as 'MANUAL' | 'HOURLY' | 'DAILY' | 'WEEKLY',
          enabled: b.enabled ?? true,
        },
      });
      return { source: shape(created) };
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/data-sources/:id',
    { schema: { body: PatchSchema } },
    async (req, reply) => {
      const existing = await prisma.dataSource.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!existing) return reply.notFound();
      const b = req.body as {
        label?: string;
        description?: string | null;
        baseUrl?: string;
        endpointPath?: string;
        authMode?: 'NONE' | 'BEARER' | 'BASIC' | 'COOKIE_LOGIN' | 'CUSTOM_HEADERS';
        authConfig?: Record<string, unknown> | null;
        staticHeaders?: Record<string, unknown> | null;
        categoryId?: string | null;
        syncCadence?: 'MANUAL' | 'HOURLY' | 'DAILY' | 'WEEKLY';
        enabled?: boolean;
      };
      if (b.categoryId) {
        const cat = await prisma.category.findFirst({
          where: { id: b.categoryId, userId: req.user.userId },
        });
        if (!cat) return reply.badRequest('Unknown categoryId');
      }
      const updated = await prisma.dataSource.update({
        where: { id: req.params.id },
        data: {
          label: b.label,
          description: b.description === undefined ? undefined : b.description,
          baseUrl: b.baseUrl,
          endpointPath: b.endpointPath,
          authMode: b.authMode,
          authConfig:
            b.authConfig === undefined
              ? undefined
              : b.authConfig
                ? (b.authConfig as Prisma.InputJsonValue)
                : Prisma.JsonNull,
          staticHeaders:
            b.staticHeaders === undefined
              ? undefined
              : b.staticHeaders
                ? (b.staticHeaders as Prisma.InputJsonValue)
                : Prisma.JsonNull,
          categoryId: b.categoryId === undefined ? undefined : b.categoryId,
          syncCadence: b.syncCadence,
          enabled: b.enabled,
        },
      });
      return { source: shape(updated) };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/data-sources/:id', async (req, reply) => {
    const existing = await prisma.dataSource.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!existing) return reply.notFound();
    await prisma.dataSource.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/data-sources/:id/sync', async (req, reply) => {
    const source = await prisma.dataSource.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!source) return reply.notFound();
    const result = await syncDataSource(source);
    return { result };
  });
};
