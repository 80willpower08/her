// Notification dispatch — Web Push + ntfy fallback.
// Quiet hours suppress NORMAL/LOW priority; URGENT always sends.

import webPush from 'web-push';
import type { Device, Notification, NotificationChannel, UserSettings } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../prisma.js';

let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured) return;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return;
  webPush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  vapidConfigured = true;
}

/** Parse "HH:mm" → minutes since midnight, or null. */
function parseHHmm(s: string | null | undefined): number | null {
  if (!s) return null;
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Returns true if `now` falls within the user's quiet hours window. */
export function isInQuietHours(settings: UserSettings | null, now: Date = new Date()): boolean {
  if (!settings) return false;
  const startMin = parseHHmm(settings.quietHoursStart);
  const endMin = parseHHmm(settings.quietHoursEnd);
  if (startMin === null || endMin === null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (startMin === endMin) return false;
  // Window may wrap past midnight (e.g., 23:00 → 06:00)
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}

interface DispatchInput {
  userId: string;
  kind: Notification['kind'];
  priority?: Notification['priority'];
  title: string;
  body: string;
  url?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  /** Opaque marker; if it changes, dedupe misses and we re-fire. */
  sourceVersion?: string | null;
  scheduledFor?: Date;
}

/**
 * Create + send a notification across all configured channels.
 * Idempotent on (userId, sourceType, sourceId, kind, sourceVersion).
 * If `sourceVersion` differs from a prior dispatch — e.g., a meeting moved
 * from 2pm to 3pm — this is treated as a fresh notification.
 */
export async function dispatchNotification(input: DispatchInput): Promise<Notification[]> {
  if (input.sourceType && input.sourceId) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        kind: input.kind,
        sourceVersion: input.sourceVersion ?? null,
        status: { in: ['PENDING', 'SENT'] },
      },
    });
    if (existing) return [existing];
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId: input.userId } });
  const enabled = settings?.enableNotifications !== false;
  const priority = input.priority ?? 'NORMAL';

  const inQuiet = isInQuietHours(settings);
  const suppressed = !enabled || (inQuiet && priority !== 'URGENT');

  const devices = await prisma.device.findMany({ where: { userId: input.userId } });

  const records: Notification[] = [];
  // Always create a WEB_PUSH record per device (or one record if none — useful for history)
  const webPushTargets: Device[] = devices;
  for (const device of webPushTargets) {
    const rec = await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        channel: 'WEB_PUSH',
        priority,
        title: input.title,
        body: input.body,
        url: input.url ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        sourceVersion: input.sourceVersion ?? null,
        scheduledFor: input.scheduledFor ?? new Date(),
        status: suppressed ? 'SUPPRESSED' : 'PENDING',
      },
    });
    if (!suppressed) {
      const sent = await sendWebPush(rec, device);
      records.push(sent);
    } else {
      records.push(rec);
    }
  }

  // ntfy: one dispatch per user (topic-based, fan-out happens server-side)
  if (env.ntfyTopic) {
    const rec = await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        channel: 'NTFY',
        priority,
        title: input.title,
        body: input.body,
        url: input.url ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        sourceVersion: input.sourceVersion ?? null,
        scheduledFor: input.scheduledFor ?? new Date(),
        status: suppressed ? 'SUPPRESSED' : 'PENDING',
      },
    });
    if (!suppressed) {
      const sent = await sendNtfy(rec);
      records.push(sent);
    } else {
      records.push(rec);
    }
  }

  return records;
}

async function sendWebPush(rec: Notification, device: Device): Promise<Notification> {
  ensureVapidConfigured();
  if (!vapidConfigured) {
    return prisma.notification.update({
      where: { id: rec.id },
      data: { status: 'FAILED', error: 'VAPID not configured' },
    });
  }
  const subscription = {
    endpoint: device.endpoint,
    keys: { p256dh: device.p256dh, auth: device.auth },
  };
  const payload = JSON.stringify({
    title: rec.title,
    body: rec.body,
    url: rec.url ?? undefined,
    notificationId: rec.id,
    kind: rec.kind,
  });
  try {
    await webPush.sendNotification(subscription, payload, { TTL: 86_400 });
    await prisma.device.update({
      where: { id: device.id },
      data: { lastUsedAt: new Date() },
    });
    return prisma.notification.update({
      where: { id: rec.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 404/410 means the subscription is dead — remove the device
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      await prisma.device.delete({ where: { id: device.id } }).catch(() => undefined);
    }
    return prisma.notification.update({
      where: { id: rec.id },
      data: { status: 'FAILED', error: message },
    });
  }
}

async function sendNtfy(rec: Notification): Promise<Notification> {
  if (!env.ntfyTopic) {
    return prisma.notification.update({
      where: { id: rec.id },
      data: { status: 'FAILED', error: 'NTFY_TOPIC not configured' },
    });
  }
  const url = `${env.ntfyUrl.replace(/\/+$/, '')}/${env.ntfyTopic}`;
  const headers: Record<string, string> = {
    'Title': rec.title,
    'Priority': rec.priority === 'URGENT' ? '5' : rec.priority === 'LOW' ? '2' : '3',
    'Tags': rec.kind.toLowerCase(),
  };
  if (rec.url) headers['Click'] = rec.url;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: rec.body,
    });
    if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
    return prisma.notification.update({
      where: { id: rec.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return prisma.notification.update({
      where: { id: rec.id },
      data: { status: 'FAILED', error: message },
    });
  }
}

export interface ChannelStatus {
  webPush: { configured: boolean; deviceCount: number };
  ntfy: { configured: boolean; topic: string | null };
}

export async function getChannelStatus(userId: string): Promise<ChannelStatus> {
  ensureVapidConfigured();
  const deviceCount = await prisma.device.count({ where: { userId } });
  return {
    webPush: { configured: vapidConfigured, deviceCount },
    ntfy: { configured: Boolean(env.ntfyTopic), topic: env.ntfyTopic || null },
  };
}
