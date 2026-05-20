import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryRangeTabs } from './HistoryRangeTabs';

describe('HistoryRangeTabs', () => {
  it('renders the four resolution tabs', () => {
    render(<HistoryRangeTabs value="day" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Year' })).toBeInTheDocument();
  });

  it('marks the active tab', () => {
    render(<HistoryRangeTabs value="week" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onChange with the clicked resolution', () => {
    const handle = vi.fn();
    render(<HistoryRangeTabs value="day" onChange={handle} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    expect(handle).toHaveBeenCalledWith('month');
  });
});
