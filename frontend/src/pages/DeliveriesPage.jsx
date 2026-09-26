import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { AppShell, PageHeader, Card } from '../components/AppShell';
import { DataTable, Badge } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { useToast } from '../components/Toast';

export function DeliveriesPage() {
  const { user } = useAuth();
  const [deliveries, setDeliveries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');

  // Creation modal state
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState([
    { id: crypto.randomUUID(), productId: '', quantity: '', sourceLocationId: '' },
  ]);

  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [partners, setPartners] = useState([]);

  const toast = useToast();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchDeliveries = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page, pageSize });
      if (debouncedSearch) query.append('search', debouncedSearch);
      if (statusFilter) query.append('state', statusFilter);
      if (warehouseFilter) query.append('warehouseId', warehouseFilter);

      const res = await api.get(`/deliveries?${query.toString()}`);
      setDeliveries(res.data.items);
      setTotal(res.data.pagination.total);
    } catch {
      toast.error('Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
  }, [page, debouncedSearch, statusFilter, warehouseFilter]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, warehouseFilter]);

  useEffect(() => {
    api.get('/warehouses').then((res) => setWarehouses(res.data.items || []));
  }, []);

  useEffect(() => {
    if (showCreate) {
      api.get('/products').then((res) => setProducts(res.data.items || []));
      // A delivery ships *to* someone, so only partners allowed to buy appear.
      // The endpoint widens CUSTOMER to include BOTH.
      api.get('/partners/options?type=CUSTOMER').then((res) => setPartners(res.data || []));
    }
  }, [showCreate]);

  useEffect(() => {
    if (warehouseId) {
      api.get(`/warehouses/${warehouseId}/locations?pageSize=200`).then((res) => {
        // Stock only ever leaves a location that holds a balance, so the boundary
        // nodes are excluded here as well as on the server.
        setLocations(
          res.data.items.filter((loc) => loc.type !== 'VENDOR' && loc.type !== 'CUSTOMER'),
        );
      });
    } else {
      setLocations([]);
    }
  }, [warehouseId]);

  const handleWarehouseChange = (e) => {
    setWarehouseId(e.target.value);
    setLines(lines.map((l) => ({ ...l, sourceLocationId: '' })));
  };

  const addLine = () => {
    setLines([
      ...lines,
      { id: crypto.randomUUID(), productId: '', quantity: '', sourceLocationId: '' },
    ]);
  };

  const removeLine = (lineId) => {
    setLines(lines.filter((l) => l.id !== lineId));
  };

  const updateLine = (lineId, field, value) => {
    setLines(lines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (lines.length === 0) {
      toast.error('Please add at least one line');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/deliveries', {
        partnerId,
        warehouseId,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          sourceLocationId: l.sourceLocationId,
        })),
      });
      toast.success('Draft delivery created');
      setShowCreate(false);
      setPartnerId('');
      setWarehouseId('');
      setLines([{ id: crypto.randomUUID(), productId: '', quantity: '', sourceLocationId: '' }]);
      navigate(`/deliveries/${res.data.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => (
        <Link to={`/deliveries/${row.id}`} className="font-medium text-blue-600 hover:underline">
          {row.reference}
        </Link>
      ),
    },
    { key: 'partner', header: 'Customer', render: (row) => row.partner?.name || '-' },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouse.name },
    {
      key: 'lines',
      header: 'Lines',
      render: (row) => row.lines.length,
    },
    {
      key: 'state',
      header: 'Status',
      render: (row) => {
        let color = 'bg-slate-100 text-slate-700';
        if (row.state === 'DONE') color = 'bg-green-100 text-green-700';
        else if (row.state === 'CANCELLED') color = 'bg-red-100 text-red-700';
        else if (row.state === 'WAITING' || row.state === 'READY')
          color = 'bg-yellow-100 text-yellow-700';
        else if (row.state === 'DRAFT') color = 'bg-blue-100 text-blue-700';

        return <Badge className={color}>{row.state}</Badge>;
      },
    },
    {
      key: 'createdAt',
      header: 'Created At',
      render: (row) => new Date(row.createdAt).toLocaleString(),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Deliveries"
        description="Manage outgoing goods to customers. Stock is reserved when a delivery is picked."
        actions={
          can.createDelivery(user) && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              New Delivery
            </button>
          )
        }
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <input
            type="text"
            placeholder="Search by reference or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">DRAFT</option>
            <option value="WAITING">WAITING</option>
            <option value="READY">READY</option>
            <option value="DONE">DONE</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading...</div>
        ) : (
          <DataTable
            columns={columns}
            rows={deliveries}
            getRowKey={(row) => row.id}
            empty={<p className="py-12 text-center text-sm text-slate-500">No deliveries found.</p>}
          />
        )}
        {total > 0 && (
          <div className="border-t border-slate-200 px-4 py-3 sm:px-6">
            <Pagination
              currentPage={page}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        )}
      </Card>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-xl font-bold">New Draft Delivery</h2>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Customer</label>
                <select
                  required
                  value={partnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select a customer...</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Warehouse</label>
                <select
                  required
                  value={warehouseId}
                  onChange={handleWarehouseChange}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select a warehouse...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-700">Lines</label>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    + Add Line
                  </button>
                </div>

                {lines.length === 0 && (
                  <p className="text-sm text-slate-500 py-4 text-center border rounded-lg border-dashed">
                    No lines added.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  {lines.map((line) => (
                    <div
                      key={line.id}
                      className="flex gap-2 items-start border p-3 rounded-lg bg-slate-50"
                    >
                      <div className="flex-1">
                        <select
                          required
                          value={line.productId}
                          onChange={(e) => updateLine(line.id, 'productId', e.target.value)}
                          className="w-full text-sm rounded border-slate-300 py-1"
                        >
                          <option value="">Select product...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.sku})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-24">
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                          placeholder="Qty"
                          className="w-full text-sm rounded border-slate-300 py-1"
                        />
                      </div>
                      <div className="flex-1">
                        <select
                          required
                          value={line.sourceLocationId}
                          onChange={(e) => updateLine(line.id, 'sourceLocationId', e.target.value)}
                          className="w-full text-sm rounded border-slate-300 py-1"
                        >
                          <option value="">Ship from...</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="text-red-500 hover:text-red-700 px-2 py-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
