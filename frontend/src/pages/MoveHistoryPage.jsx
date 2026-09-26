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

  const debouncedSearch = useDebounced(search);
  const params = { page, pageSize, search: debouncedSearch, state, documentType, warehouseId };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    catalogKeys.moves,
    '/moves',
    params,
    { enabled: mayRead },
  );
  const warehouses = useOptionsQuery(['warehouse-options'], '/warehouses/options');

  const columns = [
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => (
        <span className="font-mono font-medium text-slate-800">{row.reference}</span>
      ),
    },
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
    {
      key: 'type',
      header: 'Type',
      render: (row) => <Badge>{documentTypeLabel(row.documentType)}</Badge>,
    },
    {
      key: 'from',
      header: 'From',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-slate-800">{row.fromLocation?.name || '—'}</span>
          <span className="text-xs text-slate-500">
            {locationTypeLabel(row.fromLocation?.type)}
          </span>
        </div>
      ),
    },
    {
      key: 'to',
      header: 'To',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-slate-800">{row.toLocation?.name || '—'}</span>
          <span className="text-xs text-slate-500">{locationTypeLabel(row.toLocation?.type)}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right',
      render: (row) => formatQuantity(row.quantity),
    },
    {
      key: 'state',
      header: 'State',
      render: (row) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${stateTone(row.state)}`}
        >
          {stateLabel(row.state)}
        </span>
      ),
    },
    {
      key: 'doneDate',
      header: 'Done at',
      render: (row) => formatDateTime(row.doneDate || row.updatedAt),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Move history"
        description="The immutable ledger of every stock mutation."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="moves-search"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Search
            </label>
            <input
              id="moves-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Reference, SKU or name"
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
            label="Type"
            name="documentType"
            value={documentType}
            onChange={(event) => {
              setDocumentType(event.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'RECEIPT', label: 'Receipt' },
              { value: 'DELIVERY', label: 'Delivery' },
              { value: 'INTERNAL', label: 'Internal' },
              { value: 'ADJUSTMENT', label: 'Adjustment' },
            ]}
          />

          <Select
            label="State"
            name="state"
            value={state}
            onChange={(event) => {
              setState(event.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'DRAFT', label: 'Draft' },
              { value: 'WAITING', label: 'Waiting' },
              { value: 'READY', label: 'Ready' },
              { value: 'DONE', label: 'Done' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />

          {isFetching && !isLoading && (
            <span className="pb-2 text-xs text-slate-400">Updating…</span>
          )}
        </div>

        {!mayRead ? (
          <EmptyState
            title="Access restricted"
            description="You do not have permission to view move history."
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
                  title="No moves yet"
                  description="Stock movements appear here once they are completed."
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
