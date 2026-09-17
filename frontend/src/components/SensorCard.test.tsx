import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SensorCard } from './SensorCard';
import type { DeviceReading } from '@/types/api';

const reading = (overrides: Partial<DeviceReading> = {}): DeviceReading => ({
  device: '1.1',
  temperature: { top: 10, mid: 11, bottom: 12 },
  humidity: null,
  batteryMV: null,
  lastMeasurement: '2026-09-17T08:00:00.000Z',
  offline: false,
  ...overrides,
});

describe('SensorCard', () => {
  it('shows the average temperature for a current reading', () => {
    const { container } = render(<SensorCard reading={reading()} />);

    expect(screen.getByText('11.0°C')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
    expect(container.firstChild).not.toHaveClass('opacity-50');
  });

  it('greys out a reading past the offline threshold and labels it', () => {
    const { container } = render(<SensorCard reading={reading({ offline: true })} />);

    expect(container.firstChild).toHaveClass('opacity-50');
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it('renders N/A when no temperatures are present', () => {
    render(
      <SensorCard
        reading={reading({ temperature: { top: null, mid: null, bottom: null } })}
      />,
    );

    expect(screen.getByText('N/A')).toBeInTheDocument();
  });
});
