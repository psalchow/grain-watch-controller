import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';
import { useAuth } from '@/contexts/AuthContext';
import type { User } from '@/types/api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/components/AppInfoDialog', () => ({
  AppInfoDialog: ({ open }: { open: boolean }) =>
    open ? <div>app-info-dialog</div> : null,
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return { ...actual, useNavigate: () => navigate };
});

const logout = vi.fn();

function setUser(role: 'admin' | 'viewer') {
  const user: User = {
    id: 'usr_001',
    username: 'peter',
    role,
    stockAccess: role === 'admin' ? ['*'] : ['grain-watch-1'],
  };
  vi.mocked(useAuth).mockReturnValue({ user, logout } as unknown as ReturnType<
    typeof useAuth
  >);
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  );
}

/** The menu lives in a dialog, so its entries only exist once it is open. */
function openMenu() {
  fireEvent.click(screen.getByLabelText('Menu'));
}

describe('Header mobile menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser('admin');
  });

  it('keeps the menu closed until the button is pressed', () => {
    renderHeader();

    // 'Account' is still rendered by the wide-screen navigation, which CSS
    // hides — the menu adds a second one, so count instead of asserting absence.
    expect(screen.queryAllByText('Account')).toHaveLength(1);

    openMenu();

    expect(screen.queryAllByText('Account')).toHaveLength(2);
  });

  it('offers user management to an admin', () => {
    renderHeader();
    openMenu();

    expect(screen.queryAllByText('Users')).toHaveLength(2);
  });

  it('hides user management from a viewer', () => {
    setUser('viewer');
    renderHeader();
    openMenu();

    expect(screen.queryAllByText('Users')).toHaveLength(0);
  });

  it('navigates and closes the menu when an entry is chosen', () => {
    renderHeader();
    openMenu();

    // The second match is the menu entry; the first belongs to the wide layout.
    fireEvent.click(screen.getAllByText('Account')[1]!);

    expect(navigate).toHaveBeenCalledWith('/account');
    expect(screen.queryAllByText('Account')).toHaveLength(1);
  });

  it('logs out from the menu', () => {
    renderHeader();
    openMenu();

    fireEvent.click(screen.getAllByText('Logout')[1]!);

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('opens the app info dialog from the menu without stacking dialogs', () => {
    renderHeader();
    openMenu();

    fireEvent.click(screen.getByText('App info'));

    expect(screen.getByText('app-info-dialog')).toBeInTheDocument();
    // The menu closed, so its entries are gone again.
    expect(screen.queryAllByText('Account')).toHaveLength(1);
  });
});

describe('Header brand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser('admin');
  });

  it('shows the shared brand mark beside the product name', () => {
    renderHeader();

    const brand = screen.getByRole('link', { name: 'Grainwatch' });
    expect(brand.querySelector('svg[viewBox="0 0 512 512"]')).not.toBeNull();
  });
});
