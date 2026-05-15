import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, RefreshCw, Send, Smartphone, Trash2, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { pushSupported, subscribePush, getCurrentSubscription } from '@/lib/push';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, string> = {
  SENT: 'text-emerald-600',
  PENDING: 'text-muted-foreground',
  FAILED: 'text-destructive',
  SUPPRESSED: 'text-amber-600',
};

export function NotificationsSection() {
  return (
    <div className="space-y-5">
      <Subscription />
      <Separator />
      <Preferences />
      <Separator />
      <RecentNotifications />
    </div>
  );
}

function Subscription() {
  const queryClient = useQueryClient();
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [error, setError] = useState<string | null>(null);

  const channelsQ = useQuery({
    queryKey: ['notifications', 'channels'],
    queryFn: () => api.notifications.channels(),
  });
  const devicesQ = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.devices.list(),
  });

  useEffect(() => {
    getCurrentSubscription().then((sub) => setHasSubscription(Boolean(sub)));
  }, []);

  const subscribeMutation = useMutation({
    mutationFn: () => subscribePush(),
    onSuccess: (result) => {
      if (result.ok) {
        setError(null);
        setHasSubscription(true);
        setPermission('granted');
        queryClient.invalidateQueries({ queryKey: ['devices'] });
        queryClient.invalidateQueries({ queryKey: ['notifications', 'channels'] });
      } else {
        setError(result.reason);
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed');
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.notifications.test(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Test failed');
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: (id: string) => api.devices.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setHasSubscription(false);
    },
  });

  const supported = pushSupported();
  const channels = channelsQ.data;
  const devices = devicesQ.data?.devices ?? [];

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">This device</div>

      {!supported && (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          <BellOff className="h-4 w-4" />
          Push not supported by this browser.
        </div>
      )}

      {supported && (
        <>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Bell
                className={cn(
                  'h-4 w-4 shrink-0',
                  hasSubscription ? 'text-emerald-600' : 'text-muted-foreground'
                )}
              />
              <span className="text-sm">
                {hasSubscription
                  ? 'Subscribed on this device'
                  : permission === 'denied'
                    ? 'Permission denied (re-enable in browser site settings)'
                    : 'Not subscribed'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant={hasSubscription ? 'outline' : 'default'}
                onClick={() => subscribeMutation.mutate()}
                disabled={subscribeMutation.isPending || permission === 'denied'}
              >
                {hasSubscription ? 'Re-subscribe' : 'Enable'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                title="Send a test notification"
              >
                <Send className="h-3.5 w-3.5" />
                Test
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </>
      )}

      {channels && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border p-2">
            <div className="font-medium">Web Push</div>
            <div className="text-muted-foreground mt-0.5">
              {channels.webPush.configured ? 'Configured' : 'VAPID missing'} ·{' '}
              {channels.webPush.deviceCount} device{channels.webPush.deviceCount === 1 ? '' : 's'}
            </div>
          </div>
          <div className="rounded-md border p-2">
            <div className="font-medium">ntfy</div>
            <div className="text-muted-foreground mt-0.5">
              {channels.ntfy.configured ? `Topic: ${channels.ntfy.topic}` : 'NTFY_TOPIC missing'}
            </div>
          </div>
        </div>
      )}

      {devices.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">All registered</div>
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border bg-secondary/30 px-3 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{d.label ?? d.userAgent ?? 'Device'}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  Last used {formatDistanceToNow(new Date(d.lastUsedAt), { addSuffix: true })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => deleteDeviceMutation.mutate(d.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Preferences() {
  const queryClient = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['notifications', 'settings'],
    queryFn: () => api.notificationSettings.get(),
  });

  const [enabled, setEnabled] = useState(true);
  const [reminderMinutes, setReminderMinutes] = useState(30);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (settingsQ.data) {
      setEnabled(settingsQ.data.enableNotifications);
      setReminderMinutes(settingsQ.data.reminderMinutesBefore);
      setStart(settingsQ.data.quietHoursStart ?? '');
      setEnd(settingsQ.data.quietHoursEnd ?? '');
    }
  }, [settingsQ.data]);

  const saveMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.notificationSettings.update>[0]) =>
      api.notificationSettings.update(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'settings'] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Preferences</div>

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span className="text-sm">Notifications enabled</span>
        <Button
          variant={enabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            saveMutation.mutate({ enableNotifications: next });
          }}
        >
          {enabled ? 'On' : 'Off'}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Reminder lead (min)
          </Label>
          <Input
            type="number"
            min={0}
            max={1440}
            value={reminderMinutes}
            onChange={(e) => setReminderMinutes(parseInt(e.target.value || '0', 10))}
            onBlur={() => saveMutation.mutate({ reminderMinutesBefore: reminderMinutes })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Quiet from</Label>
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onBlur={() => saveMutation.mutate({ quietHoursStart: start || null })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Quiet to</Label>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            onBlur={() => saveMutation.mutate({ quietHoursEnd: end || null })}
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        During quiet hours, only URGENT notifications come through. Wraps past midnight (e.g. 23:00 → 06:00).
      </p>
    </div>
  );
}

function RecentNotifications() {
  const queryClient = useQueryClient();
  const listQ = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.notifications.list(20),
  });
  const items = listQ.data?.notifications ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Recent</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] })}
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">Nothing yet.</p>
      )}
      {items.map((n) => (
        <div key={n.id} className="rounded-md border px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{n.title}</span>
                <Badge variant="outline" className="text-[10px]">
                  {n.kind.toLowerCase()}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {n.channel === 'WEB_PUSH' ? 'web push' : 'ntfy'}
                </Badge>
                <span className={cn('text-[10px]', STATUS_TONE[n.status] ?? 'text-muted-foreground')}>
                  {n.status.toLowerCase()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.body}</p>
              {n.error && <p className="text-xs text-destructive mt-0.5">{n.error}</p>}
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
