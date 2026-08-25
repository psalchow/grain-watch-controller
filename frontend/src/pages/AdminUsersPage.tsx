import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { adminApi, stocksApi } from '@/api';
import { extractError } from '@/lib/messages';
import { AdminUser, GrainStock } from '@/types/api';

type Editing = { user: AdminUser } | null;
type Resetting = { user: AdminUser } | null;

const ALL = '*';

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stocks, setStocks] = useState<GrainStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [resetting, setResetting] = useState<Resetting>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([adminApi.listUsers(), stocksApi.getStocks()]);
      setUsers(u);
      setStocks(s.stocks);
    } catch {
      setError('Benutzer konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (user: AdminUser) => {
    setError(null);
    try {
      await adminApi.setActive(user.id, !user.active);
      await load();
    } catch {
      setError('Benutzerstatus konnte nicht geändert werden');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-screen-xl px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
              <span className="ml-1">Back</span>
            </Button>
            <h1 className="text-2xl font-semibold">User Management</h1>
          </div>
          <Button onClick={() => setCreating(true)}>New user</Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Username</th>
                  <th className="p-3 text-left">Role</th>
                  <th className="p-3 text-left">Stocks</th>
                  <th className="p-3 text-left">Active</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="p-3">{u.username}</td>
                    <td className="p-3">{u.role}</td>
                    <td className="p-3">{u.stockAccess.includes(ALL) ? 'All stocks' : u.stockAccess.join(', ')}</td>
                    <td className="p-3">{u.active ? 'Yes' : 'No'}</td>
                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                      <Button variant="outline" size="sm" onClick={() => setEditing({ user: u })}>Edit</Button>
                      <Button variant="outline" size="sm" onClick={() => setResetting({ user: u })}>Reset password</Button>
                      <Button variant={u.active ? 'destructive' : 'secondary'} size="sm" onClick={() => toggleActive(u)}>
                        {u.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {creating && (
        <CreateUserDialog stocks={stocks} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />
      )}
      {editing && (
        <EditUserDialog user={editing.user} stocks={stocks} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {resetting && (
        <ResetPasswordDialog user={resetting.user} onClose={() => setResetting(null)} onSaved={() => setResetting(null)} />
      )}
    </div>
  );
}

function StockSelect({ stocks, value, onChange }: { stocks: GrainStock[]; value: string[]; onChange: (v: string[]) => void }) {
  const allSelected = value.includes(ALL);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allSelected} onChange={(e) => onChange(e.target.checked ? [ALL] : [])} />
        All stocks
      </label>
      {!allSelected && stocks.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(s.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((v) => v !== s.id))}
          />
          {s.name}
        </label>
      ))}
    </div>
  );
}

function CreateUserDialog({ stocks, onClose, onSaved }: { stocks: GrainStock[]; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [stockAccess, setStockAccess] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (username.length < 3) return setError('Der Benutzername muss mindestens 3 Zeichen lang sein');
    if (password.length < 8) return setError('Das temporäre Passwort muss mindestens 8 Zeichen lang sein');
    const access = role === 'admin' ? ['*'] : stockAccess;
    if (access.length === 0) return setError('Mindestens eine Halle auswählen');
    setSaving(true);
    try {
      await adminApi.createUser({ username, password, role, stockAccess: access });
      onSaved();
    } catch (err) {
      setError(extractError(err, 'Benutzer konnte nicht angelegt werden'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="New user">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <div className="space-y-2">
          <label className="text-sm font-medium">Username</label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Temporary password</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-muted-foreground">The user must change this on first login.</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Role</label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        {role === 'viewer' && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Stock access</label>
            <StockSelect stocks={stocks} value={stockAccess} onChange={setStockAccess} />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? 'Saving...' : 'Create user'}
        </Button>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ user, stocks, onClose, onSaved }: { user: AdminUser; stocks: GrainStock[]; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<'admin' | 'viewer'>(user.role);
  const [stockAccess, setStockAccess] = useState<string[]>(user.stockAccess);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const access = role === 'admin' ? ['*'] : stockAccess;
    if (access.length === 0) return setError('Mindestens eine Halle auswählen');
    setSaving(true);
    try {
      await adminApi.updatePermissions(user.id, { role, stockAccess: access });
      onSaved();
    } catch (err) {
      setError(extractError(err, 'Benutzer konnte nicht geändert werden'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Edit ${user.username}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <div className="space-y-2">
          <label className="text-sm font-medium">Role</label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        {role === 'viewer' && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Stock access</label>
            <StockSelect stocks={stocks} value={stockAccess} onChange={setStockAccess} />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </Button>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) return setError('Das Passwort muss mindestens 8 Zeichen lang sein');
    setSaving(true);
    try {
      await adminApi.resetPassword(user.id, newPassword);
      setDone(true);
    } catch (err) {
      setError(extractError(err, 'Passwort konnte nicht zurückgesetzt werden'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Reset password: ${user.username}`}>
      {done ? (
        <div className="space-y-4">
          <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">
            Password reset. The user must change it on next login.
          </div>
          <Button className="w-full" onClick={onSaved}>Done</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <div className="space-y-2">
            <label className="text-sm font-medium">Temporary password</label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Reset password'}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
