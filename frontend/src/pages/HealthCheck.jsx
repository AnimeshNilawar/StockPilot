import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ErrorState, LoadingState } from '../components/States';

/** Diagnostics screen: proves the browser can reach the API and its database. */
export function HealthCheck() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health'),
    retry: false,
  });

  const readiness = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => api.get('/health/ready'),
    retry: false,
  });

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-800">API health</h1>

        {isLoading ? (
          <LoadingState label="Contacting the API…" />
        ) : isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="font-semibold text-emerald-900">API is reachable</p>
            <pre className="mt-3 overflow-auto rounded-lg bg-emerald-100/60 p-3 text-xs text-emerald-900">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-semibold text-slate-800">Database readiness</p>
          {readiness.isLoading ? (
            <p className="mt-2 text-sm text-slate-500">Checking…</p>
          ) : readiness.isError ? (
            <p className="mt-2 text-sm text-rose-600">The database did not answer.</p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              {readiness.data?.data?.database === 'up'
                ? 'Connected and responding.'
                : 'Unexpected response.'}
            </p>
          )}
        </div>

        <a
          href="/dashboard"
          className="inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Back to the app
        </a>
      </div>
    </div>
  );
}
