import { useState } from 'react';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { ActiveBadge, DataTable } from '../components/DataTable';
import { Button, Modal, Select, TextArea, TextInput } from '../components/ui';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import { api, catalogKeys, useApiMutation, useListQuery, useOptionsQuery } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { errorMessage, fieldErrors, formatMoney, formatQuantity } from '../lib/format';
import { useToast } from '../components/Toast';

const EMPTY_FORM = {
  sku: '',
  name: '',
  description: '',
  categoryId: '',
  uomId: '',
  costPrice: '',
  reorderMin: '',
  reorderMax: '',
  isActive: true,
};

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export function ProductsPage() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const mayWrite = can.writeProducts(user);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const debouncedSearch = useDebounced(search);

  const params = {
    page,
    pageSize,
    search: debouncedSearch,
    categoryId,
    isActive: status,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    catalogKeys.products,
    '/products',
    params,
  );
  const categories = useOptionsQuery(catalogKeys.categoryTree, '/categories/tree');
  const uoms = useOptionsQuery(['uom-options'], '/uoms/options');

  // The category endpoint returns a tree; product forms need a flat list.
  const categoryOptions = flattenTree(categories.data || []).map((node) => ({
    value: node.id,
    label: node.label,
  }));
  const uomOptions = (uoms.data || []).map((uom) => ({
    value: uom.id,
    label: `${uom.code} — ${uom.name}`,
  }));

  const save = useApiMutation({
    mutationFn: ({ id, body }) => (id ? api.products.update(id, body) : api.products.create(body)),
    invalidates: [catalogKeys.products],
    onSuccess: (_data, variables) => {
      success(variables.id ? 'Product updated' : 'Product created');
      setEditing(null);
    },
    onError: (mutationError) => toastError(errorMessage(mutationError)),
  });

  const remove = useApiMutation({
    mutationFn: (id) => api.products.remove(id),
    invalidates: [catalogKeys.products],
    onSuccess: () => {
      success('Product deleted');
      setDeleting(null);
    },
    onError: (mutationError) => toastError(errorMessage(mutationError)),
  });

  const columns = [
    {
      key: 'sku',
      header: 'SKU',
      render: (row) => <span className="font-medium text-slate-800">{row.sku}</span>,
    },
    { key: 'name', header: 'Name' },
    { key: 'category', header: 'Category', render: (row) => row.category?.name || '—' },
    { key: 'uom', header: 'Unit', render: (row) => row.uom?.code || '—' },
    {
      key: 'costPrice',
      header: 'Cost',
      align: 'right',
      render: (row) => formatMoney(row.costPrice),
    },
    {
      key: 'reorderMin',
      header: 'Reorder min',
      align: 'right',
      render: (row) => formatQuantity(row.reorderMin),
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
        title="Products"
        description="The catalogue every stock movement is measured against."
        actions={
          mayWrite && <Button onClick={() => setEditing({ ...EMPTY_FORM })}>New product</Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="product-search"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Search
            </label>
            <input
              id="product-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="SKU or name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="min-w-44">
            <label
              htmlFor="product-category"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Category
            </label>
            <select
              id="product-category"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">All categories</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-32">
            <label
              htmlFor="product-status"
              className="mb-1 block text-xs font-medium text-slate-500 uppercase"
            >
              Status
            </label>
            <select
              id="product-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              {STATUS_OPTIONS.map((option) => (
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
              getRowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No products yet"
                  description="Products carry the SKU, unit of measure and reorder thresholds that stock movements are recorded against."
                  action={
                    mayWrite && (
                      <Button onClick={() => setEditing({ ...EMPTY_FORM })}>
                        Create the first product
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

      <ProductFormModal
        product={editing}
        onClose={() => setEditing(null)}
        onSubmit={(body) => save.mutate({ id: editing?.id, body })}
        busy={save.isPending}
        error={save.error}
        categoryOptions={categoryOptions}
        uomOptions={uomOptions}
      />

      <Modal
        open={!!deleting}
        title="Delete product"
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
          Delete <span className="font-semibold text-slate-800">{deleting?.sku}</span>? This is only
          possible while the product has no stock history; otherwise the record is kept and
          deactivated instead.
        </p>
      </Modal>
    </AppShell>
  );
}

function ProductFormModal({
  product,
  onClose,
  onSubmit,
  busy,
  error,
  categoryOptions,
  uomOptions,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [seeded, setSeeded] = useState(null);

  // Re-seed the form whenever a different product is opened.
  if (product && product !== seeded) {
    setSeeded(product);
    setForm({
      ...EMPTY_FORM,
      ...(product.id
        ? {
            sku: product.sku,
            name: product.name,
            description: product.description || '',
            categoryId: product.categoryId || '',
            uomId: product.uomId || '',
            costPrice: product.costPrice ?? '',
            reorderMin: product.reorderMin ?? '',
            reorderMax: product.reorderMax ?? '',
            isActive: product.isActive,
          }
        : {}),
    });
  }

  if (!product) return null;

  const errors = fieldErrors(error);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSubmit({
      sku: form.sku.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      categoryId: form.categoryId || null,
      uomId: form.uomId,
      costPrice: form.costPrice === '' ? null : String(form.costPrice),
      reorderMin: form.reorderMin === '' ? null : String(form.reorderMin),
      reorderMax: form.reorderMax === '' ? null : String(form.reorderMax),
      isActive: form.isActive,
    });
  };

  return (
    <Modal
      open
      title={product.id ? `Edit ${product.sku}` : 'New product'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} busy={busy}>
            {product.id ? 'Save changes' : 'Create product'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="SKU"
          name="sku"
          required
          value={form.sku}
          onChange={(event) => update('sku', event.target.value)}
          error={errors.sku}
          hint="Stored uppercase and unique across the catalogue."
          placeholder="STL-001"
        />
        <TextInput
          label="Name"
          name="name"
          required
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          error={errors.name}
          placeholder="Steel Rod"
        />

        <Select
          label="Unit of measure"
          name="uomId"
          required
          value={form.uomId}
          onChange={(event) => update('uomId', event.target.value)}
          options={uomOptions}
          placeholder="Choose a unit"
          error={errors.uomId}
          hint="Quantities for this product are counted in this unit."
        />

        <Select
          label="Category"
          name="categoryId"
          value={form.categoryId}
          onChange={(event) => update('categoryId', event.target.value)}
          options={categoryOptions}
          placeholder="Uncategorised"
          error={errors.categoryId}
        />

        <TextInput
          label="Standard cost"
          name="costPrice"
          value={form.costPrice}
          onChange={(event) => update('costPrice', event.target.value)}
          error={errors.costPrice}
          hint="Decimal, up to 2 places."
          inputMode="decimal"
          placeholder="120.50"
        />

        <TextInput
          label="Reorder minimum"
          name="reorderMin"
          value={form.reorderMin}
          onChange={(event) => update('reorderMin', event.target.value)}
          error={errors.reorderMin}
          hint="Balances at or below this flag as low stock."
          inputMode="decimal"
          placeholder="25"
        />

        <TextInput
          label="Reorder maximum"
          name="reorderMax"
          value={form.reorderMax}
          onChange={(event) => update('reorderMax', event.target.value)}
          error={errors.reorderMax}
          hint="Must be greater than the minimum."
          inputMode="decimal"
          placeholder="250"
        />

        <div className="sm:col-span-2">
          <TextArea
            label="Description"
            name="description"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            error={errors.description}
            rows={3}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => update('isActive', event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          Active
        </label>

        {error && !Object.keys(errors).length && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">
            {error.message}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Turns the category tree into `{ id, label }` rows, indented by depth. */
function flattenTree(nodes, depth = 0, acc = []) {
  nodes.forEach((node) => {
    acc.push({ id: node.id, label: `${'— '.repeat(depth)}${node.name}` });
    if (node.children?.length) flattenTree(node.children, depth + 1, acc);
  });
  return acc;
}
