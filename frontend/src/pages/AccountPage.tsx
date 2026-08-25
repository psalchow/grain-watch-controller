import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wheat, Loader2, LogOut, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/api';
import { extractError } from '@/lib/messages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AccountPage() {
  const { user, logout, reloadUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forced = !!user?.mustChangePassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Bitte alle Felder ausfüllen');
      return;
    }
    if (newPassword.length < 8) {
      setError('Das neue Passwort muss mindestens 8 Zeichen lang sein');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Neues Passwort und Bestätigung stimmen nicht überein');
      return;
    }

    setLoading(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      await reloadUser();
      navigate('/');
    } catch (err: unknown) {
      setError(extractError(err, 'Passwort konnte nicht geändert werden'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-4 bg-background">
      {/* No way back while the change is forced — the route guard would send
          the user straight back here, so offering it would only mislead. */}
      {!forced && (
        <div className="w-full max-w-md">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-1">Back</span>
          </Button>
        </div>
      )}
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Wheat className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Change Password</CardTitle>
          <CardDescription>
            {forced
              ? 'You must set a new password before continuing'
              : 'Update your account password'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            <div className="space-y-2">
              <label htmlFor="currentPassword" className="text-sm font-medium">Current password</label>
              <Input id="currentPassword" type="password" value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)} disabled={loading} />
            </div>
            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-sm font-medium">New password</label>
              <Input id="newPassword" type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} disabled={loading} />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm new password</label>
              <Input id="confirmPassword" type="password" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>) : 'Change password'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={logout} disabled={loading}>
              <LogOut className="h-4 w-4 mr-2" />Logout
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
