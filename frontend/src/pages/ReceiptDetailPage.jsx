import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { AppShell, PageHeader, Card } from '../components/AppShell';
import { DataTable, Badge } from '../components/DataTable';
import { useToast } from '../components/Toast';

export function ReceiptDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  
  // Edit modal state
  const [showEdit, setShowEdit] = useState(false);
  const [editPartnerId, setEditPartnerId] = useState('');
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [editLines, setEditLines] = useState([]);
  
  const [warehouses, setWarehouses] = useState([]);
  const [partners, setPartners] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);

  const fetchReceipt = async () => {
    try {
      const res = await api.get(`/receipts/${id}`);
      setReceipt(res.data);
    } catch (err) {
      toast.error('Failed to load receipt');
      navigate('/receipts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipt();
  }, [id]);

  useEffect(() => {
    if (showEdit) {
      api.get('/warehouses').then(res => setWarehouses(res.data.items || []));
      api.get('/partners').then(res => setPartners(res.data || []));
      api.get('/products').then(res => setProducts(res.data.items || []));
      
      setEditPartnerId(receipt.partner.id);
      setEditWarehouseId(receipt.warehouse.id);
      setEditLines(receipt.lines.map(l => ({
        id: crypto.randomUUID(),
        productId: l.product.id,
        quantity: l.quantity,
        destinationLocationId: l.destinationLocation.id
      })));
    }
  }, [showEdit]);

  useEffect(() => {
    if (editWarehouseId) {
      api.get(`/warehouses/${editWarehouseId}/locations?pageSize=200`).then(res => {
        setLocations(res.data.items.filter(loc => loc.type !== 'VENDOR' && loc.type !== 'CUSTOMER'));
      });
    } else {
      setLocations([]);
    }
  }, [editWarehouseId]);

  const handleValidate = async () => {
    if (!window.confirm('Are you sure you want to validate this receipt? This will move stock into the warehouse and cannot be undone.')) return;
    setValidating(true);
    try {
      const key = crypto.randomUUID();
      await api.post(`/receipts/${id}/validate`, {}, { headers: { 'Idempotency-Key': key } });
      toast.success('Receipt validated successfully');
      fetchReceipt();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setValidating(false);
    }
  };

  const handleTransition = async (newState) => {
    try {
      await api.patch(`/receipts/${id}/status`, { state: newState });
      toast.success(`Receipt moved to ${newState}`);
      fetchReceipt();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel this receipt?')) return;
    try {
      await api.post(`/receipts/${id}/cancel`);
      toast.success('Receipt cancelled');
      fetchReceipt();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/receipts/${id}`, {
        partnerId: editPartnerId,
        warehouseId: editWarehouseId,
        lines: editLines.map(l => ({
          productId: l.productId,
          quantity: l.quantity,
          destinationLocationId: l.destinationLocationId
        }))
      });
      toast.success('Receipt updated');
      setShowEdit(false);
      fetchReceipt();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const addLine = () => {
    setEditLines([...editLines, { id: crypto.randomUUID(), productId: '', quantity: '', destinationLocationId: '' }]);
  };

  const handleWarehouseChange = (e) => {
    setEditWarehouseId(e.target.value);
    setEditLines(editLines.map(l => ({ ...l, destinationLocationId: '' })));
  };

  const removeLine = (lineId) => {
    setEditLines(editLines.filter(l => l.id !== lineId));
  };

  const updateLine = (lineId, field, value) => {
    setEditLines(editLines.map(l => l.id === lineId ? { ...l, [field]: value } : l));
  };

  if (loading) {
    return (
      <AppShell>
        <div className="py-12 text-center text-slate-500">Loading receipt...</div>
      </AppShell>
    );
  }

  if (!receipt) return null;

  const columns = [
    { key: 'product', header: 'Product', render: (row) => `${row.product.name} (${row.product.sku})` },
    { key: 'quantity', header: 'Quantity', render: (row) => `${Number(row.quantity)} ${row.product.uom.code}` },
    { key: 'destination', header: 'Destination', render: (row) => row.destinationLocation.name },
  ];

  return (
    <>
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }
        .receipt-print-document,
        .receipt-print-document * {
          visibility: visible;
        }
        .receipt-print-document {
          display: block !important;
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          margin: 0;
          padding: 0;
        }
        @page {
          size: A4;
          margin: 12mm;
        }
      }
    `}</style>
    <AppShell>
      <PageHeader
        title={receipt.reference}
        description={`Partner: ${receipt.partner?.name || '-'} • Warehouse: ${receipt.warehouse.name}`}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Print
            </button>
            {receipt.state === 'DRAFT' && can.editReceipt(user) && (
              <button
                onClick={() => setShowEdit(true)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Edit
              </button>
            )}
            {receipt.state === 'DRAFT' && can.editReceipt(user) && (
              <button
                onClick={() => handleTransition('WAITING')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Submit (Waiting)
              </button>
            )}
            {receipt.state === 'WAITING' && can.editReceipt(user) && (
              <button
                onClick={() => handleTransition('READY')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Mark Ready
              </button>
            )}
            {receipt.state === 'READY' && can.validateReceipt(user) && (
              <button
                onClick={handleValidate}
                disabled={validating}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {validating ? 'Validating...' : 'Validate Receipt'}
              </button>
            )}
            {['DRAFT', 'WAITING', 'READY'].includes(receipt.state) && can.editReceipt(user) && (
              <button
                onClick={handleCancel}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Cancel
              </button>
            )}
          </div>
        }
      />

      <Card className="mb-6 p-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-sm font-medium text-slate-500">Status</h3>
            <p className="mt-1">
              <Badge className={
                receipt.state === 'DONE' ? 'bg-green-100 text-green-700' : 
                receipt.state === 'CANCELLED' ? 'bg-red-100 text-red-700' : 
                ['WAITING', 'READY'].includes(receipt.state) ? 'bg-yellow-100 text-yellow-700' :
                'bg-blue-100 text-blue-700'
              }>
                {receipt.state}
              </Badge>
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-500">Created</h3>
            <p className="mt-1 text-sm text-slate-900">{new Date(receipt.createdAt).toLocaleString()}</p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-800">Receipt Lines</h2>
        </div>
        <DataTable
          columns={columns}
          rows={receipt.lines}
          getRowKey={(row) => row.id}
          empty={<p className="py-12 text-center text-sm text-slate-500">No lines found.</p>}
        />
      </Card>

      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-xl font-bold">Edit Draft Receipt</h2>
            <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Partner</label>
                  <select
                    required
                    value={editPartnerId}
                    onChange={(e) => setEditPartnerId(e.target.value)}
                    className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">Select a partner...</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Warehouse</label>
                  <select
                    required
                    value={editWarehouseId}
                    onChange={handleWarehouseChange}
                    className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">Select a warehouse...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-700">Lines</label>
                  <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:underline">
                    + Add Line
                  </button>
                </div>
                
                {editLines.length === 0 && (
                  <p className="text-sm text-slate-500 py-4 text-center border rounded-lg border-dashed">No lines added.</p>
                )}

                <div className="flex flex-col gap-2">
                  {editLines.map((line, index) => (
                    <div key={line.id} className="flex gap-2 items-start border p-3 rounded-lg bg-slate-50">
                      <div className="flex-1">
                        <select
                          required
                          value={line.productId}
                          onChange={(e) => updateLine(line.id, 'productId', e.target.value)}
                          className="w-full text-sm rounded border-slate-300 py-1"
                        >
                          <option value="">Select product...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
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
                          value={line.destinationLocationId}
                          onChange={(e) => updateLine(line.id, 'destinationLocationId', e.target.value)}
                          className="w-full text-sm rounded border-slate-300 py-1"
                        >
                          <option value="">Select location...</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
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
                  onClick={() => setShowEdit(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
    
    <div className="receipt-print-document hidden font-sans text-black bg-white">
      <div className="border-b-2 border-slate-900 pb-4 mb-8">
        <h1 className="text-3xl font-bold uppercase tracking-wider">StockPilot</h1>
        <h2 className="text-xl font-semibold text-slate-700 uppercase tracking-widest mt-1">Goods Receipt</h2>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">Receipt Information</h3>
        <table className="w-full max-w-lg text-sm">
          <tbody>
            <tr>
              <td className="py-1 font-semibold w-32">Receipt No.</td>
              <td className="py-1">{receipt.reference}</td>
            </tr>
            <tr>
              <td className="py-1 font-semibold w-32">Status</td>
              <td className="py-1">{receipt.state}</td>
            </tr>
            <tr>
              <td className="py-1 font-semibold w-32">Date</td>
              <td className="py-1">{new Date(receipt.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
            </tr>
            <tr>
              <td className="py-1 font-semibold w-32">Partner</td>
              <td className="py-1">{receipt.partner?.name || '-'}</td>
            </tr>
            <tr>
              <td className="py-1 font-semibold w-32">Warehouse</td>
              <td className="py-1">{receipt.warehouse.name}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">Receipt Lines</h3>
        <table className="w-full text-left border-collapse text-sm">
          <thead className="table-header-group">
            <tr className="border-b-2 border-slate-900">
              <th className="py-2 px-2 font-bold w-12">#</th>
              <th className="py-2 px-2 font-bold">Product</th>
              <th className="py-2 px-2 font-bold">SKU</th>
              <th className="py-2 px-2 font-bold text-right">Quantity</th>
              <th className="py-2 px-2 font-bold text-right">Destination</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-slate-300 break-inside-avoid">
                <td className="py-3 px-2">{i + 1}</td>
                <td className="py-3 px-2">{l.product.name}</td>
                <td className="py-3 px-2">{l.product.sku}</td>
                <td className="py-3 px-2 text-right">{Number(l.quantity)} {l.product.uom.code}</td>
                <td className="py-3 px-2 text-right">{l.destinationLocation.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-16">
        <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">Summary</h3>
        <p className="text-sm">Total Lines: {receipt.lines.length}</p>
      </div>

      <div className="flex justify-between border-t border-slate-900 pt-16 break-inside-avoid">
        <div className="w-64">
          <p className="mb-8 font-semibold">Received By</p>
          <div className="border-b border-slate-900 mb-2"></div>
          <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
          <p className="text-xs text-slate-600">Date: ________________</p>
        </div>
        <div className="w-64">
          <p className="mb-8 font-semibold">Authorized By</p>
          <div className="border-b border-slate-900 mb-2"></div>
          <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
          <p className="text-xs text-slate-600">Date: ________________</p>
        </div>
      </div>

      <div className="mt-16 text-center text-xs text-slate-500 pt-4 pb-4 print-footer">
        StockPilot • Goods Receipt • {receipt.reference}
      </div>
    </div>
    </>
  );
}
