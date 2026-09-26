import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const mayRead = can.readStock(user);

  const initialView = searchParams.get('view') === 'low-stock' ? 'low-stock' : 'all';
  const initialWarehouse = searchParams.get('warehouseId') || '';

  const [activeTab, setActiveTab] = useState(initialView);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState(initialWarehouse);
  const [nonZero, setNonZero] = useState('');

  // Sync state if URL changes
  useEffect(() => {
    const urlView = searchParams.get('view');
    if (urlView === 'low-stock') {
      setActiveTab('low-stock');
    }
    const urlWh = searchParams.get('warehouseId');
    if (urlWh) {
      setWarehouseId(urlWh);
    }
  }, [searchParams]);

  const debouncedSearch = useDebounced(search);

  const endpoint = activeTab === 'low-stock' ? '/stock/low-stock' : '/stock';
  const queryKey = activeTab === 'low-stock' ? ['stock', 'low-stock'] : catalogKeys.stock;

  const params = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    warehouseId: warehouseId || undefined,
    ...(activeTab === 'all' ? { nonZero: nonZero || undefined } : {}),
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    queryKey,
    endpoint,
    params,
    { enabled: mayRead },
  );

  const warehouses = useOptionsQuery(['warehouse-options'], '/warehouses/options');

  const quantColumns = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-slate-900">{row.product?.sku}</span>
          <span className="text-xs text-slate-500 line-clamp-1">{row.product?.name}</span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-800 text-sm">{row.location?.name || '—'}</span>
          <span className="text-xs text-slate-400">
            {row.location?.shortCode ? `[${row.location.shortCode}]` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      render: (row) => (
        <span className="text-sm font-medium text-slate-700">
          {row.location?.warehouse?.name || '—'}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Location Type',
      render: (row) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
          {locationTypeLabel(row.location?.type)}
        </span>
      ),
    },
    {
      key: 'onHand',
      header: 'On Hand',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-semibold text-slate-900">
          {formatQuantity(row.onHand)}
        </span>
      ),
    },
    {
      key: 'reservedQuantity',
      header: 'Reserved',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-slate-600">
          {formatQuantity(row.reservedQuantity)}
        </span>
      ),
    },
    {
      key: 'freeToUse',
      header: 'Free to Use',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-semibold text-emerald-700">
          {formatQuantity(row.freeToUse)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            Number(row.onHand) <= 0
              ? 'bg-rose-100 text-rose-800 border border-rose-200'
              : row.isLowStock
              ? 'bg-amber-100 text-amber-800 border border-amber-200'
              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
          }`}
        >
          {Number(row.onHand) <= 0
            ? 'Out of Stock'
            : row.isLowStock
            ? 'Low Stock'
            : 'Healthy'}
        </span>
      ),
    },
  ];

  const lowStockColumns = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-slate-900">{row.sku}</span>
          <span className="text-xs text-slate-500">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => (
        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
          {row.category?.name || '—'}
        </span>
      ),
    },
    {
      key: 'onHand',
      header: 'On Hand',
      align: 'right',
      render: (row) => (
        <span
          className={`font-mono font-bold ${
            Number(row.onHand) <= 0 ? 'text-rose-600' : 'text-amber-600'
          }`}
        >
          {formatQuantity(row.onHand)} {row.uom?.code}
        </span>
      ),
    },
    {
      key: 'reorderMin',
      header: 'Min Threshold',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-slate-700">
          {formatQuantity(row.reorderMin)} {row.uom?.code}
        </span>
      ),
    },
    {
      key: 'shortfall',
      header: 'Shortfall',
      align: 'right',
      render: (row) => (
        <span className="font-mono font-semibold text-rose-700">
          -{formatQuantity(row.shortfall)}
        </span>
      ),
    },
    {
      key: 'freeToUse',
      header: 'Free to Use',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-slate-600">
          {formatQuantity(row.freeToUse)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Alert Level',
      render: (row) => (
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            row.isOutOfStock
              ? 'bg-rose-100 text-rose-800 border border-rose-200'
              : 'bg-amber-100 text-amber-800 border border-amber-200'
          }`}
        >
          {row.isOutOfStock ? 'OUT OF STOCK' : 'LOW STOCK'}
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Stock Balances & Low Stock"
        description="Monitor real-time inventory balances, stock-holding locations, and reorder alerts."
      />

      <Card>
        {/* Navigation Tabs */}
        <div className="border-b border-slate-200 px-4 pt-3 flex items-center gap-6 bg-slate-50/50">
          <button
            type="button"
            onClick={() => {
              setActiveTab('all');
              setPage(1);
              setSearchParams(warehouseId ? { warehouseId } : {});
            }}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'all'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            All Stock Balances
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('low-stock');
              setPage(1);
              setSearchParams({ view: 'low-stock', ...(warehouseId ? { warehouseId } : {}) });
            }}
            className={`pb-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'low-stock'
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <span>Low Stock Alerts</span>
            <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-bold">
              Alerts
            </span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white p-4">
          <div className="min-w-64 flex-1">
            <label
              htmlFor="stock-search"
              className="mb-1 block text-xs font-medium text-slate-600 uppercase tracking-wider"
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
              placeholder="Search by SKU or product name..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-sm"
            />
          </div>

          <Select
            label="Warehouse"
            name="warehouseId"
            value={warehouseId}
            onChange={(event) => {
              const wh = event.target.value;
              setWarehouseId(wh);
              setPage(1);
              setSearchParams({
                ...(activeTab === 'low-stock' ? { view: 'low-stock' } : {}),
                ...(wh ? { warehouseId: wh } : {}),
              });
            }}
            options={(warehouses.data || []).map((w) => ({
              value: w.id,
              label: `${w.name} (${w.shortCode})`,
            }))}
            placeholder="All warehouses"
          />

          {activeTab === 'all' && (
            <Select
              label="Balance Filter"
              name="nonZero"
              value={nonZero}
              onChange={(event) => {
                setNonZero(event.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Quants' },
                { value: 'true', label: 'Positive Stock Only' },
                { value: 'false', label: 'Zero Balance' },
              ]}
            />
          )}

          {isFetching && !isLoading && (
            <span className="pb-2 text-xs font-medium text-blue-600 animate-pulse">
              Updating balances...
            </span>
          )}
        </div>

        {!mayRead ? (
          <EmptyState
            title="Access Restricted"
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
              columns={activeTab === 'low-stock' ? lowStockColumns : quantColumns}
              rows={data?.items}
              empty={
                <EmptyState
                  title={activeTab === 'low-stock' ? 'No low stock alerts' : 'No balances found'}
                  description={
                    activeTab === 'low-stock'
                      ? 'All active products are currently above their reorder minimum thresholds.'
                      : 'Receive goods into a stock-holding location to view balances here.'
                  }
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

