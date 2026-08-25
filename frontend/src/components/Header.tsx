import { useState } from 'react';
import { Info, LogOut, Wheat, UserCog, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { AppInfoDialog } from '@/components/AppInfoDialog';

export function Header() {
  const { user, logout } = useAuth();
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center px-4">
        {/* The brand doubles as the way back to the stock overview — without it
            the account and user-management screens are dead ends. */}
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <Wheat className="h-6 w-6 text-primary" />
          <span className="font-semibold text-lg">Grainwatch</span>
        </Link>

        <div className="flex flex-1 items-center justify-end gap-4">
          {user && (
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.username}
            </span>
          )}
          {user && (
            <Link
              to="/account"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <UserCog className="h-4 w-4 mr-2" />
              Account
            </Link>
          )}
          {user?.role === 'admin' && (
            <Link
              to="/admin/users"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <Users className="h-4 w-4 mr-2" />
              Users
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoOpen(true)}
            aria-label="App info"
          >
            <Info className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      <AppInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
    </header>
  );
}
