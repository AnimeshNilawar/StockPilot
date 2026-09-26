import { Link } from 'react-router-dom';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { Badge } from '../components/DataTable';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { useListQuery, useOptionsQuery } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { formatQuantity, locationTypeLabel } from '../lib/format';

const TYPE_ORDER = ['INTERNAL', 'PRODUCTION', 'SCRAP', 'TRANSIT', 'VENDOR', 'CUSTOMER'];

export function DashboardPage() {
  const { user } = useAuth();
  const mayReadStock = can.readStock(user) || can.moveStock(user);

  const lowStock = useListQuery(
    ['stock', 'low-stock'],
    '/stock/low-stock',
    { pageSize: 8 },
    { enabled: mayReadStock },
  );
  const warehouses = useOptionsQuery(['warehouse-options'], '/warehouses/options');
  const locations = useOptionsQuery(['location-options'], '/locations/options');

  const locationCounts = (locations.data || []).reduce((acc, location) => {
    acc[location.warehouseId] = (acc[location.warehouseId] || 0) + 1;
    return acc;
  }, {});

  return (
    <AppShell>
      <PageHeader
        title={`Welcome back, ${user?.name || user?.email}`}
        description="Master data is in place and the inventory engine is live. Document screens arrive in the next phases."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">Warehouses</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">{warehouses.data?.length ?? '—'}</p>
          <p className="mt-1 text-xs text-slate-500">Each one owns its own locations</p>
        </Card>

        <Card className="p-5">
          <p className="text-sm text-slate-500">Locations</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">{locations.data?.length ?? '—'}</p>
          <p className="mt-1 text-xs text-slate-500">Stock-holding and boundary</p>
        </Card>

        <Card className="p-5">
          <p className="text-sm text-slate-500">Your scope</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">
            {user?.warehouseIds?.length || 'All'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {user?.role === 'WAREHOUSE_STAFF' ? 'Assigned warehouses' : 'Warehouses you can see'}
          </p>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold text-slate-800">Low stock</h2>
            <Link to="/stock" className="text-sm font-medium text-blue-600 hover:text-blue-700">
              All balances
            </Link>
          </div>

          {!mayReadStock ? (
            <EmptyState
              title="Access restricted"
              description="You do not have permission to view stock balances."
            />
          ) : lowStock.isLoading ? (
            <LoadingState />
          ) : lowStock.isError ? (
            <div className="p-5">
              <ErrorState error={lowStock.error} onRetry={lowStock.refetch} />
            </div>
          ) : (lowStock.data?.items || []).length === 0 ? (
            <EmptyState
              title="Everything is above its minimum"
              description="No product is currently at or below its reorder point."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {lowStock.data.items.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{row.sku}</p>
                    <p className="truncate text-xs text-slate-500">{row.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600 tabular-nums">
                      {formatQuantity(row.onHand)} / {formatQuantity(row.reorderMin || 0)}
                    </span>
                    {row.isOutOfStock ? (
                      <Badge className="bg-rose-100 text-rose-700">Out</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">Low</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold text-slate-800">Warehouses</h2>
            <Link
              to="/warehouses"
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Manage
            </Link>
          </div>

          {(warehouses.data || []).length === 0 ? (
            <EmptyState title="No warehouses" description="Create one to start receiving stock." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {warehouses.data.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="font-medium text-slate-800">{w.name}</p>
                    <p className="font-mono text-xs text-slate-500">{w.shortCode}</p>
                  </div>
                  <Link
                    to={`/warehouses/${w.id}/locations`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    {locationCounts[w.id] || 0} locations
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold text-slate-800">How location types shape movement</h2>
        <p className="mt-1 text-sm text-slate-500">
          The engine enforces these rules before touching a single balance.
        </p>
        <ul className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
          {TYPE_ORDER.map((type) => (
            <li key={type} className="flex items-center gap-2">
              <Badge
                className={
                  ['VENDOR', 'CUSTOMER'].includes(type)
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-sky-100 text-sky-800'
                }
              >
                {locationTypeLabel(type)}
              </Badge>
              <span className="text-xs">
                {['VENDOR', 'CUSTOMER'].includes(type)
                  ? 'boundary, never holds a balance'
                  : 'holds stock'}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
