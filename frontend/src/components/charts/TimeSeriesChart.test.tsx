import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeSeriesChart } from './TimeSeriesChart';

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

const sampleSeries = [
  {
    label: 'Sensor 1.1',
    colour: '#2563eb',
    points: [
      { t: '2026-05-19T00:00:00Z', v: 12 },
      { t: '2026-05-19T00:30:00Z', v: 13 },
    ],
  },
  {
    label: 'Sensor 1.2',
    colour: '#16a34a',
    points: [
      { t: '2026-05-19T00:00:00Z', v: 11 },
      { t: '2026-05-19T00:30:00Z', v: null },
    ],
  },
];

function renderWithSize(ui: React.ReactElement) {
  return render(
    <div style={{ width: 800, height: 300 }}>{ui}</div>,
  );
}

describe('TimeSeriesChart', () => {
  it('renders the title', () => {
    renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={sampleSeries}
        intervalSeconds={1800}
        unit="°C"
      />,
    );
    expect(screen.getByText('Top Temperatures')).toBeInTheDocument();
  });

  it('renders a legend entry per series', () => {
    renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={sampleSeries}
        intervalSeconds={1800}
        unit="°C"
      />,
    );
    expect(screen.getByText('Sensor 1.1')).toBeInTheDocument();
    expect(screen.getByText('Sensor 1.2')).toBeInTheDocument();
  });

  it('renders threshold bands when supplied', () => {
    const { container } = renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={sampleSeries}
        intervalSeconds={1800}
        unit="°C"
        yDomain={[0, 40]}
        thresholdBands={[
          { from: -Infinity, to: 13, colour: '#22c55e', opacity: 0.08 },
          { from: 13, to: 22, colour: '#eab308', opacity: 0.08 },
        ]}
      />,
    );
    // ReferenceArea renders an SVG path with the supplied fill.
    const paths = container.querySelectorAll('path[fill="#22c55e"]');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders an empty-state placeholder when no series have points', () => {
    renderWithSize(
      <TimeSeriesChart
        title="Top Temperatures"
        series={[
          { label: 'Sensor 1.1', colour: '#2563eb', points: [] },
        ]}
        intervalSeconds={1800}
        unit="°C"
      />,
    );
    expect(
      screen.getByText('No history data available for the selected range'),
    ).toBeInTheDocument();
  });
});
