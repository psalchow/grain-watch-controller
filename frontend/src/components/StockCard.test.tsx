import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockCard } from './StockCard';
import type { GrainStock } from '@/types/api';

const stock = (overrides: Partial<GrainStock> = {}): GrainStock => ({
  id: 'grain-watch-1',
  name: 'Halle 8',
  description: 'Lagerhalle 8',
  hasGrainSensors: true,
  fanControlEnabled: true,
  active: true,
  ...overrides,
});

describe('StockCard', () => {
  it('shows both icons for a fully equipped stock', () => {
    render(<StockCard stock={stock()} />);

    expect(screen.getByText('Getreidethermometer', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Lüftersteuerung', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows only the fan icon for a fan-only stock', () => {
    render(<StockCard stock={stock({ hasGrainSensors: false })} />);

    expect(screen.queryByText('Getreidethermometer', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.getByText('Lüftersteuerung', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows only the thermometer icon without fan control', () => {
    render(<StockCard stock={stock({ fanControlEnabled: false })} />);

    expect(screen.getByText('Getreidethermometer', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Lüftersteuerung', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('labels a stock with nothing to show', () => {
    render(
      <StockCard stock={stock({ hasGrainSensors: false, fanControlEnabled: false })} />,
    );

    expect(screen.getByText('Keine Messwerte, keine Steuerung')).toBeInTheDocument();
  });

  it('treats an absent fan flag as no fan control', () => {
    const { fanControlEnabled: _omitted, ...withoutFlag } = stock();
    render(<StockCard stock={withoutFlag} />);

    expect(screen.queryByText('Lüftersteuerung', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('treats an absent sensor flag as having sensors', () => {
    const { hasGrainSensors: _omitted, ...withoutFlag } = stock();
    render(<StockCard stock={withoutFlag} />);

    expect(screen.getByText('Getreidethermometer', { selector: 'span' })).toBeInTheDocument();
  });
});
