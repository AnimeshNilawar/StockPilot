import { useState } from 'react';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { ActiveBadge, DataTable } from '../components/DataTable';
import { Button, Checkbox, Modal, TextInput } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import { api, catalogKeys, useApiMutation, useListQuery } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { errorMessage, fieldErrors } from '../lib/format';
import { useToast } from '../components/Toast';

export function UomsPage() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const mayWrite = can.writeUoms(user);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const debouncedSearch = useDebounced(search);
  const params = { page, pageSize, search: debouncedSearch };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    catalogKeys.uoms,
    '/uoms',
    params,
  );

  const save = useApiMutation({
    mutationFn: ({ id, body }) => (id ? api.uoms.update(id, body) : api.uoms.create(body)),
    invalidates: [catalogKeys.uoms, ['uom-options'], catalogKeys.products],
    onSuccess: (_data, variables) => {
      success(variables.id ? 'Unit updated' : 'Unit created');
      setEditing(null);
    },
    onError: (mutationError) => toastError(errorMessage(mutationError)),
  });

  const remove = useApiMutation({
    mutationFn: (id) => api.uoms.remove(id),
    invalidates: [catalogKeys.uoms, ['uom-options'], catalogKeys.products],
    onSuccess: () => {
      success('Unit deleted');
      setDeleting(null);
    },
    onError: (mutationError) => toastError(errorMessage(mutationError)),
  });

  const columns = [
    {
      key: 'code',
      header: 'Code',
      render: (row) => <span className="font-mono font-medium text-slate-800">{row.code}</span>,
    },
    { key: 'name', header: 'Name' },
    {
      key: '_count',
      header: 'Products',
      align: 'right',
      render: (row) => row._count?.products ?? 0,
    },
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
        title="Units of measure"
        description="Short codes for the units products are counted in. A unit in use by a product cannot be deleted."
        actions={mayWrite && <Button onClick={() => setEditing({})}>New unit</Button>}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="uom-search"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Search
            </label>
            <input
              id="uom-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Code or name"
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
                  title="No units yet"
                  description="Every product needs a unit before it can hold stock."
                  action={
                    mayWrite && (
                      <Button onClick={() => setEditing({})}>Create the first unit</Button>
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

      <UomFormModal
        uom={editing}
        onClose={() => setEditing(null)}
        onSubmit={(body) => save.mutate({ id: editing?.id, body })}
        busy={save.isPending}
        error={save.error}
      />

      <Modal
        open={!!deleting}
        title="Delete unit"
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
          Delete <span className="font-mono font-semibold text-slate-800">{deleting?.code}</span>?
          If any product still uses this unit the request is rejected.
        </p>
      </Modal>
    </AppShell>
  );
}

function UomFormModal({ uom, onClose, onSubmit, busy, error }) {
  const [form, setForm] = useState({ code: '', name: '', isActive: true });
  const [seeded, setSeeded] = useState(null);

  if (uom && uom !== seeded) {
    setSeeded(uom);
    setForm({ code: uom.code || '', name: uom.name || '', isActive: uom.isActive ?? true });
  }

  if (!uom) return null;

  const errors = fieldErrors(error);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSubmit({
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      isActive: form.isActive,
    });
  };

  return (
    <Modal
      open
      title={uom.id ? `Edit ${uom.code}` : 'New unit'}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} busy={busy}>
            {uom.id ? 'Save changes' : 'Create unit'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <TextInput
          label="Code"
          name="code"
          required
          value={form.code}
          onChange={(event) => update('code', event.target.value)}
          error={errors.code}
          hint="Unique, up to 8 characters, stored uppercase."
          placeholder="KG"
        />
        <TextInput
          label="Name"
          name="name"
          required
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          error={errors.name}
          placeholder="Kilogram"
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
