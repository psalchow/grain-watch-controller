import { useState } from 'react';
import { Info, LogOut, Menu, UserCog, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { WheatMark } from '@/brand/WheatMark';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { AppInfoDialog } from '@/components/AppInfoDialog';

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isAdmin = user?.role === 'admin';
  // A second membership has no single name to show, so it degrades to
  // nothing rather than showing a wrong tenant.
  const tenantName =
    !isAdmin && user?.tenants.length === 1 ? user.tenants[0].name : null;

  /** Leaves the menu before acting, so the two dialogs never overlap. */
  const runFromMenu = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center px-4">
        {/* The brand doubles as the way back to the stock overview — without it
            the account and user-management screens are dead ends. */}
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <WheatMark className="h-6 w-6 text-primary" />
          <span className="font-semibold text-lg">Grainwatch</span>
        </Link>

        {/* Wide screens: everything inline. The five items plus their labels
            overflow a phone in portrait, so below `sm` they move into a menu. */}
        <div className="hidden flex-1 items-center justify-end gap-4 sm:flex">
          {user && (
            <span className="text-sm text-muted-foreground">
              {user.username}
              {tenantName && ` · ${tenantName}`}
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
          {isAdmin && (
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

        {/* Narrow screens: a single button opening the same actions as a list. */}
        <div className="flex flex-1 items-center justify-end sm:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <Dialog
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={user?.username ?? 'Menu'}
      >
        {/* Full-width rows rather than a compact list: this is operated on a
            phone, often with gloves on. */}
        <nav className="flex flex-col gap-1">
          {user && (
            <MenuItem
              icon={<UserCog className="h-5 w-5" />}
              label="Account"
              onClick={() => runFromMenu(() => navigate('/account'))}
            />
          )}
          {isAdmin && (
            <MenuItem
              icon={<Users className="h-5 w-5" />}
              label="Users"
              onClick={() => runFromMenu(() => navigate('/admin/users'))}
            />
          )}
          <MenuItem
            icon={<Info className="h-5 w-5" />}
            label="App info"
            onClick={() => runFromMenu(() => setInfoOpen(true))}
          />
          <MenuItem
            icon={<LogOut className="h-5 w-5" />}
            label="Logout"
            onClick={() => runFromMenu(logout)}
          />
        </nav>
      </Dialog>

      <AppInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
    </header>
  );
}

/**
 * One row of the mobile menu, sized for a thumb.
 *
 * Built on Button so the focus ring, hover tokens and transitions come from
 * the design system. Only the layout is overridden: the row is full width and
 * left-aligned rather than a centred pill, and taller than any preset size to
 * give a thumb something to hit.
 */
function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="h-auto w-full justify-start gap-3 px-3 py-3 text-base"
    >
      {icon}
      {label}
    </Button>
  );
}
