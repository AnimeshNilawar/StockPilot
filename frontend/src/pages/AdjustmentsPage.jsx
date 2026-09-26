import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { AppShell, PageHeader, Card } from '../components/AppShell';
import { DataTable, Badge } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { useToast } from '../components/Toast';
import { formatDateTime, formatQuantity } from '../lib/format';

export function AdjustmentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [adjustments, setAdjustments] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');

  // Create Modal
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState([
    {
      id: crypto.randomUUID(),
      productId: '',
      locationId: '',
      systemQuantity: '0',
      countedQuantity: '',
      fetchingSystem: false,
    },
  ]);

  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchAdjustments = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page, pageSize });
      if (debouncedSearch) query.append('search', debouncedSearch);
      if (statusFilter) query.append('state', statusFilter);
      if (warehouseFilter) query.append('warehouseId', warehouseFilter);

      const res = await api.get(`/adjustments?${query.toString()}`);
      setAdjustments(res.data.items || []);
      setTotal(res.data.pagination?.total || 0);
    } catch {
      toast.error('Failed to load adjustments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdjustments();
  }, [page, debouncedSearch, statusFilter, warehouseFilter]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, warehouseFilter]);

  useEffect(() => {
    api.get('/warehouses').then((res) => setWarehouses(res.data.items || []));
  }, []);

  useEffect(() => {
    if (showCreate) {
      api.get('/products').then((res) => setProducts(res.data.items || []));
    }
  }, [showCreate]);

  useEffect(() => {
    if (warehouseId) {
      api.get(`/warehouses/${warehouseId}/locations?pageSize=200`).then((res) => {
        setLocations((res.data.items || []).filter((loc) => loc.type === 'INTERNAL'));
      });
    } else {
      setLocations([]);
    }
  }, [warehouseId]);

  const handleWarehouseChange = (e) => {
    setWarehouseId(e.target.value);
    setLines(
      lines.map((l) => ({
        ...l,
        locationId: '',
        systemQuantity: '0',
        countedQuantity: '',
      }))
    );
  };

  const addLine = () => {
    setLines([
      ...lines,
      {
        id: crypto.randomUUID(),
        productId: '',
        locationId: '',
        systemQuantity: '0',
        countedQuantity: '',
        fetchingSystem: false,
      },
    ]);
  };

  const removeLine = (lineId) => {
    setLines(lines.filter((l) => l.id !== lineId));
  };

  const updateLine = (lineId, field, value) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const updated = { ...l, [field]: value };
        return updated;
      })
    );
  };

  // Helper to fetch live stock for pre-filling system quantity in the UI
  const fetchLiveStock = async (lineId, pId, lId) => {
    if (!warehouseId || !pId || !lId) return;
    updateLine(lineId, 'fetchingSystem', true);
    try {
      const res = await api.get(
        `/stock/quants?warehouseId=${warehouseId}&productId=${pId}&locationId=${lId}`
      );
      const quant = (res.data?.items || res.data || [])[0];
      const onHand = quant ? String(quant.onHand) : '0';
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, systemQuantity: onHand, fetchingSystem: false } : l))
      );
    } catch {
      updateLine(lineId, 'fetchingSystem', false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (lines.length === 0) {
      toast.error('Please add at least one adjustment line');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/adjustments', {
        warehouseId,
        lines: lines.map((l) => ({
          productId: l.productId,
          locationId: l.locationId,
          countedQuantity: l.countedQuantity,
        })),
      });
      toast.success('Inventory adjustment recorded');
      setShowCreate(false);
      setWarehouseId('');
      setLines([
        {
          id: crypto.randomUUID(),
          productId: '',
          locationId: '',
          systemQuantity: '0',
          countedQuantity: '',
          fetchingSystem: false,
        },
      ]);
      navigate(`/adjustments/${res.data.id}`);
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
        <Link to={`/adjustments/${row.id}`} className="font-medium text-blue-600 hover:underline">
          {row.reference}
        </Link>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouse?.name || '-' },
    {
      key: 'lines',
      header: 'Lines',
      render: (row) => row.lines?.length || 0,
    },
    {
      key: 'state',
      header: 'Status',
      render: (row) => {
        let color = 'bg-slate-100 text-slate-700';
        if (row.state === 'DONE') color = 'bg-green-100 text-green-700';
        else if (row.state === 'CANCELLED') color = 'bg-red-100 text-red-700';
        else if (row.state === 'READY') color = 'bg-yellow-100 text-yellow-700';
        else if (row.state === 'DRAFT') color = 'bg-blue-100 text-blue-700';

        return <Badge className={color}>{row.state}</Badge>;
      },
    },
    {
      key: 'createdBy',
      header: 'Created By',
      render: (row) => row.creator?.name || row.creator?.email || '-',
    },
    {
      key: 'createdAt',
      header: 'Created At',
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Inventory Adjustments"
        description="Physical stock counts and inventory reconciliations. Reconcile system balances to actual physical counts."
        actions={
          can.createAdjustment(user) && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              New Stock Count
            </button>
          )
        }
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <input
            type="text"
            placeholder="Search by reference..."
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
            rows={adjustments}
            getRowKey={(row) => row.id}
            empty={<p className="py-12 text-center text-sm text-slate-500">No adjustments found.</p>}
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
          <div className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-xl font-bold">New Physical Stock Count</h2>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
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
                  <label className="block text-sm font-medium text-slate-700">Count Lines</label>
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

                <div className="flex flex-col gap-3">
                  {lines.map((line) => {
                    const sys = parseFloat(line.systemQuantity || '0');
                    const counted = parseFloat(line.countedQuantity || '0');
                    const diff = isNaN(counted) ? 0 : counted - sys;
                    return (
                      <div
                        key={line.id}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center border p-3 rounded-lg bg-slate-50"
                      >
                        <div className="sm:col-span-4">
                          <label className="block text-xs text-slate-500 mb-1">Product</label>
                          <select
                            required
                            value={line.productId}
                            onChange={(e) => {
                              const pId = e.target.value;
                              updateLine(line.id, 'productId', pId);
                              fetchLiveStock(line.id, pId, line.locationId);
                            }}
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
                        <div className="sm:col-span-3">
                          <label className="block text-xs text-slate-500 mb-1">Location</label>
                          <select
                            required
                            value={line.locationId}
                            onChange={(e) => {
                              const lId = e.target.value;
                              updateLine(line.id, 'locationId', lId);
                              fetchLiveStock(line.id, line.productId, lId);
                            }}
                            className="w-full text-sm rounded border-slate-300 py-1"
                          >
                            <option value="">Select location...</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-slate-500 mb-1">System Qty</label>
                          <div className="py-1 px-2 text-sm bg-slate-200 rounded text-slate-700 font-semibold text-right">
                            {line.fetchingSystem ? '...' : formatQuantity(line.systemQuantity)}
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-slate-500 mb-1">Counted Qty</label>
                          <input
                            required
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.countedQuantity}
                            onChange={(e) => updateLine(line.id, 'countedQuantity', e.target.value)}
                            placeholder="Counted"
                            className="w-full text-sm rounded border-slate-300 py-1 text-right font-semibold"
                          />
                        </div>
                        <div className="sm:col-span-1 flex items-end justify-between">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="text-red-500 hover:text-red-700 px-2 py-1 text-lg"
                          >
                            ×
                          </button>
                        </div>
                        {line.countedQuantity !== '' && (
                          <div className="sm:col-span-12 text-xs flex justify-end gap-2 pt-1 border-t border-slate-200">
                            <span className="text-slate-500">Difference:</span>
                            <span
                              className={`font-bold ${
                                diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-rose-600' : 'text-slate-600'
                              }`}
                            >
                              {diff > 0 ? `+${formatQuantity(diff)} (Surplus)` : diff < 0 ? `${formatQuantity(diff)} (Shortage)` : '0.00 (Match)'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                  {submitting ? 'Recording...' : 'Create Count'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
