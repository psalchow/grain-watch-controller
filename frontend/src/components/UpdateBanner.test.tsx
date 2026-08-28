import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateBanner } from './UpdateBanner';
import { useRegisterSW } from 'virtual:pwa-register/react';

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: vi.fn() }));

const updateServiceWorker = vi.fn();
const setNeedRefresh = vi.fn();

/** Shapes the hook's return value the way the plugin documents it. */
function mockRegisterSW(needRefresh: boolean) {
  vi.mocked(useRegisterSW).mockReturnValue({
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker,
  } as unknown as ReturnType<typeof useRegisterSW>);
}

describe('UpdateBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays hidden while no update is waiting', () => {
    mockRegisterSW(false);

    const { container } = render(<UpdateBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('offers the update once a worker is waiting', () => {
    mockRegisterSW(true);

    render(<UpdateBanner />);

    expect(screen.getByText('A new version is available.')).toBeInTheDocument();
  });

  it('activates the waiting worker and reloads on Update', () => {
    mockRegisterSW(true);

    render(<UpdateBanner />);
    fireEvent.click(screen.getByText('Update'));

    // `true` is what makes it reload the page after activation.
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('only dismisses the banner on Later, leaving the worker waiting', () => {
    mockRegisterSW(true);

    render(<UpdateBanner />);
    fireEvent.click(screen.getByText('Later'));

    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it('schedules a periodic update check once registered', () => {
    vi.useFakeTimers();
    const update = vi.fn();
    vi.mocked(useRegisterSW).mockImplementation((options) => {
      options?.onRegisteredSW?.('/sw.js', {
        update,
      } as unknown as ServiceWorkerRegistration);
      return {
        needRefresh: [false, setNeedRefresh],
        offlineReady: [false, vi.fn()],
        updateServiceWorker,
      } as unknown as ReturnType<typeof useRegisterSW>;
    });

    render(<UpdateBanner />);
    expect(update).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
