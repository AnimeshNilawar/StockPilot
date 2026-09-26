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

export function AdjustmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [adjustment, setAdjustment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);

  const fetchAdjustment = async () => {
    try {
      const res = await api.get(`/adjustments/${id}`);
      setAdjustment(res.data);
    } catch {
      toast.error('Failed to load inventory adjustment');
      navigate('/adjustments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdjustment();
  }, [id]);

  useEffect(() => {
    if (showEdit && adjustment) {
      api.get('/products').then((res) => setProducts(res.data.items || []));
      api.get(`/warehouses/${adjustment.warehouse.id}/locations?pageSize=200`).then((res) => {
        setLocations((res.data.items || []).filter((loc) => loc.type === 'INTERNAL'));
      });
      setEditLines(
        adjustment.lines.map((l) => ({
          id: crypto.randomUUID(),
          productId: l.product.id,
          locationId: l.location.id,
          countedQuantity: l.countedQuantity,
        }))
      );
    }
  }, [showEdit]);

  const handleValidate = async () => {
    if (
      !window.confirm(
        'Approve and validate this physical inventory adjustment? Stock will be updated to match counted quantities and stock movements will be posted.',
      )
    )
      return;
    setBusy('validate');
    try {
      const key = crypto.randomUUID();
      await api.post(`/adjustments/${id}/validate`, {}, { headers: { 'Idempotency-Key': key } });
      toast.success('Inventory adjustment validated and stock updated');
      await fetchAdjustment();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleTransition = async (newState) => {
    setBusy(newState);
    try {
      await api.patch(`/adjustments/${id}/status`, { state: newState });
      toast.success(`Adjustment moved to ${newState}`);
      await fetchAdjustment();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel this adjustment?')) return;
    setBusy('cancel');
    try {
      await api.post(`/adjustments/${id}/cancel`);
      toast.success('Adjustment cancelled');
      await fetchAdjustment();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setBusy('edit');
    try {
      await api.put(`/adjustments/${id}`, {
        warehouseId: adjustment.warehouse.id,
        lines: editLines.map((l) => ({
          productId: l.productId,
          locationId: l.locationId,
          countedQuantity: l.countedQuantity,
        })),
      });
      toast.success('Adjustment updated');
      setShowEdit(false);
      await fetchAdjustment();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const addEditLine = () => {
    setEditLines([
      ...editLines,
      { id: crypto.randomUUID(), productId: '', locationId: '', countedQuantity: '' },
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
        <div className="py-12 text-center text-slate-500">Loading adjustment...</div>
      </AppShell>
    );
  }

  if (!adjustment) return null;

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => `${row.product.name} (${row.product.sku})`,
    },
    { key: 'location', header: 'Location', render: (row) => row.location.name },
    {
      key: 'systemQuantity',
      header: 'System Qty',
      render: (row) => `${formatQuantity(row.systemQuantity)} ${row.product?.uom?.code || ''}`,
    },
    {
      key: 'countedQuantity',
      header: 'Counted Qty',
      render: (row) => `${formatQuantity(row.countedQuantity)} ${row.product?.uom?.code || ''}`,
    },
    {
      key: 'difference',
      header: 'Difference',
      render: (row) => {
        const diff = parseFloat(row.difference);
        let color = 'text-slate-600';
        let label = '0.00 (Match)';
        if (diff > 0) {
          color = 'text-emerald-700 font-bold';
          label = `+${formatQuantity(diff)} (Surplus / Write-in)`;
        } else if (diff < 0) {
          color = 'text-rose-600 font-bold';
          label = `${formatQuantity(diff)} (Shortage / Scrap)`;
        }
        return <span className={color}>{label}</span>;
      },
    },
  ];

  return (
    <>
      <style>{`
      @media print {
        body * {
          visibility: hidden;
        }
        .adjustment-print-document,
        .adjustment-print-document * {
          visibility: visible;
        }
        .adjustment-print-document {
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
          title={adjustment.reference}
          description={`Warehouse: ${adjustment.warehouse.name} • Physical Stock Count`}
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => window.print()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Print
              </button>

              {adjustment.state === 'DRAFT' && can.createAdjustment(user) && (
                <button
                  onClick={() => setShowEdit(true)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </button>
              )}

              {adjustment.state === 'DRAFT' && can.createAdjustment(user) && (
                <button
                  onClick={() => handleTransition('READY')}
                  disabled={busy === 'READY'}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy === 'READY' ? 'Updating...' : 'Mark Ready for Approval'}
                </button>
              )}

              {adjustment.state === 'READY' && can.validateAdjustment(user) && (
                <button
                  onClick={handleValidate}
                  disabled={busy === 'validate'}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {busy === 'validate' ? 'Validating...' : 'Approve & Validate'}
                </button>
              )}

              {CANCELLABLE_STATES.includes(adjustment.state) && can.createAdjustment(user) && (
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
                <Badge className={stateTone(adjustment.state)}>{adjustment.state}</Badge>
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-500">Counted By</h3>
              <p className="mt-1 text-sm text-slate-900">
                {adjustment.creator?.name || adjustment.creator?.email || '-'}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-500">Created</h3>
              <p className="mt-1 text-sm text-slate-900">{formatDateTime(adjustment.createdAt)}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-500">Validation Status</h3>
              <p className="mt-1 text-sm font-medium">
                {(() => {
                  const state = adjustment.state;
                  if (state === 'DONE') {
                    const approver =
                      adjustment.validator?.name ||
                      adjustment.validator?.email ||
                      (adjustment.validatedById ? 'Authorized Manager' : null);
                    return (
                      <span className="text-emerald-700">
                        {approver ? `Approved by ${approver}` : 'Approved / Validated'}
                      </span>
                    );
                  }
                  if (state === 'READY') {
                    return <span className="text-amber-700">Pending Approval (Ready)</span>;
                  }
                  if (state === 'DRAFT' || state === 'WAITING') {
                    return <span className="text-blue-700">Pending (Draft Count in Progress)</span>;
                  }
                  if (state === 'CANCELLED') {
                    return <span className="text-rose-700">Cancelled</span>;
                  }
                  return <span className="text-slate-600">{state}</span>;
                })()}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-bold text-slate-800">Count & Difference Lines</h2>
          </div>
          <DataTable
            columns={columns}
            rows={adjustment.lines}
            getRowKey={(row) => row.id}
            empty={<p className="py-12 text-center text-sm text-slate-500">No lines found.</p>}
          />
        </Card>

        {showEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="mb-4 text-xl font-bold">Edit Count Lines</h2>
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

                  <div className="flex flex-col gap-3">
                    {editLines.map((line) => (
                      <div
                        key={line.id}
                        className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center border p-3 rounded-lg bg-slate-50"
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
                          <label className="block text-xs text-slate-500 mb-1">Location</label>
                          <select
                            required
                            value={line.locationId}
                            onChange={(e) => updateEditLine(line.id, 'locationId', e.target.value)}
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
                        <div className="flex items-end gap-1">
                          <div className="flex-1">
                            <label className="block text-xs text-slate-500 mb-1">Counted Quantity</label>
                            <input
                              required
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.countedQuantity}
                              onChange={(e) => updateEditLine(line.id, 'countedQuantity', e.target.value)}
                              placeholder="Counted"
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

      <div className="adjustment-print-document hidden font-sans text-black bg-white">
        <div className="border-b-2 border-slate-900 pb-4 mb-8">
          <h1 className="text-3xl font-bold uppercase tracking-wider">StockPilot</h1>
          <h2 className="text-xl font-semibold text-slate-700 uppercase tracking-widest mt-1">
            Physical Inventory Count & Adjustment Sheet
          </h2>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">
            Count Information
          </h3>
          <table className="w-full max-w-lg text-sm">
            <tbody>
              <tr>
                <td className="py-1 font-semibold w-36">Reference No.</td>
                <td className="py-1">{adjustment.reference}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-36">Status</td>
                <td className="py-1">{adjustment.state}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-36">Count Date</td>
                <td className="py-1">{formatDate(adjustment.createdAt)}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-36">Warehouse</td>
                <td className="py-1">{adjustment.warehouse.name}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-36">Counted By</td>
                <td className="py-1">{adjustment.creator?.name || adjustment.creator?.email || '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">Stock Count Verification</h3>
          <table className="w-full text-left border-collapse text-sm">
            <thead className="table-header-group">
              <tr className="border-b-2 border-slate-900">
                <th className="py-2 px-2 font-bold w-12">#</th>
                <th className="py-2 px-2 font-bold">Product</th>
                <th className="py-2 px-2 font-bold">Location</th>
                <th className="py-2 px-2 font-bold text-right">System Qty</th>
                <th className="py-2 px-2 font-bold text-right">Physical Count</th>
                <th className="py-2 px-2 font-bold text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {adjustment.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-300 break-inside-avoid">
                  <td className="py-3 px-2">{i + 1}</td>
                  <td className="py-3 px-2">{l.product.name} ({l.product.sku})</td>
                  <td className="py-3 px-2">{l.location.name}</td>
                  <td className="py-3 px-2 text-right">
                    {formatQuantity(l.systemQuantity)} {l.product.uom?.code || ''}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {formatQuantity(l.countedQuantity)} {l.product.uom?.code || ''}
                  </td>
                  <td className="py-3 px-2 text-right font-semibold">
                    {parseFloat(l.difference) > 0 ? `+${formatQuantity(l.difference)}` : formatQuantity(l.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between border-t border-slate-900 pt-16 break-inside-avoid">
          <div className="w-64">
            <p className="mb-8 font-semibold">Counted By (Staff)</p>
            <div className="border-b border-slate-900 mb-2"></div>
            <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
            <p className="text-xs text-slate-600">Date: ________________</p>
          </div>
          <div className="w-64">
            <p className="mb-8 font-semibold">Approved By (Manager)</p>
            <div className="border-b border-slate-900 mb-2"></div>
            <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
            <p className="text-xs text-slate-600">Date: ________________</p>
          </div>
        </div>

        <div className="mt-16 text-center text-xs text-slate-500 pt-4 pb-4">
          StockPilot • Inventory Adjustment • {adjustment.reference}
        </div>
      </div>
    </>
  );
}
