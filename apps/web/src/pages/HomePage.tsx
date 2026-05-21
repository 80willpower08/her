import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function HomePage() {
  const clearSession = useAuth((s) => s.clearSession);
  const { data, isLoading, error } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
  });

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-muted/30">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="display text-3xl">her</h1>
          <Button variant="ghost" size="sm" onClick={clearSession}>
            <LogOut />
            Sign out
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Phase 0 — skeleton up</CardTitle>
            <CardDescription>
              Auth, DB, and the seven-container stack are running. The product comes next.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-muted-foreground">Checking session…</p>}
            {error && (
              <p className="text-sm text-destructive">
                Session check failed. Try signing out and back in.
              </p>
            )}
            {data && (
              <p className="text-sm">
                Signed in as <span className="font-medium">{data.user.username}</span>.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What's next</CardTitle>
            <CardDescription>Phase 1: tasks, goals, and the priority hierarchy.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
