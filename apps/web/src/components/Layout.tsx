import {
  BarChart3,
  CalendarDays,
  Inbox as InboxIcon,
  ListTree,
  LogOut,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/today', label: 'Today', icon: CalendarDays },
  { to: '/plan', label: 'Plan', icon: ListTree },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/inbox', label: 'Inbox', icon: InboxIcon },
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3 },
];

export function Layout() {
  const { user, clearSession } = useAuth();
  const navigate = useNavigate();

  const pendingQ = useQuery({
    queryKey: ['messages', 'pending-count'],
    queryFn: () => api.messages.list({ status: 'pending', limit: 1 }),
    refetchInterval: 60_000,
  });
  const pendingCount = pendingQ.data?.pendingCount ?? 0;

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-[var(--hairline-strong)]">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center gap-4">
          <span className="font-display text-lg font-medium tracking-tight">
            Time<span className="red-glow-text-soft">·</span>keeper
          </span>
          {/* Desktop horizontal nav */}
          <nav className="hidden sm:flex gap-1 flex-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'shrink-0 px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                    isActive
                      ? 'red-glow-text bg-surface-raised border border-[var(--hairline-crimson)]'
                      : 'text-ink-soft hover:text-ink hover:bg-surface-raised/60'
                  )
                }
              >
                {item.label}
                {item.to === '/inbox' && pendingCount > 0 ? (
                  <span className="red-glow-fill text-[10px] font-semibold px-1.5 py-0.5 leading-none text-crimson">
                    {pendingCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
          {/* Mobile: just a spacer so the right buttons stay on the right */}
          <div className="flex-1 sm:hidden" />
          <div className="flex items-center gap-1 shrink-0">
            <span className="hidden sm:inline text-sm text-muted-foreground mr-2">
              {user?.username}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
              title="Settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={clearSession} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 pb-24 sm:pb-6">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur-md border-t border-[var(--hairline-strong)]">
        <div className="grid grid-cols-5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const showBadge = item.to === '/inbox' && pendingCount > 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-all',
                    isActive ? 'red-glow-text' : 'text-ink-muted hover:text-ink-soft'
                  )
                }
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {showBadge ? (
                    <span className="absolute -top-1 -right-1 red-glow-fill text-[9px] font-semibold px-1 leading-tight text-crimson">
                      {pendingCount}
                    </span>
                  ) : null}
                </div>
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
