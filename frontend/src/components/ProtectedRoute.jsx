import { useEffect } from 'react';
import { Navigate, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AppShell, Card } from './AppShell';

export function ProtectedRoute({ check, fallbackMessage }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    const handleUnauthorized = () => {
      window.location.href = '/login';
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center text-sm font-medium text-slate-500">Loading session...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (check && !check(user)) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl py-12">
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 mb-4">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-slate-600">
              {fallbackMessage || 'You do not have permission to access this module.'}
            </p>
            <div className="mt-6">
              <Link
                to="/dashboard"
                className="inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Return to Dashboard
              </Link>
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }

  return <Outlet />;
}
