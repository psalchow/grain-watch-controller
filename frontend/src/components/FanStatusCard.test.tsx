import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FanStatusCard } from './FanStatusCard';
import type { FanStatus } from '../types/fan';

const base: FanStatus = {
  stockId: 'grain-watch-1', state: 'ON', desiredOn: true, shellyOnline: true,
  lastWarning: null, lastAlert: null, since: null, updatedAt: '2026-07-09T10:00:00.000Z',
};

describe('FanStatusCard', () => {
  it('shows the running state', () => {
    render(<FanStatusCard status={base} connected={true} />);
    expect(screen.getByText(/Läuft/i)).toBeInTheDocument();
  });

  it('shows an in-flight label when pending', () => {
    render(<FanStatusCard status={{ ...base, state: 'TURN_ON_PENDING' }} connected={true} />);
    expect(screen.getByText(/wird eingeschaltet/i)).toBeInTheDocument();
  });

  it('shows an alert badge when there is an alert', () => {
    render(<FanStatusCard status={{ ...base, state: 'FAULT', lastAlert: { message: 'no follow', ts: 'x' } }} connected={true} />);
    expect(screen.getByText(/Fehler/i)).toBeInTheDocument();
  });

  it('renders a placeholder when status is null', () => {
    render(<FanStatusCard status={null} connected={false} />);
    expect(screen.getByText(/Lüfter/i)).toBeInTheDocument();
  });
});
