import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, ExternalLink, EyeOff, Eye, MapPin, MessageSquare, Repeat } from 'lucide-react';
import { format, isToday, isTomorrow } from 'date-fns';
import type { CalendarEvent } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/components/ChatPanel';
import { cn } from '@/lib/utils';

interface EventCardProps {
  event: CalendarEvent;
  accountColor?: string;
  accountLabel?: string;
}

// All-day events come back as 2026-05-13T00:00:00Z from Google/MS. Naive
// new Date(iso) parses that as midnight UTC, which becomes 7pm the previous
// day in CDT/CST — making the event appear to fall on the wrong day. For
// all-day events we work off the date portion of the ISO directly so the
// calendar date is preserved regardless of viewer timezone.
function dateFromAllDayIso(iso: string): Date {
  // 'YYYY-MM-DDT00:00:00Z' → construct a local-tz Date at noon on that date.
  // Noon dodges DST boundary edge cases for "today/tomorrow" comparisons.
  const ymd = iso.slice(0, 10).split('-').map((n) => parseInt(n, 10));
  return new Date(ymd[0], ymd[1] - 1, ymd[2], 12, 0, 0);
}

function formatTime(iso: string, allDay: boolean): string {
  const d = allDay ? dateFromAllDayIso(iso) : new Date(iso);
  if (allDay) {
    if (isToday(d)) return 'All day';
    if (isTomorrow(d)) return 'Tomorrow, all day';
    return `${format(d, 'MMM d')}, all day`;
  }
  if (isToday(d)) return format(d, 'p');
  if (isTomorrow(d)) return `Tomorrow ${format(d, 'p')}`;
  return format(d, 'MMM d, p');
}

export function EventCard({ event, accountColor, accountLabel }: EventCardProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const qc = useQueryClient();
  const isCancelled = event.status === 'CANCELLED';
  const isTentative = event.status === 'TENTATIVE';
  const isHidden = event.userHidden === true;

  const hideMutation = useMutation({
    mutationFn: (userHidden: boolean) => api.calendarEvents.setHidden(event.id, userHidden),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-card/60 p-3 transition-colors hover:border-primary/40',
        isCancelled && 'opacity-50 line-through',
        isHidden && 'opacity-50'
      )}
    >
      <div
        className="mt-1 h-9 w-1 rounded-full shrink-0"
        style={{ background: accountColor ?? '#0ea5e9' }}
        aria-label={accountLabel ?? 'event'}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug truncate">{event.title}</p>
          {isTentative && (
            <span className="text-[10px] uppercase text-muted-foreground shrink-0">tentative</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatTime(event.startsAt, event.allDay)}
            {!event.allDay && ` – ${format(new Date(event.endsAt), 'p')}`}
          </span>
          {event.location && (
            <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{event.location}</span>
            </span>
          )}
          {event.isRecurring && <Repeat className="h-3 w-3" />}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => hideMutation.mutate(!isHidden)}
          disabled={hideMutation.isPending}
          title={isHidden ? 'Unhide event' : 'Hide event (excluded from agent)'}
        >
          {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setChatOpen(true)}
          title="Discuss with agent"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
        {event.htmlLink ? (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Open in source calendar"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <ChatPanel
        anchorType="event"
        anchorId={event.id}
        anchorLabel={event.title}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
