import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StockHistorySection } from './StockHistorySection';
import { stocksApi } from '@/api';
import type { StockHistoryResponse } from '@/types/api';

// jsdom workarounds for Recharts' ResponsiveContainer:
// - jsdom does not implement ResizeObserver; provide a stub that synchronously
//   reports a fixed content size so ResponsiveContainer's effect runs.
// - jsdom does not compute layout, so getBoundingClientRect returns zeroes;
//   override it to return a non-zero rect so the chart can determine its size.
class ResizeObserverStub {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 800,
            bottom: 300,
            width: 800,
            height: 300,
            toJSON() {
              return this;
            },
          } as DOMRectReadOnly,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 300,
    width: 800,
    height: 300,
    toJSON() {
      return this;
    },
  } as DOMRect;
};

vi.mock('@/api', () => ({
  stocksApi: {
    getStockHistory: vi.fn(),
  },
}));

const baseResponse: StockHistoryResponse = {
  stockId: 'grain-watch-1',
  stockName: 'Halle 8',
  resolution: 'day',
  from: '2026-05-18T22:00:00.000Z',
  to: '2026-05-19T08:30:00.000Z',
  intervalSeconds: 1800,
  devices: ['1.1', '1.2', '1.3', '1.4', '1.5'],
  series: {
    temperature: {
      top: [
        [{ t: '2026-05-19T00:00:00Z', v: 12 }],
        [], [], [], [],
      ],
      mid: [
        [{ t: '2026-05-19T00:00:00Z', v: 11 }],
        [], [], [], [],
      ],
      bottom: [
        [{ t: '2026-05-19T00:00:00Z', v: 10 }],
        [], [], [], [],
      ],
    },
  },
};

beforeEach(() => {
  vi.mocked(stocksApi.getStockHistory).mockReset();
});

function renderSection(props?: Partial<{
  resolution: 'day' | 'week' | 'month' | 'year';
  refreshNonce: number;
  onResolutionChange: (r: 'day' | 'week' | 'month' | 'year') => void;
}>) {
  return render(
    <div style={{ width: 800, height: 800 }}>
      <StockHistorySection
        stockId="grain-watch-1"
        resolution={props?.resolution ?? 'day'}
        refreshNonce={props?.refreshNonce ?? 0}
        onResolutionChange={props?.onResolutionChange ?? (() => {})}
      />
    </div>,
  );
}

describe('StockHistorySection', () => {
  it('fetches history on mount and renders three temperature charts', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    renderSection();
    await waitFor(() => {
      expect(stocksApi.getStockHistory).toHaveBeenCalledWith('grain-watch-1', 'day');
    });
    expect(await screen.findByText('Top Temperatures')).toBeInTheDocument();
    expect(screen.getByText('Mid Temperatures')).toBeInTheDocument();
    expect(screen.getByText('Bottom Temperatures')).toBeInTheDocument();
  });

  it('re-fetches when the resolution prop changes', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    const { rerender } = renderSection({ resolution: 'day' });
    await waitFor(() =>
      expect(stocksApi.getStockHistory).toHaveBeenCalledWith('grain-watch-1', 'day'),
    );
    rerender(
      <div style={{ width: 800, height: 800 }}>
        <StockHistorySection
          stockId="grain-watch-1"
          resolution="week"
          refreshNonce={0}
          onResolutionChange={() => {}}
        />
      </div>,
    );
    await waitFor(() =>
      expect(stocksApi.getStockHistory).toHaveBeenCalledWith('grain-watch-1', 'week'),
    );
  });

  it('re-fetches when the refreshNonce changes', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    const { rerender } = renderSection({ refreshNonce: 0 });
    await waitFor(() => expect(stocksApi.getStockHistory).toHaveBeenCalledTimes(1));
    rerender(
      <div style={{ width: 800, height: 800 }}>
        <StockHistorySection
          stockId="grain-watch-1"
          resolution="day"
          refreshNonce={1}
          onResolutionChange={() => {}}
        />
      </div>,
    );
    await waitFor(() => expect(stocksApi.getStockHistory).toHaveBeenCalledTimes(2));
  });

  it('forwards tab clicks via onResolutionChange', async () => {
    vi.mocked(stocksApi.getStockHistory).mockResolvedValue(baseResponse);
    const onChange = vi.fn();
    renderSection({ onResolutionChange: onChange });
    await screen.findByText('Top Temperatures');
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    expect(onChange).toHaveBeenCalledWith('week');
  });

  it('renders an error state with a retry button on fetch failure', async () => {
    vi.mocked(stocksApi.getStockHistory).mockRejectedValueOnce(new Error('boom'));
    renderSection();
    expect(
      await screen.findByText('Failed to load history. Please try again.'),
    ).toBeInTheDocument();
    vi.mocked(stocksApi.getStockHistory).mockResolvedValueOnce(baseResponse);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Top Temperatures')).toBeInTheDocument();
  });
});
