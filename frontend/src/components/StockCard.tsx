import { Cpu } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GrainStock } from '@/types/api';
import { cn } from '@/lib/utils';

interface StockCardProps {
  stock: GrainStock;
  onClick?: () => void;
}

export function StockCard({ stock, onClick }: StockCardProps) {
  return (
    <Card
      className={cn(
        'transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary/50',
        !onClick && 'opacity-60'
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{stock.name}</CardTitle>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
              stock.active
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
            )}
          >
            {stock.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <CardDescription>{stock.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Cpu className="h-4 w-4" />
          <span>{stock.deviceCount} device{stock.deviceCount !== 1 ? 's' : ''}</span>
        </div>
      </CardContent>
    </Card>
  );
}
