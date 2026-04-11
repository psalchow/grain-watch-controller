import { useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { StockCard } from '@/components/StockCard';
import { Button } from '@/components/ui/button';
import { stocksApi } from '@/api';
import { GrainStock } from '@/types/api';

export default function HomePage() {
  const [stocks, setStocks] = useState<GrainStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStocks = async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    }
    setError(null);

    try {
      const response = await stocksApi.getStocks();
      setStocks(response.stocks);
    } catch (err) {
      console.error('Error loading stocks:', err);
      setError('Failed to load stocks. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadStocks();
  }, []);

  const handleRefresh = () => {
    loadStocks(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-screen-xl px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Grain Stocks</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-md bg-destructive/10 p-4 text-center text-destructive">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => loadStocks()}
            >
              Try again
            </Button>
          </div>
        ) : stocks.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No grain stocks available</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stocks.map((stock) => (
              <StockCard
                key={stock.id}
                stock={stock}
                onClick={() => {
                  // TODO: Navigate to stock detail page
                  console.warn('Stock clicked:', stock.id);
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
