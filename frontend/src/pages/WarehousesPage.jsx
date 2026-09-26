import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { ActiveBadge, DataTable } from '../components/DataTable';
import { Button, Checkbox, Modal, TextInput, fieldErrors } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import { api, catalogKeys, useApiMutation, useListQuery } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { errorMessage } from '../lib/format';
import { useToast } from '../components/Toast';

export function WarehousesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const mayWrite = can.writeWarehouses(user);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const debouncedSearch = useDebounced(search);
  const params = { page, pageSize, search: debouncedSearch };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    catalogKeys.warehouses,
    '/warehouses',
    params,
  );

  const save = useApiMutation({
    mutationFn: ({ id, body }) =>
      id ? api.warehouses.update(id, body) : api.warehouses.create(body),
    invalidates: [catalogKeys.warehouses, ['warehouse-options'], catalogKeys.locations],
    onSuccess: (_data, variables) => {
      success(variables.id ? 'Warehouse updated' : 'Warehouse created');
      setEditing(null);
    },
    onError: (mutationError) => toastError(errorMessage(mutationError)),
  });

  const remove = useApiMutation({
    mutationFn: (id) => api.warehouses.remove(id),
    invalidates: [catalogKeys.warehouses, ['warehouse-options'], catalogKeys.locations],
    onSuccess: () => {
      success('Warehouse deleted');
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
    { key: 'address', header: 'Address', render: (row) => row.address || '—' },
    {
      key: '_count',
      header: 'Locations',
      align: 'right',
      render: (row) => row._count?.locations ?? 0,
    },
    { key: 'isActive', header: 'Status', render: (row) => <ActiveBadge isActive={row.isActive} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate(`/warehouses/${row.id}/locations`)}>
            Locations
          </Button>
          {mayWrite && (
            <>
              <Button variant="ghost" onClick={() => setEditing(row)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(row)}>
                Delete
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Warehouses"
        description="Each warehouse owns its own locations. Stock never moves directly between warehouses."
        actions={mayWrite && <Button onClick={() => setEditing({})}>New warehouse</Button>}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="warehouse-search"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Search
            </label>
            <input
              id="warehouse-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name or code"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
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
                  title="No warehouses yet"
                  description="Stock balances live inside a warehouse, so at least one is needed before any movement."
                  action={
                    mayWrite && (
                      <Button onClick={() => setEditing({})}>Create the first warehouse</Button>
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

      <WarehouseFormModal
        warehouse={editing}
        onClose={() => setEditing(null)}
        onSubmit={(body) => save.mutate({ id: editing?.id, body })}
        busy={save.isPending}
        error={save.error}
      />

      <Modal
        open={!!deleting}
        title="Delete warehouse"
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
          Delete <span className="font-semibold text-slate-800">{deleting?.name}</span>? A warehouse
          that still has locations or stock is rejected — deactivate it instead so its history stays
          intact.
        </p>
      </Modal>
    </AppShell>
  );
}

function WarehouseFormModal({ warehouse, onClose, onSubmit, busy, error }) {
  const [form, setForm] = useState({ name: '', shortCode: '', address: '', isActive: true });
  const [seeded, setSeeded] = useState(null);

  if (warehouse && warehouse !== seeded) {
    setSeeded(warehouse);
    setForm({
      name: warehouse.name || '',
      shortCode: warehouse.shortCode || '',
      address: warehouse.address || '',
      isActive: warehouse.isActive ?? true,
    });
  }

  if (!warehouse) return null;

  const errors = fieldErrors(error);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSubmit({
      name: form.name.trim(),
      shortCode: form.shortCode.trim().toUpperCase(),
      address: form.address.trim() || null,
      isActive: form.isActive,
    });
  };

  return (
    <Modal
      open
      title={warehouse.id ? `Edit ${warehouse.name}` : 'New warehouse'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} busy={busy}>
            {warehouse.id ? 'Save changes' : 'Create warehouse'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <TextInput
          label="Name"
          name="name"
          required
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          error={errors.name}
          placeholder="Main Warehouse"
        />
        <TextInput
          label="Short code"
          name="shortCode"
          required
          value={form.shortCode}
          onChange={(event) => update('shortCode', event.target.value)}
          error={errors.shortCode}
          hint="Unique, up to 12 characters, stored uppercase."
          placeholder="MAIN"
        />
        <TextInput
          label="Address"
          name="address"
          value={form.address}
          onChange={(event) => update('address', event.target.value)}
          error={errors.address}
          placeholder="Plot 14, Industrial Estate"
        />
        <Checkbox
          label="Active"
          name="isActive"
          checked={form.isActive}
          onChange={(event) => update('isActive', event.target.checked)}
        />
        {error && !Object.keys(errors).length && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error.message}</p>
        )}
      </form>
    </Modal>
  );
}
