import { cn } from '@/lib/utils';

interface WeightSliderProps {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  hint?: string;
  className?: string;
}

const WEIGHT_LABEL: Record<number, string> = {
  1: 'tiny',
  3: 'minor',
  5: 'normal',
  7: 'big',
  10: 'critical',
};

function nearestLabel(v: number): string {
  const stops = Object.keys(WEIGHT_LABEL).map(Number);
  const closest = stops.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return WEIGHT_LABEL[closest];
}

export function WeightSlider({ value, onChange, label, hint, className }: WeightSliderProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {value} <span className="text-muted-foreground/70">· {nearestLabel(value)}</span>
          </span>
        </div>
      )}
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-primary cursor-pointer"
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
