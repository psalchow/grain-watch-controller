import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FanStatusCard } from './FanStatusCard';
import type { FanStatus } from '../types/fan';

const base: FanStatus = {
  stockId: 'grain-watch-1', state: 'ON', desiredOn: true, fanControlReachable: true, contactorEngaged: null,
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

  it('reports the control as reachable', () => {
    render(<FanStatusCard status={{ ...base, fanControlReachable: true }} connected={true} />);
    expect(screen.getByText('Steuerung erreichbar')).toBeInTheDocument();
  });

  it('reports the control as unreachable', () => {
    render(<FanStatusCard status={{ ...base, fanControlReachable: false }} connected={true} />);
    expect(screen.getByText('Steuerung nicht erreichbar')).toBeInTheDocument();
  });

  it('reports reachability as unknown until the control has been heard from', () => {
    render(<FanStatusCard status={{ ...base, fanControlReachable: null }} connected={true} />);
    expect(screen.getByText('Erreichbarkeit unbekannt')).toBeInTheDocument();
  });

  it('marks reachability as stale while the stream is disconnected', () => {
    render(<FanStatusCard status={{ ...base, fanControlReachable: true }} connected={false} />);
    expect(screen.getByText('Steuerung erreichbar')).toHaveAttribute('data-stale', 'true');
  });

  it('falls back to unknown when the payload carries no reachability at all', () => {
    // A cached bundle can meet a rolled-back backend, and the SSE payload is
    // parsed unvalidated — so the field can be absent despite the type.
    const { fanControlReachable: _omitted, ...withoutField } = base;
    render(<FanStatusCard status={withoutField as FanStatus} connected={true} />);
    expect(screen.getByText('Erreichbarkeit unbekannt')).toBeInTheDocument();
  });

  it('falls back to unknown for a value the type does not allow', () => {
    // 'constructor' resolves through Object.prototype, so a nullish guard on
    // the lookup would let an inherited function through.
    const poisoned = { ...base, fanControlReachable: 'constructor' as unknown as boolean };
    render(<FanStatusCard status={poisoned} connected={true} />);
    expect(screen.getByText('Erreichbarkeit unbekannt')).toBeInTheDocument();
  });

  it('marks reachability as current while the stream is open', () => {
    render(<FanStatusCard status={{ ...base, fanControlReachable: true }} connected={true} />);
    expect(screen.getByText('Steuerung erreichbar')).toHaveAttribute('data-stale', 'false');
  });

  it('shows the local-run notice when the fan runs but the backend is not driving it', () => {
    render(
      <FanStatusCard
        status={{ ...base, desiredOn: false, contactorEngaged: true }}
        connected={true}
      />,
    );
    expect(screen.getByText(/vor Ort geschaltet/i)).toBeInTheDocument();
  });

  it('does not show the local-run notice when the backend is driving the fan', () => {
    render(
      <FanStatusCard
        status={{ ...base, desiredOn: true, contactorEngaged: true }}
        connected={true}
      />,
    );
    expect(screen.queryByText(/vor Ort geschaltet/i)).not.toBeInTheDocument();
  });

  it('stays inert without an onClick', () => {
    render(<FanStatusCard status={base} connected={true} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('becomes a labelled button that calls back when clicked', () => {
    const onClick = vi.fn();
    render(
      <FanStatusCard status={base} connected={true} onClick={onClick} label="Lüfter steuern" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lüfter steuern' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
