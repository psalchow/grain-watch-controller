import type { Resolution } from '@/types/api';
import { cn } from '@/lib/utils';

const TABS: { value: Resolution; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export interface HistoryRangeTabsProps {
  value: Resolution;
  onChange: (next: Resolution) => void;
}

export function HistoryRangeTabs({ value, onChange }: HistoryRangeTabsProps) {
  return (
    <div role="tablist" className="flex border-b border-border">
      {TABS.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'px-4 py-2 text-sm -mb-px border-b-2 transition-colors',
              active
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
