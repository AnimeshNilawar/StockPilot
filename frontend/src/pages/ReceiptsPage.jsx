import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { AppShell, PageHeader, Card } from '../components/AppShell';
import { DataTable, Badge } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { useToast } from '../components/Toast';

export function ReceiptsPage() {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  
  // Creation modal state
  const [showCreate, setShowCreate] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  
  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  
  const { addToast } = useToast();

  const fetchReceipts = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/receipts?page=${page}&pageSize=${pageSize}`);
      setReceipts(res.data.items);
      setTotal(res.data.pagination.total);
    } catch (err) {
      addToast('Failed to load receipts', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, [page]);

  useEffect(() => {
    if (showCreate) {
      api.get('/warehouses').then(res => setWarehouses(res.data.items || []));
      api.get('/products').then(res => setProducts(res.data.items || []));
    }
  }, [showCreate]);

  useEffect(() => {
    if (warehouseId) {
      api.get(`/locations?warehouseId=${warehouseId}`).then(res => {
        // Only allow internal/holding locations for receipt destination
        setLocations(res.data.items.filter(loc => loc.type !== 'VENDOR' && loc.type !== 'CUSTOMER'));
      });
    } else {
      setLocations([]);
    }
  }, [warehouseId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/receipts', {
        supplier,
        warehouseId,
        lines: [
          {
            productId,
            quantity,
            destinationLocationId
          }
        ]
      });
      addToast('Draft receipt created', 'success');
      setShowCreate(false);
      setSupplier('');
      setWarehouseId('');
      setProductId('');
      setQuantity('');
      setDestinationLocationId('');
      fetchReceipts();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const columns = [
    { 
      key: 'reference',
      header: 'Reference', 
      render: (row) => (
        <Link to={`/receipts/${row.id}`} className="font-medium text-blue-600 hover:underline">
          {row.reference}
        </Link>
      ),
    },
    { key: 'supplier', header: 'Supplier' },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouse.name },
    {
      key: 'state',
      header: 'Status',
      render: (row) => (
        <Badge
          className={row.state === 'DONE' ? 'bg-green-100 text-green-700' : row.state === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}
        >
          {row.state}
        </Badge>
      ),
    },
    { key: 'createdAt', header: 'Created At', render: (row) => new Date(row.createdAt).toLocaleString() },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Receipts"
        description="Manage incoming goods from vendors."
        actions={
          can.createReceipt(user) && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              New Receipt
            </button>
          )
        }
      />

      <Card>
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading...</div>
        ) : (
          <DataTable
            columns={columns}
            rows={receipts}
            getRowKey={(row) => row.id}
            empty={<p className="py-12 text-center text-sm text-slate-500">No receipts found.</p>}
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
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold">New Draft Receipt</h2>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Supplier</label>
                <input
                  required
                  type="text"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Warehouse</label>
                <select
                  required
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select a warehouse...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Product</label>
                <select
                  required
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select a product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Quantity</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Destination Location</label>
                <select
                  required
                  value={destinationLocationId}
                  onChange={(e) => setDestinationLocationId(e.target.value)}
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select a location...</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
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
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
