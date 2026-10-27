import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StockFormDialog } from './StockFormDialog';
import type { AdminStock } from '@/types/api';

const fullyEquipped: AdminStock = {
  id: 'stk_001',
  name: 'Halle Nord',
  description: 'Weizen',
  deviceGroup: 'grain-watch-1',
  outdoorDevice: 'outdoor-1',
  hasHumidity: true,
  hasGrainSensors: true,
  active: false,
  createdAt: '2026-01-01T00:00:00Z',
  fanControlEnabled: true,
  fanTopicPrefix: 'shellies/halle-nord',
  fanSwitchId: 1,
  tenantId: 'tnt_default',
};

const onSave = vi.fn();
const onCancel = vi.fn();

function renderDialog(stock?: AdminStock) {
  return render(
    <StockFormDialog open stock={stock} onSave={onSave} onCancel={onCancel} />
  );
}

const field = (label: string) => screen.getByLabelText(label);
const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: /Create stock|Save changes/ }));

describe('StockFormDialog field dependencies', () => {
  beforeEach(() => vi.clearAllMocks());

  it('locks the device group and the humidity checkbox until grain thermometers are ticked', () => {
    renderDialog({ ...fullyEquipped, hasGrainSensors: false });

    expect(field('Device group')).toBeDisabled();
    expect(field('Humidity present')).toBeDisabled();

    fireEvent.click(field('Grain thermometers present'));

    expect(field('Device group')).toBeEnabled();
    expect(field('Humidity present')).toBeEnabled();
  });

  it('locks the topic prefix and the switch id until fan control is ticked', () => {
    renderDialog();

    expect(field('Topic prefix')).toBeDisabled();
    expect(field('Switch id')).toBeDisabled();

    fireEvent.click(field('Fan control enabled'));

    expect(field('Topic prefix')).toBeEnabled();
    expect(field('Switch id')).toBeEnabled();
  });

  it('keeps a locked field’s value through a tick-untick-tick cycle', () => {
    renderDialog(fullyEquipped);

    expect(field('Device group')).toHaveValue('grain-watch-1');

    fireEvent.click(field('Grain thermometers present'));
    expect(field('Device group')).toBeDisabled();
    expect(field('Device group')).toHaveValue('grain-watch-1');

    fireEvent.click(field('Grain thermometers present'));
    expect(field('Device group')).toBeEnabled();
    expect(field('Device group')).toHaveValue('grain-watch-1');
  });

  it('still submits a locked field’s value', async () => {
    renderDialog(fullyEquipped);

    fireEvent.click(field('Grain thermometers present'));
    submit();

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          hasGrainSensors: false,
          deviceGroup: 'grain-watch-1',
          hasHumidity: true,
        })
      )
    );
  });
});

describe('StockFormDialog withdrawal warning', () => {
  beforeEach(() => vi.clearAllMocks());

  it('warns that the fan must be checked on site when fan control is withdrawn', () => {
    renderDialog(fullyEquipped);

    expect(screen.queryByText(/vor Ort/)).not.toBeInTheDocument();

    fireEvent.click(field('Fan control enabled'));

    expect(screen.getByText(/vor Ort/)).toBeInTheDocument();
  });

  it('stays silent on a stock that never had fan control', () => {
    renderDialog({
      ...fullyEquipped,
      fanControlEnabled: false,
      fanTopicPrefix: undefined,
    });

    fireEvent.click(field('Fan control enabled'));
    fireEvent.click(field('Fan control enabled'));

    expect(screen.queryByText(/vor Ort/)).not.toBeInTheDocument();
  });
});

describe('StockFormDialog validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a name longer than 100 characters in German and saves nothing', async () => {
    renderDialog(fullyEquipped);

    fireEvent.change(field('Name'), { target: { value: 'x'.repeat(101) } });
    submit();

    expect(
      await screen.findByText(/höchstens 100 Zeichen/)
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects fan control without a topic prefix', async () => {
    renderDialog();

    fireEvent.change(field('Name'), { target: { value: 'Halle Süd' } });
    fireEvent.change(field('Device group'), {
      target: { value: 'grain-watch-2' },
    });
    fireEvent.click(field('Fan control enabled'));
    submit();

    expect(
      await screen.findByText(/Für die Lüftersteuerung/)
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects grain thermometers without a device group', async () => {
    renderDialog();

    fireEvent.change(field('Name'), { target: { value: 'Halle Süd' } });
    submit();

    expect(
      await screen.findByText(/Für Korn-Thermometer/)
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a topic prefix carrying a wildcard', async () => {
    renderDialog();

    fireEvent.change(field('Name'), { target: { value: 'Halle Süd' } });
    fireEvent.change(field('Device group'), {
      target: { value: 'grain-watch-2' },
    });
    fireEvent.click(field('Fan control enabled'));
    fireEvent.change(field('Topic prefix'), {
      target: { value: 'shellies/#' },
    });
    submit();

    expect(await screen.findByText(/# und kein \+/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('StockFormDialog submit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends every field when creating, with null for the empty ones', async () => {
    renderDialog();

    fireEvent.change(field('Name'), { target: { value: 'Halle Süd' } });
    fireEvent.change(field('Device group'), {
      target: { value: 'grain-watch-2' },
    });
    submit();

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'Halle Süd',
        description: null,
        deviceGroup: 'grain-watch-2',
        outdoorDevice: null,
        hasHumidity: false,
        hasGrainSensors: true,
        active: true,
        fanControlEnabled: false,
        fanTopicPrefix: null,
        fanSwitchId: 0,
      })
    );
  });

  it('shows the generated id read-only when editing', () => {
    renderDialog(fullyEquipped);

    const id = field('Id');
    expect(id).toHaveValue('stk_001');
    expect(id).toHaveAttribute('readonly');
  });

  it('clears an emptied nullable field with null rather than an empty string', async () => {
    renderDialog(fullyEquipped);

    fireEvent.change(field('Description'), { target: { value: '  ' } });
    submit();

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ description: null })
      )
    );
  });
});
