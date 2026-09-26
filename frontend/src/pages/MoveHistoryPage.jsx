import { useState } from 'react';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { Badge, DataTable } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import { catalogKeys, useListQuery, useOptionsQuery } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import {
  documentTypeLabel,
  formatDateTime,
  formatQuantity,
  locationTypeLabel,
  stateLabel,
  stateTone,
} from '../lib/format';
import { LoadingState, ErrorState, EmptyState } from '../components/States';
import { Select } from '../components/ui';

export function MoveHistoryPage() {
  const { user } = useAuth();
  const mayRead = can.readStock(user) || can.viewMoveHistory(user);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const debouncedSearch = useDebounced(search);
  const params = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    state: state || undefined,
    documentType: documentType || undefined,
    warehouseId: warehouseId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    catalogKeys.moves,
    '/moves',
    params,
    { enabled: mayRead },
  );
  const warehouses = useOptionsQuery(['warehouse-options'], '/warehouses/options');

  const hasActiveFilters = Boolean(
    search || state || documentType || warehouseId || dateFrom || dateTo,
  );

  const resetFilters = () => {
    setSearch('');
    setState('');
    setDocumentType('');
    setWarehouseId('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const columns = [
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => (
        <span className="font-mono font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-xs">
          {row.reference}
        </span>
      ),
    },
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
      key: 'type',
      header: 'Document Type',
      render: (row) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
          {documentTypeLabel(row.documentType)}
        </span>
      ),
    },
    {
      key: 'from',
      header: 'From Location',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-slate-800 font-medium text-sm">{row.fromLocation?.name || '—'}</span>
          <span className="text-xs text-slate-400">
            {locationTypeLabel(row.fromLocation?.type)}
          </span>
        </div>
      ),
    },
    {
      key: 'to',
      header: 'To Location',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-slate-800 font-medium text-sm">{row.toLocation?.name || '—'}</span>
          <span className="text-xs text-slate-400">{locationTypeLabel(row.toLocation?.type)}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Quantity',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <span className="font-mono font-semibold text-slate-900">
            {formatQuantity(row.quantity)}
          </span>
          <span className="text-xs text-slate-400">{row.product?.uom?.code || ''}</span>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      render: (row) => (
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${stateTone(
            row.state,
          )}`}
        >
          {stateLabel(row.state)}
        </span>
      ),
    },
    {
      key: 'doneDate',
      header: 'Done At',
      render: (row) => (
        <span className="text-xs text-slate-600">
          {formatDateTime(row.doneDate || row.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Move History"
        description="The immutable ledger of every stock movement and inventory mutation."
      />

      <Card>
        <div className="border-b border-slate-200 bg-slate-50/50 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="lg:col-span-2">
              <label
                htmlFor="moves-search"
                className="mb-1 block text-xs font-medium text-slate-600 uppercase tracking-wider"
              >
                Search Ledger
              </label>
              <input
                id="moves-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search reference, SKU or name..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-sm"
              />
            </div>

            <div>
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
            </div>

            <div>
              <Select
                label="Document Type"
                name="documentType"
                value={documentType}
                onChange={(event) => {
                  setDocumentType(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All types' },
                  { value: 'RECEIPT', label: 'Receipt' },
                  { value: 'DELIVERY', label: 'Delivery' },
                  { value: 'INTERNAL', label: 'Internal Transfer' },
                  { value: 'ADJUSTMENT', label: 'Adjustment' },
                ]}
              />
            </div>

            <div>
              <Select
                label="Status"
                name="state"
                value={state}
                onChange={(event) => {
                  setState(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'DRAFT', label: 'Draft' },
                  { value: 'WAITING', label: 'Waiting' },
                  { value: 'READY', label: 'Ready' },
                  { value: 'DONE', label: 'Done' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600 uppercase tracking-wider">
                  From Date
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-sm"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600 uppercase tracking-wider">
                  To Date
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-sm"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-200/60">
            <div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="font-medium text-blue-600 hover:text-blue-700 underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
            {isFetching && !isLoading && (
              <span className="font-medium text-blue-600 animate-pulse">Refreshing ledger data...</span>
            )}
          </div>
        </div>

        {!mayRead ? (
          <EmptyState
            title="Access Restricted"
            description="You do not have permission to view stock move history."
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
                  title="No stock movements found"
                  description={
                    hasActiveFilters
                      ? 'No movements match your active filter criteria. Try clearing some filters.'
                      : 'Stock movements appear here once transactions or adjustments are processed.'
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

