import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutdoorSummary } from './OutdoorSummary';
import type { OutdoorConditions } from '@/types/api';

const withData: OutdoorConditions = {
  temperature: 12.4,
  humidity: 78,
  dewPoint: 8.7,
  absoluteHumidity: 8.5,
  lastMeasurement: new Date().toISOString(),
  offline: false,
  derivedUnavailableReason: null,
};

const empty: OutdoorConditions = {
  temperature: null,
  humidity: null,
  dewPoint: null,
  absoluteHumidity: null,
  lastMeasurement: null,
  offline: false,
  derivedUnavailableReason: null,
};

describe('OutdoorSummary', () => {
  it('renders temperature, humidity and derived values', () => {
    render(<OutdoorSummary outdoor={withData} />);
    expect(screen.getByText(/Außen/)).toBeInTheDocument();
    expect(screen.getByText('12.4°C')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText(/8\.7°C/)).toBeInTheDocument();
    expect(screen.getByText(/8\.5 g\/m³/)).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('greys the chip out and labels it when the reading is stale', () => {
    const { container } = render(
      <OutdoorSummary outdoor={{ ...withData, offline: true }} />,
    );
    expect(container.firstChild).toHaveClass('opacity-50');
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it('names a missing half instead of claiming the whole chip is stale', () => {
    render(
      <OutdoorSummary
        outdoor={{ ...withData, humidity: null, dewPoint: null, absoluteHumidity: null, offline: true }}
      />,
    );
    expect(screen.getByText(/Wert fehlt/)).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('explains why the derived values are missing when the measurement times drift apart', () => {
    render(
      <OutdoorSummary
        outdoor={{
          ...withData,
          dewPoint: null,
          absoluteHumidity: null,
          derivedUnavailableReason: 'skew',
        }}
      />,
    );
    expect(screen.getByText(/Messzeiten zu weit auseinander/)).toBeInTheDocument();
  });

  it('renders placeholders when values are missing', () => {
    render(<OutdoorSummary outdoor={empty} />);
    expect(screen.getByText('–°C')).toBeInTheDocument();
    expect(screen.getByText('–%')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
