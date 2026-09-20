import { Fan, Thermometer } from 'lucide-react';
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
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {/* What the stock is equipped with, from its configuration. Both
              fields are optional because a cached response from an older
              backend omits them; they default in opposite directions on
              purpose. Sensors are the norm, so an absent flag counts as
              equipped. Fan control is the exception, so an absent flag counts
              as not equipped — claiming a control that may not exist would
              promise an action the detail page then cannot offer. */}
          {stock.hasGrainSensors !== false && (
            <span className="inline-flex items-center">
              {/* The tooltip sits on the hidden icon so it adds no second
                  accessible name beside the sr-only text. It only reaches
                  pointer devices — mobile browsers do not surface a <title> on
                  tap — so on a phone the glyph stands on its own. */}
              <Thermometer className="h-4 w-4" aria-hidden="true" >
                <title>Getreidethermometer</title>
              </Thermometer>
              <span className="sr-only">Getreidethermometer</span>
            </span>
          )}
          {stock.fanControlEnabled && (
            <span className="inline-flex items-center">
              <Fan className="h-4 w-4" aria-hidden="true" >
                <title>Lüftersteuerung</title>
              </Fan>
              <span className="sr-only">Lüftersteuerung</span>
            </span>
          )}
          {/* Worded after what the app can show, not after what is installed:
              fanControlEnabled reports whether a controller is up, not whether
              a fan exists. */}
          {stock.hasGrainSensors === false && !stock.fanControlEnabled && (
            <span className="text-xs">Keine Messwerte, keine Steuerung</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
