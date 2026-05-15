import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { env } from '../env.js';
import { dispatchNotification, getChannelStatus } from '../services/notifications.js';

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // --- Device subscriptions ---

  app.get('/api/devices', async (req) => {
    const devices = await prisma.device.findMany({
      where: { userId: req.user.userId },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        label: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return { devices };
  });

  app.post<{
    Body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
      label?: string;
    };
  }>(
    '/api/devices',
    {
      schema: {
        body: {
          type: 'object',
          required: ['endpoint', 'keys'],
          properties: {
            endpoint: { type: 'string', minLength: 1 },
            keys: {
              type: 'object',
              required: ['p256dh', 'auth'],
              properties: {
                p256dh: { type: 'string' },
                auth: { type: 'string' },
              },
            },
            userAgent: { type: 'string' },
            label: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const device = await prisma.device.upsert({
        where: { endpoint: req.body.endpoint },
        update: {
          p256dh: req.body.keys.p256dh,
          auth: req.body.keys.auth,
          userAgent: req.body.userAgent ?? null,
          label: req.body.label ?? null,
          lastUsedAt: new Date(),
        },
        create: {
          userId: req.user.userId,
          endpoint: req.body.endpoint,
          p256dh: req.body.keys.p256dh,
          auth: req.body.keys.auth,
          userAgent: req.body.userAgent ?? null,
          label: req.body.label ?? null,
        },
        select: {
          id: true,
          userAgent: true,
          label: true,
          createdAt: true,
          lastUsedAt: true,
        },
      });
      return { device };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const device = await prisma.device.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!device) return reply.notFound();
    await prisma.device.delete({ where: { id: device.id } });
    return { ok: true };
  });

  // --- Notifications log + test ---

  app.get<{ Querystring: { limit?: string } }>('/api/notifications', async (req) => {
    const limit = Math.min(100, parseInt(req.query.limit ?? '50', 10));
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        kind: true,
        channel: true,
        priority: true,
        title: true,
        body: true,
        url: true,
        status: true,
        scheduledFor: true,
        sentAt: true,
        error: true,
        createdAt: true,
      },
    });
    return { notifications };
  });

  app.post('/api/notifications/test', async (req) => {
    const records = await dispatchNotification({
      userId: req.user.userId,
      kind: 'TEST',
      title: 'Time-keeper test notification',
      body: 'If you see this, push is working.',
      url: '/settings',
      // No sourceType/sourceId so it can be re-fired arbitrarily
    });
    return { dispatched: records.length, records };
  });

  // --- Channel status (for the settings UI) ---

  app.get('/api/notifications/channels', async (req) => {
    const status = await getChannelStatus(req.user.userId);
    return {
      ...status,
      vapidPublicKey: env.vapidPublicKey || null,
      ntfyUrl: env.ntfyUrl || null,
    };
  });

  // --- User notification settings (quiet hours, enabled, reminderMinutes) ---

  app.get('/api/settings/notifications', async (req) => {
    const settings = await prisma.userSettings.upsert({
      where: { userId: req.user.userId },
      update: {},
      create: { userId: req.user.userId },
    });
    return {
      enableNotifications: settings.enableNotifications,
      reminderMinutesBefore: settings.reminderMinutesBefore,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
    };
  });

  app.patch<{
    Body: Partial<{
      enableNotifications: boolean;
      reminderMinutesBefore: number;
      quietHoursStart: string | null;
      quietHoursEnd: string | null;
    }>;
  }>(
    '/api/settings/notifications',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            enableNotifications: { type: 'boolean' },
            reminderMinutesBefore: { type: 'integer', minimum: 0, maximum: 1440 },
            quietHoursStart: { type: ['string', 'null'], pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
            quietHoursEnd: { type: ['string', 'null'], pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const updated = await prisma.userSettings.upsert({
        where: { userId: req.user.userId },
        update: req.body,
        create: { userId: req.user.userId, ...req.body },
      });
      return {
        enableNotifications: updated.enableNotifications,
        reminderMinutesBefore: updated.reminderMinutesBefore,
        quietHoursStart: updated.quietHoursStart,
        quietHoursEnd: updated.quietHoursEnd,
      };
    }
  );
};
