import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { ActiveBadge, Badge, DataTable } from '../components/DataTable';
import { Button, Checkbox, Modal, Select, TextInput } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import {
  api,
  catalogKeys,
  useApiMutation,
  useDetailQuery,
  useListQuery,
  useOptionsQuery,
} from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { errorMessage, fieldErrors, locationTypeLabel } from '../lib/format';
import { useToast } from '../components/Toast';

const TYPE_OPTIONS = ['INTERNAL', 'PRODUCTION', 'SCRAP', 'TRANSIT', 'VENDOR', 'CUSTOMER'].map(
  (type) => ({
    value: type,
    label: `${locationTypeLabel(type)} (${type})`,
  }),
);

export function LocationsPage() {
  const { warehouseId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const mayWrite = can.writeLocations(user);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const debouncedSearch = useDebounced(search);

  // Without a warehouse in the URL the screen lists every location the caller can
  // see; with one it is scoped to that warehouse's tree.
  const params = { page, pageSize, search: debouncedSearch, type };
  const path = warehouseId ? `/warehouses/${warehouseId}/locations` : '/locations';
  const key = warehouseId ? catalogKeys.locationsFor(warehouseId) : catalogKeys.locations;

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    [...key, 'filtered'],
    path,
    params,
  );
  const warehouse = useDetailQuery(['warehouse', warehouseId], `/warehouses/${warehouseId}`, {
    enabled: !!warehouseId,
  });
  const warehouses = useOptionsQuery(['warehouse-options'], '/warehouses/options');

  const warehouseOptions = (warehouses.data || []).map((row) => ({
    value: row.id,
    label: `${row.name} (${row.shortCode})`,
  }));
  const warehouseName = warehouse.data?.name || (warehouseId ? '…' : 'All warehouses');

  const save = useApiMutation({
    mutationFn: ({ id, body }) =>
      id ? api.locations.update(id, body) : api.locations.create(body),
    invalidates: [
      catalogKeys.locations,
      catalogKeys.warehouses,
      ['location-options'],
      catalogKeys.stock,
    ],
    onSuccess: (_data, variables) => {
      success(variables.id ? 'Location updated' : 'Location created');
      setEditing(null);
    },
    onError: (mutationError) => toastError(errorMessage(mutationError)),
  });

  const remove = useApiMutation({
    mutationFn: (id) => api.locations.remove(id),
    invalidates: [
      catalogKeys.locations,
      catalogKeys.warehouses,
      ['location-options'],
      catalogKeys.stock,
    ],
    onSuccess: () => {
      success('Location deleted');
      setDeleting(null);
    },
    onError: (mutationError) => toastError(errorMessage(mutationError)),
  });

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span className="font-medium text-slate-800">{row.name}</span>,
    },
    {
      key: 'shortCode',
      header: 'Code',
      render: (row) => <span className="font-mono text-slate-600">{row.shortCode}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <Badge
          className={
            ['VENDOR', 'CUSTOMER'].includes(row.type)
              ? 'bg-amber-100 text-amber-800'
              : 'bg-sky-100 text-sky-800'
          }
        >
          {locationTypeLabel(row.type)}
        </Badge>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouse?.name || '—' },
    { key: 'parent', header: 'Parent', render: (row) => row.parent?.name || '—' },
    { key: 'isActive', header: 'Status', render: (row) => <ActiveBadge isActive={row.isActive} /> },
    ...(mayWrite
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(row)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <AppShell>
      <PageHeader
        title={warehouseId ? `Locations · ${warehouseName}` : 'Locations'}
        description="Internal, production, scrap and transit locations hold balances. Vendor and customer locations are boundaries: goods pass through them without ever being stored."
        actions={
          <>
            {warehouseId && (
              <Button variant="secondary" onClick={() => navigate('/warehouses')}>
                All warehouses
              </Button>
            )}
            {mayWrite && (
              <Button
                onClick={() =>
                  setEditing({
                    warehouseId: warehouseId || warehouseOptions[0]?.value || '',
                    type: 'INTERNAL',
                    isActive: true,
                  })
                }
              >
                New location
              </Button>
            )}
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="location-search"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Search
            </label>
            <input
              id="location-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name or code"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="min-w-48">
            <label
              htmlFor="location-type"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Type
            </label>
            <select
              id="location-type"
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">All types</option>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {isFetching && !isLoading && (
            <span className="pb-2 text-xs text-slate-400">Updating…</span>
          )}
        </div>

        {isLoading ? (
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
                  title="No locations here"
                  description="Add a stock-holding location to start receiving goods."
                  action={
                    mayWrite && (
                      <Button
                        onClick={() =>
                          setEditing({
                            warehouseId: warehouseId || warehouseOptions[0]?.value || '',
                            type: 'INTERNAL',
                            isActive: true,
                          })
                        }
                      >
                        Create the first location
                      </Button>
                    )
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

      <LocationFormModal
        location={editing}
        lockWarehouse={!!warehouseId}
        lockType={!!editing?.id}
        warehouseOptions={warehouseOptions}
        onClose={() => setEditing(null)}
        onSubmit={(body) => save.mutate({ id: editing?.id, body })}
        busy={save.isPending}
        error={save.error}
      />

      <Modal
        open={!!deleting}
        title="Delete location"
        onClose={() => setDeleting(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={remove.isPending}
              onClick={() => remove.mutate(deleting.id)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Delete <span className="font-semibold text-slate-800">{deleting?.name}</span>? A location
          with stock movements, children or a balance is rejected — deactivate it instead so its
          ledger stays readable.
        </p>
      </Modal>
    </AppShell>
  );
}

function LocationFormModal({
  location,
  lockWarehouse,
  lockType,
  warehouseOptions,
  onClose,
  onSubmit,
  busy,
  error,
}) {
  const [form, setForm] = useState({
    warehouseId: '',
    name: '',
    shortCode: '',
    type: 'INTERNAL',
    parentId: '',
    isActive: true,
  });
  const [seeded, setSeeded] = useState(null);

  if (location && location !== seeded) {
    setSeeded(location);
    setForm({
      warehouseId: location.warehouseId || warehouseOptions[0]?.value || '',
      name: location.name || '',
      shortCode: location.shortCode || '',
      type: location.type || 'INTERNAL',
      parentId: location.parentId || '',
      isActive: location.isActive ?? true,
    });
  }

  if (!location) return null;

  const errors = fieldErrors(error);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = (event) => {
    event.preventDefault();
    const body = {
      name: form.name.trim(),
      shortCode: form.shortCode.trim().toUpperCase(),
      type: form.type,
      parentId: form.parentId || null,
      isActive: form.isActive,
    };
    // The warehouse and the type are immutable once a location exists: moving a
    // location between warehouses would silently rewrite historical balances.
    if (!location.id) body.warehouseId = form.warehouseId;
    onSubmit(body);
  };

  return (
    <Modal
      open
      title={location.id ? `Edit ${location.name}` : 'New location'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} busy={busy}>
            {location.id ? 'Save changes' : 'Create location'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Warehouse"
          name="warehouseId"
          required
          value={form.warehouseId}
          onChange={(event) => update('warehouseId', event.target.value)}
          options={warehouseOptions}
          placeholder="Choose a warehouse"
          disabled={lockWarehouse}
          error={errors.warehouseId}
        />
        <TextInput
          label="Name"
          name="name"
          required
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          error={errors.name}
          placeholder="Main Store"
        />

        <TextInput
          label="Short code"
          name="shortCode"
          required
          value={form.shortCode}
          onChange={(event) => update('shortCode', event.target.value)}
          error={errors.shortCode}
          hint="Unique within the warehouse."
          placeholder="STORE"
        />
        <Select
          label="Type"
          name="type"
          value={form.type}
          onChange={(event) => update('type', event.target.value)}
          options={TYPE_OPTIONS}
          disabled={lockType}
          error={errors.type}
          hint={
            lockType
              ? "A location's type is fixed once it exists."
              : 'Decides whether this location can hold stock.'
          }
        />

        <div className="sm:col-span-2">
          <Checkbox
            label="Active"
            name="isActive"
            checked={form.isActive}
            onChange={(event) => update('isActive', event.target.checked)}
            hint="An inactive location cannot take part in new movements."
          />
        </div>

        {error && !Object.keys(errors).length && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">
            {error.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
