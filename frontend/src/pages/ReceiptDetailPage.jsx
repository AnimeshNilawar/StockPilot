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
  const { addToast } = useToast();
  
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);

  const fetchReceipt = async () => {
    try {
      const res = await api.get(`/receipts/${id}`);
      setReceipt(res.data);
    } catch (err) {
      addToast('Failed to load receipt', 'error');
      navigate('/receipts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipt();
  }, [id]);

  const handleValidate = async () => {
    if (!window.confirm('Are you sure you want to validate this receipt? This will move stock into the warehouse and cannot be undone.')) return;
    setValidating(true);
    try {
      // Use crypto.randomUUID() for idempotency key
      const key = crypto.randomUUID();
      await api.post(`/receipts/${id}/validate`, {}, { headers: { 'Idempotency-Key': key } });
      addToast('Receipt validated successfully', 'success');
      fetchReceipt();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setValidating(false);
    }
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
    <AppShell>
      <PageHeader
        title={receipt.reference}
        description={`Supplier: ${receipt.supplier} • Warehouse: ${receipt.warehouse.name}`}
        actions={
          receipt.state === 'DRAFT' && can.validateReceipt(user) && (
            <button
              onClick={handleValidate}
              disabled={validating}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {validating ? 'Validating...' : 'Validate Receipt'}
            </button>
          )
        }
      />

      <Card className="mb-6 p-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-sm font-medium text-slate-500">Status</h3>
            <p className="mt-1">
              <Badge className={receipt.state === 'DONE' ? 'bg-green-100 text-green-700' : receipt.state === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}>
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
    </AppShell>
  );
}
