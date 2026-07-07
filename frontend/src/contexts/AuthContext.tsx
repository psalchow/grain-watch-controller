import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi } from '@/api';
import { AUTH_LOGOUT_EVENT } from '@/api/client';
import { User, LoginRequest } from '../types/api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // On mount, restore the session:
    // - a still-valid access token gives us the user immediately
    // - otherwise try a silent refresh (uses the httpOnly refresh cookie)
    const restoreSession = async () => {
      const current = authApi.getCurrentUser();
      if (current && authApi.isAuthenticated()) {
        if (!cancelled) {
          setUser(current);
          setIsLoading(false);
        }
        return;
      }

      try {
        const refreshed = await authApi.refresh();
        if (!cancelled) {
          setUser(refreshed);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    restoreSession();

    // The API client fires this when a refresh fails and the session ends.
    const handleForcedLogout = () => setUser(null);
    window.addEventListener(AUTH_LOGOUT_EVENT, handleForcedLogout);

    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_LOGOUT_EVENT, handleForcedLogout);
    };
  }, []);

  const login = async (credentials: LoginRequest) => {
    const response = await authApi.login(credentials);
    setUser(response.user);
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
