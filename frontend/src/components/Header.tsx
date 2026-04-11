import { LogOut, Wheat } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-xl items-center px-4">
        <div className="flex items-center gap-2">
          <Wheat className="h-6 w-6 text-primary" />
          <span className="font-semibold text-lg">Grainwatch</span>
        </div>

        <div className="flex flex-1 items-center justify-end gap-4">
          {user && (
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.username}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
