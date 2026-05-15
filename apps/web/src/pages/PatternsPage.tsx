import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';
import type { CategoryPatternStats } from '@time-keeper/shared';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ICON: Record<CategoryPatternStats['classification'], React.ReactNode> = {
  strength: <TrendingUp className="h-3.5 w-3.5" />,
  neutral: <Minus className="h-3.5 w-3.5" />,
  struggle: <TrendingDown className="h-3.5 w-3.5" />,
  unknown: <Sparkles className="h-3.5 w-3.5" />,
};

const VARIANT: Record<CategoryPatternStats['classification'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  strength: 'default',
  neutral: 'secondary',
  struggle: 'destructive',
  unknown: 'outline',
};

const LABEL: Record<CategoryPatternStats['classification'], string> = {
  strength: 'Strength',
  neutral: 'Neutral',
  struggle: 'Struggle',
  unknown: 'Not enough data',
};

export function PatternsPage() {
  const patternsQ = useQuery({ queryKey: ['patterns'], queryFn: () => api.patterns() });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-3xl">Patterns</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {patternsQ.data
            ? `Last ${patternsQ.data.windowDays} days · ${patternsQ.data.byCategory.reduce((s, c) => s + c.sampleSize, 0)} completions`
            : 'Strengths and struggles by category.'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How this works</CardTitle>
          <CardDescription>
            We watch your completion record by category. With 5+ completions and an on-time rate
            ≥80%, a category becomes a <strong>strength</strong>. Below 50% on-time → <strong>struggle</strong>.
            The agent (when it lands) will use this to schedule struggle items in your peak hours
            with extra buffer.
          </CardDescription>
        </CardHeader>
      </Card>

      {patternsQ.data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {patternsQ.data.byCategory.map((p) => (
            <PatternCard key={p.categoryId ?? 'uncategorized'} stats={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PatternCard({ stats }: { stats: CategoryPatternStats }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: stats.categoryColor }}
            />
            <CardTitle className="text-sm truncate">{stats.categoryName}</CardTitle>
          </div>
          <Badge variant={VARIANT[stats.classification]} className="gap-1 shrink-0">
            {ICON[stats.classification]}
            {LABEL[stats.classification]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <Row label="Completions tracked" value={stats.sampleSize.toString()} />
        <Row
          label="On-time rate"
          value={stats.sampleSize > 0 ? `${(stats.onTimeRate * 100).toFixed(0)}%` : '—'}
          dim={stats.sampleSize === 0}
        />
        <Row
          label="Estimate accuracy"
          value={
            stats.avgEstimatedAccuracy
              ? `${stats.avgEstimatedAccuracy.toFixed(2)}× est.`
              : '—'
          }
          dim={!stats.avgEstimatedAccuracy}
        />
      </CardContent>
    </Card>
  );
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between', dim && 'text-muted-foreground')}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
