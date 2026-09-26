import { useState } from 'react';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { Badge, DataTable } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import { catalogKeys, useListQuery, useOptionsQuery } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { formatQuantity, locationTypeLabel } from '../lib/format';
import { LoadingState, ErrorState, EmptyState } from '../components/States';
import { Select } from '../components/ui';

export function StockBalancesPage() {
  const { user } = useAuth();
  const mayRead = can.readStock(user);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [nonZero, setNonZero] = useState('');

  const debouncedSearch = useDebounced(search);
  const params = { page, pageSize, search: debouncedSearch, warehouseId, nonZero };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    catalogKeys.stock,
    '/stock',
    params,
    { enabled: mayRead },
  );
  const warehouses = useOptionsQuery(['warehouse-options'], '/warehouses/options');

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-800">{row.product?.sku}</span>
          <span className="text-xs text-slate-500">{row.product?.name}</span>
        </div>
      ),
    },
    { key: 'location', header: 'Location', render: (row) => row.location?.name || '—' },
    {
      key: 'warehouse',
      header: 'Warehouse',
      render: (row) => row.location?.warehouse?.name || '—',
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <Badge>{locationTypeLabel(row.location?.type)}</Badge>,
    },
    {
      key: 'onHand',
      header: 'On hand',
      align: 'right',
      render: (row) => formatQuantity(row.onHand),
    },
    {
      key: 'reservedQuantity',
      header: 'Reserved',
      align: 'right',
      render: (row) => formatQuantity(row.reservedQuantity),
    },
    {
      key: 'freeToUse',
      header: 'Free to use',
      align: 'right',
      render: (row) => formatQuantity(row.freeToUse),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            row.isLowStock ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
          }`}
        >
          {row.isLowStock ? 'Low stock' : 'OK'}
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Stock balances"
        description="The cached quant table reconciles against the immutable move ledger."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="stock-search"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Search
            </label>
            <input
              id="stock-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="SKU or product name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <Select
            label="Warehouse"
            name="warehouseId"
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value);
              setPage(1);
            }}
            options={(warehouses.data || []).map((w) => ({
              value: w.id,
              label: `${w.name} (${w.shortCode})`,
            }))}
            placeholder="All warehouses"
          />

          <Select
            label="Balance"
            name="nonZero"
            value={nonZero}
            onChange={(event) => {
              setNonZero(event.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'true', label: 'Has stock' },
              { value: 'false', label: 'Zero' },
            ]}
          />

          {isFetching && !isLoading && (
            <span className="pb-2 text-xs text-slate-400">Updating…</span>
          )}
        </div>

        {!mayRead ? (
          <EmptyState
            title="Access restricted"
            description="You do not have permission to view stock balances."
          />
        ) : isLoading ? (
          <LoadingState />
        ) : isError ? (
          <div className="p-6">
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={data?.items}
              empty={
                <EmptyState
                  title="No balances found"
                  description="Receive goods into a stock-holding location to see balances here."
                />
              }
            />
            <Pagination
              pagination={data?.pagination}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </Card>
    </AppShell>
  );
}
