import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A Card whose body collapses behind a chevron. Open/closed state persists
 * to localStorage under `collapsible:<storageKey>`.
 */
export function CollapsibleSection({
  storageKey,
  title,
  description,
  defaultOpen = false,
  children,
  rightSlot,
  contentClassName,
}: {
  storageKey: string;
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  rightSlot?: ReactNode;
  contentClassName?: string;
}) {
  const fullKey = `collapsible:${storageKey}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen;
    const v = window.localStorage.getItem(fullKey);
    return v === null ? defaultOpen : v === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(fullKey, open ? '1' : '0');
  }, [fullKey, open]);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none py-3"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="mt-0.5 shrink-0 text-muted-foreground">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">{title}</CardTitle>
              {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
            </div>
          </div>
          {rightSlot ? (
            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
              {rightSlot}
            </div>
          ) : null}
        </div>
      </CardHeader>
      {open ? (
        <CardContent className={cn('space-y-3 pt-0', contentClassName)}>{children}</CardContent>
      ) : null}
    </Card>
  );
}
