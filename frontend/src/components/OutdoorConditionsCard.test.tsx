import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutdoorConditionsCard } from './OutdoorConditionsCard';
import type { OutdoorConditions } from '@/types/api';

const withData: OutdoorConditions = {
  temperature: 12.4,
  humidity: 78,
  dewPoint: 8.7,
  absoluteHumidity: 8.5,
  lastMeasurement: new Date().toISOString(),
};

const empty: OutdoorConditions = {
  temperature: null,
  humidity: null,
  dewPoint: null,
  absoluteHumidity: null,
  lastMeasurement: null,
};

describe('OutdoorConditionsCard', () => {
  it('renders temperature, humidity and derived values', () => {
    render(<OutdoorConditionsCard outdoor={withData} />);
    expect(screen.getByText(/Außen/)).toBeInTheDocument();
    expect(screen.getByText('12.4°C')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText(/8\.7°C/)).toBeInTheDocument();
    expect(screen.getByText(/8\.5 g\/m³/)).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('renders placeholders when values are missing', () => {
    render(<OutdoorConditionsCard outdoor={empty} />);
    expect(screen.getByText('–°C')).toBeInTheDocument();
    expect(screen.getByText('–%')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
