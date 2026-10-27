import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminStocksPage from './AdminStocksPage';
import { adminApi } from '@/api';
import type { AdminStock } from '@/types/api';

vi.mock('@/api', () => ({
  adminApi: {
    listStocks: vi.fn(),
    createStock: vi.fn(),
    updateStock: vi.fn(),
    deleteStock: vi.fn(),
  },
}));
vi.mock('@/components/Header', () => ({ Header: () => null }));

const active: AdminStock = {
  id: 'stk_001',
  name: 'Halle Nord',
  description: 'Weizen',
  deviceGroup: 'grain-watch-1',
  outdoorDevice: 'outdoor-1',
  hasHumidity: true,
  hasGrainSensors: true,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  fanControlEnabled: true,
  fanTopicPrefix: 'shellies/halle-nord',
  fanSwitchId: 0,
  tenantId: 'tnt_default',
};

const inactive: AdminStock = {
  ...active,
  id: 'stk_002',
  name: 'Halle Süd',
  deviceGroup: 'grain-watch-2',
  hasHumidity: false,
  fanControlEnabled: false,
  fanTopicPrefix: undefined,
  active: false,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminStocksPage />
    </MemoryRouter>
  );
}

/** The row of the table carrying that stock name. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe('AdminStocksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.listStocks).mockResolvedValue([active, inactive]);
  });

  it('renders a row per stock with its id and device group', async () => {
    renderPage();

    expect(await screen.findByText('Halle Nord')).toBeInTheDocument();
    expect(within(rowOf('Halle Nord')).getByText('stk_001')).toBeInTheDocument();
    expect(
      within(rowOf('Halle Nord')).getByText('grain-watch-1')
    ).toBeInTheDocument();
    expect(within(rowOf('Halle Süd')).getByText('stk_002')).toBeInTheDocument();
  });

  it('offers delete only while a stock is inactive', async () => {
    renderPage();
    await screen.findByText('Halle Nord');

    expect(
      within(rowOf('Halle Nord')).queryByRole('button', { name: 'Delete' })
    ).not.toBeInTheDocument();
    expect(
      within(rowOf('Halle Süd')).getByRole('button', { name: 'Delete' })
    ).toBeInTheDocument();
  });

  it('names the stock and its losses in the delete confirmation', async () => {
    renderPage();
    await screen.findByText('Halle Süd');

    fireEvent.click(
      within(rowOf('Halle Süd')).getByRole('button', { name: 'Delete' })
    );

    expect(await screen.findByText(/„Halle Süd“ wird/)).toBeInTheDocument();
    expect(screen.getByText(/Schalthistorie/)).toBeInTheDocument();
    expect(screen.getByText(/Automatikeinstellungen/)).toBeInTheDocument();
  });

  it('deletes the stock and reloads once the deletion is confirmed', async () => {
    vi.mocked(adminApi.deleteStock).mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('Halle Süd');

    fireEvent.click(
      within(rowOf('Halle Süd')).getByRole('button', { name: 'Delete' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete permanently' })
    );

    await waitFor(() =>
      expect(adminApi.deleteStock).toHaveBeenCalledWith('stk_002')
    );
    await waitFor(() => expect(adminApi.listStocks).toHaveBeenCalledTimes(2));
  });

  it('toggles the active flag through updateStock', async () => {
    vi.mocked(adminApi.updateStock).mockResolvedValue(active);
    renderPage();
    await screen.findByText('Halle Nord');

    fireEvent.click(
      within(rowOf('Halle Nord')).getByRole('button', { name: 'Deactivate' })
    );

    await waitFor(() =>
      expect(adminApi.updateStock).toHaveBeenCalledWith('stk_001', {
        active: false,
      })
    );
    await waitFor(() => expect(adminApi.listStocks).toHaveBeenCalledTimes(2));
  });

  it('shows the error band when the list cannot be loaded', async () => {
    vi.mocked(adminApi.listStocks).mockRejectedValue(new Error('boom'));
    renderPage();

    expect(
      await screen.findByText('Hallen konnten nicht geladen werden')
    ).toBeInTheDocument();
  });

  it('creates a stock from the form dialog', async () => {
    vi.mocked(adminApi.createStock).mockResolvedValue(inactive);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New stock' }));
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Halle West' },
    });
    fireEvent.change(screen.getByLabelText('Device group'), {
      target: { value: 'grain-watch-3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create stock' }));

    await waitFor(() =>
      expect(adminApi.createStock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Halle West',
          deviceGroup: 'grain-watch-3',
        })
      )
    );
    await waitFor(() => expect(adminApi.listStocks).toHaveBeenCalledTimes(2));
  });

  it('saves an edit through updateStock', async () => {
    vi.mocked(adminApi.updateStock).mockResolvedValue(active);
    renderPage();
    await screen.findByText('Halle Nord');

    fireEvent.click(
      within(rowOf('Halle Nord')).getByRole('button', { name: 'Edit' })
    );
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Halle Nordwest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(adminApi.updateStock).toHaveBeenCalledWith(
        'stk_001',
        expect.objectContaining({ name: 'Halle Nordwest' })
      )
    );
  });
});
