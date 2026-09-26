import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { AppShell, PageHeader, Card } from '../components/AppShell';
import { DataTable, Badge } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { formatQuantity, formatDate, formatDateTime, stateTone, errorMessage } from '../lib/format';

const CANCELLABLE_STATES = ['DRAFT', 'READY'];

export function InternalTransferDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [transfer, setTransfer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [stockBalances, setStockBalances] = useState({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);

  const fetchTransfer = async () => {
    try {
      const res = await api.get(`/transfers/${id}`);
      setTransfer(res.data);
    } catch {
      toast.error('Failed to load internal transfer');
      navigate('/transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransfer();
  }, [id]);

  const fetchAvailability = async () => {
    if (!transfer) return;
    setCheckingAvailability(true);
    try {
      const balanceMap = {};
      await Promise.all(
        transfer.lines.map(async (line) => {
          try {
            const res = await api.get(`/stock/quants?warehouseId=${transfer.warehouse.id}&productId=${line.product.id}&locationId=${line.sourceLocation.id}`);
            const quant = (res.data?.items || res.data || [])[0];
            const onHand = quant ? parseFloat(quant.onHand) : 0;
            const reserved = quant ? parseFloat(quant.reservedQuantity || 0) : 0;
            const free = quant ? parseFloat(quant.freeToUse ?? (onHand - reserved)) : 0;
            balanceMap[line.id] = { onHand, reservedQuantity: reserved, freeToUse: free };
          } catch {
            balanceMap[line.id] = { onHand: 0, reservedQuantity: 0, freeToUse: 0 };
          }
        })
      );
      setStockBalances(balanceMap);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCheckingAvailability(false);
    }
  };

  useEffect(() => {
    if (transfer && (transfer.state === 'DRAFT' || transfer.state === 'READY')) {
      fetchAvailability();
    }
  }, [transfer?.id, transfer?.state]);

  useEffect(() => {
    if (showEdit && transfer) {
      api.get('/products').then((res) => setProducts(res.data.items || []));
      api.get(`/warehouses/${transfer.warehouse.id}/locations?pageSize=200`).then((res) => {
        setLocations((res.data.items || []).filter((loc) => loc.type === 'INTERNAL'));
      });
      setEditLines(
        transfer.lines.map((l) => ({
          id: crypto.randomUUID(),
          productId: l.product.id,
          quantity: l.quantity,
          sourceLocationId: l.sourceLocation.id,
          destinationLocationId: l.destinationLocation.id,
        }))
      );
    }
  }, [showEdit]);

  const handleValidate = async () => {
    if (
      !window.confirm(
        'Are you sure you want to validate this internal transfer? Stock will be immediately relocated between the internal locations.',
      )
    )
      return;
    setBusy('validate');
    try {
      const key = crypto.randomUUID();
      await api.post(`/transfers/${id}/validate`, {}, { headers: { 'Idempotency-Key': key } });
      toast.success('Internal transfer validated successfully');
      await fetchTransfer();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleTransition = async (newState) => {
    setBusy(newState);
    try {
      await api.patch(`/transfers/${id}/status`, { state: newState });
      toast.success(`Transfer moved to ${newState}`);
      await fetchTransfer();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel this internal transfer?')) return;
    setBusy('cancel');
    try {
      await api.post(`/transfers/${id}/cancel`);
      toast.success('Internal transfer cancelled');
      await fetchTransfer();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    for (const l of editLines) {
      if (l.sourceLocationId && l.destinationLocationId && l.sourceLocationId === l.destinationLocationId) {
        toast.error('Source and destination location cannot be the same');
        return;
      }
    }
    setBusy('edit');
    try {
      await api.put(`/transfers/${id}`, {
        warehouseId: transfer.warehouse.id,
        lines: editLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          sourceLocationId: l.sourceLocationId,
          destinationLocationId: l.destinationLocationId,
        })),
      });
      toast.success('Transfer updated');
      setShowEdit(false);
      await fetchTransfer();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const addEditLine = () => {
    setEditLines([
      ...editLines,
      { id: crypto.randomUUID(), productId: '', quantity: '', sourceLocationId: '', destinationLocationId: '' },
    ]);
  };

  const removeEditLine = (lineId) => {
    setEditLines(editLines.filter((l) => l.id !== lineId));
  };

  const updateEditLine = (lineId, field, value) => {
    setEditLines(editLines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)));
  };

  if (loading) {
    return (
      <AppShell>
        <div className="py-12 text-center text-slate-500">Loading transfer...</div>
      </AppShell>
    );
  }

  if (!transfer) return null;

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => `${row.product.name} (${row.product.sku})`,
    },
    { key: 'source', header: 'Source Location', render: (row) => row.sourceLocation.name },
    { key: 'destination', header: 'Destination Location', render: (row) => row.destinationLocation.name },
    {
      key: 'quantity',
      header: 'Quantity',
      render: (row) => `${formatQuantity(row.quantity)} ${row.product?.uom?.code || ''}`,
    },
    ...(transfer.state === 'DRAFT' || transfer.state === 'READY'
      ? [
          {
            key: 'sourceStock',
            header: 'Source Stock (On Hand / Free)',
            render: (row) => {
              const b = stockBalances[row.id];
              if (!b) return <span className="text-slate-400 text-xs">Checking...</span>;
              const req = parseFloat(row.quantity);
              const isShort = b.freeToUse < req;
              return (
                <div className="text-xs">
                  <span className="font-semibold">{formatQuantity(b.onHand)}</span> on hand •{' '}
                  <span className={isShort ? 'font-bold text-rose-600' : 'text-emerald-700'}>
                    {formatQuantity(b.freeToUse)} free
                  </span>
                  {isShort && (
                    <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">
                      Insufficient
                    </span>
                  )}
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <>
      <style>{`
      @media print {
        body * {
          visibility: hidden;
        }
        .transfer-print-document,
        .transfer-print-document * {
          visibility: visible;
        }
        .transfer-print-document {
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
          title={transfer.reference}
          description={`Warehouse: ${transfer.warehouse.name} • Internal Movement`}
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => window.print()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Print
              </button>

              {(transfer.state === 'DRAFT' || transfer.state === 'READY') && (
                <button
                  onClick={fetchAvailability}
                  disabled={checkingAvailability}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {checkingAvailability ? 'Checking...' : 'Refresh Stock'}
                </button>
              )}

              {transfer.state === 'DRAFT' && can.createTransfer(user) && (
                <button
                  onClick={() => setShowEdit(true)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </button>
              )}

              {transfer.state === 'DRAFT' && can.createTransfer(user) && (
                <button
                  onClick={() => handleTransition('READY')}
                  disabled={busy === 'READY'}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy === 'READY' ? 'Updating...' : 'Mark Ready'}
                </button>
              )}

              {transfer.state === 'READY' && can.validateTransfer(user) && (
                <button
                  onClick={handleValidate}
                  disabled={busy === 'validate'}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {busy === 'validate' ? 'Validating...' : 'Validate Transfer'}
                </button>
              )}

              {CANCELLABLE_STATES.includes(transfer.state) && can.createTransfer(user) && (
                <button
                  onClick={handleCancel}
                  disabled={busy === 'cancel'}
                  className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
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
                <Badge className={stateTone(transfer.state)}>{transfer.state}</Badge>
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-500">Created</h3>
              <p className="mt-1 text-sm text-slate-900">{formatDateTime(transfer.createdAt)}</p>
            </div>
            <div className="sm:col-span-2">
              <h3 className="text-sm font-medium text-slate-500">Workflow guidance</h3>
              <p className="mt-1 text-sm text-slate-600">
                {transfer.state === 'DRAFT' && 'Review lines and mark READY when physical movement is prepared.'}
                {transfer.state === 'READY' && 'Validate to atomically relocate stock from source to destination location.'}
                {transfer.state === 'DONE' && 'Stock relocated. Total inventory balance remains invariant.'}
                {transfer.state === 'CANCELLED' && 'Transfer was cancelled. No stock was moved.'}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-bold text-slate-800">Transfer Lines</h2>
          </div>
          <DataTable
            columns={columns}
            rows={transfer.lines}
            getRowKey={(row) => row.id}
            empty={<p className="py-12 text-center text-sm text-slate-500">No lines found.</p>}
          />
        </Card>

        {showEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="mb-4 text-xl font-bold">Edit Transfer Lines</h2>
              <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700">Lines</label>
                    <button
                      type="button"
                      onClick={addEditLine}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      + Add Line
                    </button>
                  </div>

                  {editLines.length === 0 && (
                    <p className="text-sm text-slate-500 py-4 text-center border rounded-lg border-dashed">
                      No lines added.
                    </p>
                  )}

                  <div className="flex flex-col gap-3">
                    {editLines.map((line) => (
                      <div
                        key={line.id}
                        className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center border p-3 rounded-lg bg-slate-50"
                      >
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Product</label>
                          <select
                            required
                            value={line.productId}
                            onChange={(e) => updateEditLine(line.id, 'productId', e.target.value)}
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
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Source Location</label>
                          <select
                            required
                            value={line.sourceLocationId}
                            onChange={(e) => updateEditLine(line.id, 'sourceLocationId', e.target.value)}
                            className="w-full text-sm rounded border-slate-300 py-1"
                          >
                            <option value="">From location...</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id} disabled={l.id === line.destinationLocationId}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Destination Location</label>
                          <select
                            required
                            value={line.destinationLocationId}
                            onChange={(e) => updateEditLine(line.id, 'destinationLocationId', e.target.value)}
                            className="w-full text-sm rounded border-slate-300 py-1"
                          >
                            <option value="">To location...</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id} disabled={l.id === line.sourceLocationId}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end gap-1">
                          <div className="flex-1">
                            <label className="block text-xs text-slate-500 mb-1">Quantity</label>
                            <input
                              required
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={line.quantity}
                              onChange={(e) => updateEditLine(line.id, 'quantity', e.target.value)}
                              placeholder="Qty"
                              className="w-full text-sm rounded border-slate-300 py-1"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeEditLine(line.id)}
                            className="text-red-500 hover:text-red-700 px-2 py-1 mb-0.5 text-lg"
                          >
                            ×
                          </button>
                        </div>
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
                    disabled={busy === 'edit'}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AppShell>

      <div className="transfer-print-document hidden font-sans text-black bg-white">
        <div className="border-b-2 border-slate-900 pb-4 mb-8">
          <h1 className="text-3xl font-bold uppercase tracking-wider">StockPilot</h1>
          <h2 className="text-xl font-semibold text-slate-700 uppercase tracking-widest mt-1">
            Internal Transfer Note
          </h2>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">
            Transfer Information
          </h3>
          <table className="w-full max-w-lg text-sm">
            <tbody>
              <tr>
                <td className="py-1 font-semibold w-32">Transfer No.</td>
                <td className="py-1">{transfer.reference}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-32">Status</td>
                <td className="py-1">{transfer.state}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-32">Date</td>
                <td className="py-1">{formatDate(transfer.createdAt)}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-32">Warehouse</td>
                <td className="py-1">{transfer.warehouse.name}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">Transfer Lines</h3>
          <table className="w-full text-left border-collapse text-sm">
            <thead className="table-header-group">
              <tr className="border-b-2 border-slate-900">
                <th className="py-2 px-2 font-bold w-12">#</th>
                <th className="py-2 px-2 font-bold">Product</th>
                <th className="py-2 px-2 font-bold">SKU</th>
                <th className="py-2 px-2 font-bold text-right">Quantity</th>
                <th className="py-2 px-2 font-bold text-right">Source</th>
                <th className="py-2 px-2 font-bold text-right">Destination</th>
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-300 break-inside-avoid">
                  <td className="py-3 px-2">{i + 1}</td>
                  <td className="py-3 px-2">{l.product.name}</td>
                  <td className="py-3 px-2">{l.product.sku}</td>
                  <td className="py-3 px-2 text-right">
                    {formatQuantity(l.quantity)} {l.product.uom?.code || ''}
                  </td>
                  <td className="py-3 px-2 text-right">{l.sourceLocation.name}</td>
                  <td className="py-3 px-2 text-right">{l.destinationLocation.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between border-t border-slate-900 pt-16 break-inside-avoid">
          <div className="w-64">
            <p className="mb-8 font-semibold">Authorized By</p>
            <div className="border-b border-slate-900 mb-2"></div>
            <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
            <p className="text-xs text-slate-600">Date: ________________</p>
          </div>
          <div className="w-64">
            <p className="mb-8 font-semibold">Executed By</p>
            <div className="border-b border-slate-900 mb-2"></div>
            <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
            <p className="text-xs text-slate-600">Date: ________________</p>
          </div>
        </div>

        <div className="mt-16 text-center text-xs text-slate-500 pt-4 pb-4">
          StockPilot • Internal Transfer • {transfer.reference}
        </div>
      </div>
    </>
  );
}
