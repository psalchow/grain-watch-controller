import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Droplets, Fan, Loader2, Thermometer } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { StockFormDialog } from '@/components/StockFormDialog';
import { adminApi } from '@/api';
import { extractError } from '@/lib/messages';
import { cn } from '@/lib/utils';
import type { AdminStock, CreateStockRequest } from '@/types/api';

/** The stock form: create when `stock` is absent, edit when present; null when closed. */
type Form = { stock?: AdminStock } | null;

export default function AdminStocksPage() {
  const navigate = useNavigate();
  const [stocks, setStocks] = useState<AdminStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [deleting, setDeleting] = useState<AdminStock | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStocks(await adminApi.listStocks());
    } catch {
      setError('Hallen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Lets the failure through to the dialog, which keeps it open with the
   * typed values rather than throwing the edit away into the page's band.
   */
  const save = async (values: CreateStockRequest) => {
    const stock = form?.stock;
    if (stock) {
      await adminApi.updateStock(stock.id, values);
    } else {
      await adminApi.createStock(values);
    }
    setForm(null);
    await load();
  };

  const toggleActive = async (stock: AdminStock) => {
    setError(null);
    try {
      await adminApi.updateStock(stock.id, { active: !stock.active });
      await load();
    } catch (err) {
      setError(extractError(err, 'Der Hallenstatus konnte nicht geändert werden'));
    }
  };

  const confirmDelete = async (stock: AdminStock) => {
    setError(null);
    try {
      await adminApi.deleteStock(stock.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleting(null);
      setError(extractError(err, 'Die Halle konnte nicht gelöscht werden'));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-screen-xl px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
              <span className="ml-1">Back</span>
            </Button>
            <h1 className="text-2xl font-semibold">Stock Management</h1>
          </div>
          <Button onClick={() => setForm({})}>New stock</Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Stock</th>
                  <th className="p-3 text-left">Device group</th>
                  <th className="p-3 text-left">Equipment</th>
                  <th className="p-3 text-left">Active</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!error && stocks.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-6 text-center text-muted-foreground"
                    >
                      No stocks yet. Use “New stock” to create the first one.
                    </td>
                  </tr>
                )}
                {stocks.map((stock) => (
                  <tr key={stock.id} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{stock.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {stock.id}
                      </div>
                    </td>
                    <td className="p-3">{stock.deviceGroup ?? '—'}</td>
                    <td className="p-3">
                      <Equipment stock={stock} />
                    </td>
                    <td className="p-3">
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
                    </td>
                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setForm({ stock })}
                      >
                        Edit
                      </Button>
                      <Button
                        variant={stock.active ? 'destructive' : 'secondary'}
                        size="sm"
                        onClick={() => toggleActive(stock)}
                      >
                        {stock.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      {/* Only while inactive: the backend answers 409 for an
                          active stock, so the button's absence and the server
                          rule say the same thing. */}
                      {!stock.active && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleting(stock)}
                        >
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Mounted only while wanted: the form seeds its draft from `stock` once. */}
      {form && (
        <StockFormDialog
          open
          stock={form.stock}
          onSave={save}
          onCancel={() => setForm(null)}
        />
      )}

      {deleting && (
        <Dialog
          open
          onClose={() => setDeleting(null)}
          title="Delete stock"
        >
          <div className="space-y-4">
            <p className="text-sm">
              „{deleting.name}“ wird endgültig gelöscht. Die Schalthistorie und
              die Automatikeinstellungen der Halle werden mit entfernt.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => confirmDelete(deleting)}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * What the stock is fitted with. The tooltip sits on the hidden glyph so it
 * adds no second accessible name beside the sr-only text, as `StockCard` does.
 */
function Equipment({ stock }: { stock: AdminStock }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      {stock.hasGrainSensors && (
        <span className="inline-flex items-center">
          <Thermometer className="h-4 w-4" aria-hidden="true">
            <title>Grain thermometers</title>
          </Thermometer>
          <span className="sr-only">Grain thermometers</span>
        </span>
      )}
      {stock.hasHumidity && (
        <span className="inline-flex items-center">
          <Droplets className="h-4 w-4" aria-hidden="true">
            <title>Humidity</title>
          </Droplets>
          <span className="sr-only">Humidity</span>
        </span>
      )}
      {stock.fanControlEnabled && (
        <span className="inline-flex items-center">
          <Fan className="h-4 w-4" aria-hidden="true">
            <title>Fan control</title>
          </Fan>
          <span className="sr-only">Fan control</span>
        </span>
      )}
    </div>
  );
}
