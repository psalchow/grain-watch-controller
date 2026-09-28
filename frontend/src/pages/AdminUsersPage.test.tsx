import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminUsersPage from './AdminUsersPage';
import { adminApi } from '@/api';
import type { AdminUser, Tenant } from '@/types/api';

vi.mock('@/api', () => ({
  adminApi: {
    listUsers: vi.fn(),
    listTenants: vi.fn(),
    createUser: vi.fn(),
    updatePermissions: vi.fn(),
    resetPassword: vi.fn(),
    setActive: vi.fn(),
  },
}));
vi.mock('@/components/Header', () => ({ Header: () => null }));

const tenants: Tenant[] = [
  { id: 'tnt_default', name: 'Standard' },
  { id: 'tnt_other', name: 'Andere' },
];

const users: AdminUser[] = [
  {
    id: 'usr_001',
    username: 'peter',
    role: 'viewer',
    tenants: [tenants[0]],
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminUsersPage />
    </MemoryRouter>
  );
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.listUsers).mockResolvedValue(users);
    vi.mocked(adminApi.listTenants).mockResolvedValue(tenants);
  });

  it('lists the tenant name for each user', async () => {
    renderPage();

    expect(await screen.findByText('Standard')).toBeInTheDocument();
  });

  it('renders a tenant select fed by GET /admin/tenants when creating a user', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New user' }));

    const select = await screen.findByLabelText('Tenant');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Standard' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Andere' })).toBeInTheDocument();
  });

  it('sends a one-element tenantIds when creating a user', async () => {
    vi.mocked(adminApi.createUser).mockResolvedValue(users[0]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New user' }));

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'newviewer' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'longpassword' } });
    fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 'tnt_other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() =>
      expect(adminApi.createUser).toHaveBeenCalledWith({
        username: 'newviewer',
        password: 'longpassword',
        role: 'viewer',
        tenantIds: ['tnt_other'],
      })
    );
  });

  it('pre-selects the user’s tenant when editing, for either role', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const select = await screen.findByLabelText('Tenant');
    expect(select).toHaveValue('tnt_default');
  });

  it('sends a one-element tenantIds when saving an edit', async () => {
    vi.mocked(adminApi.updatePermissions).mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    fireEvent.change(await screen.findByLabelText('Tenant'), { target: { value: 'tnt_other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(adminApi.updatePermissions).toHaveBeenCalledWith('usr_001', {
        role: 'viewer',
        tenantIds: ['tnt_other'],
      })
    );
  });
});
