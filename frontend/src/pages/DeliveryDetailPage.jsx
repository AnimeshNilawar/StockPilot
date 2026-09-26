import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';
import { AppShell, PageHeader, Card } from '../components/AppShell';
import { DataTable, Badge } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { formatQuantity, formatDate, formatDateTime, stateTone, errorMessage } from '../lib/format';

const PICKABLE_STATES = ['DRAFT', 'WAITING'];
const CANCELLABLE_STATES = ['DRAFT', 'WAITING', 'READY'];

export function DeliveryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [availability, setAvailability] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  // Edit modal state
  const [showEdit, setShowEdit] = useState(false);
  const [editPartnerId, setEditPartnerId] = useState('');
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [editLines, setEditLines] = useState([]);

  const [warehouses, setWarehouses] = useState([]);
  const [partners, setPartners] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);

  const fetchDelivery = async () => {
    try {
      const res = await api.get(`/deliveries/${id}`);
      setDelivery(res.data);
    } catch {
      toast.error('Failed to load delivery');
      navigate('/deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDelivery();
  }, [id]);

  // Availability is a snapshot of a moment, so it is dropped whenever the
  // document changes rather than left behind to go stale.
  useEffect(() => {
    setAvailability(null);
  }, [id]);

  useEffect(() => {
    if (showEdit) {
      api.get('/warehouses').then((res) => setWarehouses(res.data.items || []));
      api.get('/partners/options?type=CUSTOMER').then((res) => setPartners(res.data || []));
      api.get('/products').then((res) => setProducts(res.data.items || []));

      setEditPartnerId(delivery.partner.id);
      setEditWarehouseId(delivery.warehouse.id);
      setEditLines(
        delivery.lines.map((l) => ({
          id: crypto.randomUUID(),
          productId: l.product.id,
          quantity: l.quantity,
          sourceLocationId: l.sourceLocation.id,
        })),
      );
    }
  }, [showEdit]);

  useEffect(() => {
    if (editWarehouseId) {
      api.get(`/warehouses/${editWarehouseId}/locations?pageSize=200`).then((res) => {
        setLocations(
          res.data.items.filter((loc) => loc.type !== 'VENDOR' && loc.type !== 'CUSTOMER'),
        );
      });
    } else {
      setLocations([]);
    }
  }, [editWarehouseId]);

  const handleCheckAvailability = async () => {
    setCheckingAvailability(true);
    try {
      const res = await api.get(`/deliveries/${id}/availability`);
      setAvailability(res.data);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handlePick = async () => {
    if (
      !window.confirm(
        'Pick this delivery? The stock will be reserved against it, so no other delivery can be promised the same units.',
      )
    )
      return;
    setBusy('pick');
    try {
      await api.post(`/deliveries/${id}/pick`);
      toast.success('Delivery picked and stock reserved');
      setAvailability(null);
      await fetchDelivery();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleValidate = async () => {
    if (
      !window.confirm(
        'Are you sure you want to validate this delivery? The stock will leave the warehouse and this cannot be undone.',
      )
    )
      return;
    setBusy('validate');
    try {
      const key = crypto.randomUUID();
      await api.post(`/deliveries/${id}/validate`, {}, { headers: { 'Idempotency-Key': key } });
      toast.success('Delivery validated successfully');
      setAvailability(null);
      await fetchDelivery();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleTransition = async (newState) => {
    setBusy(newState);
    try {
      await api.patch(`/deliveries/${id}/status`, { state: newState });
      toast.success(`Delivery moved to ${newState}`);
      await fetchDelivery();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const handleCancel = async () => {
    const releases =
      delivery.state === 'READY'
        ? ' Its stock reservation will be released, returning the units to free stock.'
        : '';
    if (!window.confirm(`Are you sure you want to cancel this delivery?${releases}`)) return;
    setBusy('cancel');
    try {
      await api.post(`/deliveries/${id}/cancel`);
      toast.success('Delivery cancelled');
      setAvailability(null);
      await fetchDelivery();
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
      await api.put(`/deliveries/${id}`, {
        partnerId: editPartnerId,
        warehouseId: editWarehouseId,
        lines: editLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          sourceLocationId: l.sourceLocationId,
        })),
      });
      toast.success('Delivery updated');
      setShowEdit(false);
      await fetchDelivery();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const addLine = () => {
    setEditLines([
      ...editLines,
      { id: crypto.randomUUID(), productId: '', quantity: '', sourceLocationId: '' },
    ]);
  };

  const handleWarehouseChange = (e) => {
    setEditWarehouseId(e.target.value);
    setEditLines(editLines.map((l) => ({ ...l, sourceLocationId: '' })));
  };

  const removeLine = (lineId) => {
    setEditLines(editLines.filter((l) => l.id !== lineId));
  };

  const updateLine = (lineId, field, value) => {
    setEditLines(editLines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)));
  };

  if (loading) {
    return (
      <AppShell>
        <div className="py-12 text-center text-slate-500">Loading delivery...</div>
      </AppShell>
    );
  }

  if (!delivery) return null;

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (row) => `${row.product.name} (${row.product.sku})`,
    },
    {
      key: 'quantity',
      header: 'Quantity',
      render: (row) => `${formatQuantity(row.quantity)} ${row.product.uom.code}`,
    },
    { key: 'source', header: 'Ship From', render: (row) => row.sourceLocation.name },
  ];

  return (
    <>
      <style>{`
      @media print {
        body * {
          visibility: hidden;
        }
        .delivery-print-document,
        .delivery-print-document * {
          visibility: visible;
        }
        .delivery-print-document {
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
          title={delivery.reference}
          description={`Customer: ${delivery.partner?.name || '-'} • Warehouse: ${delivery.warehouse.name}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => window.print()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Print
              </button>

              {PICKABLE_STATES.includes(delivery.state) && (
                <button
                  onClick={handleCheckAvailability}
                  disabled={checkingAvailability}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {checkingAvailability ? 'Checking...' : 'Check availability'}
                </button>
              )}

              {delivery.state === 'DRAFT' && can.editDelivery(user) && (
                <button
                  onClick={() => setShowEdit(true)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </button>
              )}

              {delivery.state === 'DRAFT' && can.editDelivery(user) && (
                <button
                  onClick={() => handleTransition('WAITING')}
                  disabled={busy === 'WAITING'}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Submit (Waiting)
                </button>
              )}

              {PICKABLE_STATES.includes(delivery.state) && can.pickDelivery(user) && (
                <button
                  onClick={handlePick}
                  disabled={busy === 'pick'}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy === 'pick' ? 'Picking...' : 'Pick & Reserve'}
                </button>
              )}

              {delivery.state === 'READY' && can.validateDelivery(user) && (
                <button
                  onClick={handleValidate}
                  disabled={busy === 'validate'}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {busy === 'validate' ? 'Validating...' : 'Validate Delivery'}
                </button>
              )}

              {CANCELLABLE_STATES.includes(delivery.state) && can.editDelivery(user) && (
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
                <Badge className={stateTone(delivery.state)}>{delivery.state}</Badge>
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-500">Created</h3>
              <p className="mt-1 text-sm text-slate-900">{formatDateTime(delivery.createdAt)}</p>
            </div>
            <div className="sm:col-span-2">
              <h3 className="text-sm font-medium text-slate-500">Next step</h3>
              <p className="mt-1 text-sm text-slate-600">
                {PICKABLE_STATES.includes(delivery.state) &&
                  'Pick the delivery to reserve the stock it needs. Nothing is deducted until it is validated.'}
                {delivery.state === 'READY' &&
                  'Stock is reserved against this delivery. Validating ships the goods and consumes the reservation; cancelling returns it.'}
                {delivery.state === 'DONE' && 'Goods have shipped. This delivery is closed.'}
                {delivery.state === 'CANCELLED' && 'This delivery was cancelled. Any reservation has been released.'}
              </p>
            </div>
          </div>
        </Card>

        {availability && (
          <Card className="mb-6">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-800">Stock availability</h2>
              <p className="mt-1 text-sm text-slate-500">
                Free to use is on-hand minus everything already reserved. {availability.isPicked
                  ? 'This delivery is picked, so it already holds the reservation for its own lines.'
                  : 'A line must fit inside free-to-use to be picked.'}
              </p>
            </div>
            <div className="px-6 py-4">
              {availability.canPick ? (
                <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Every line can be picked.
                </p>
              ) : (
                <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  At least one line cannot be picked — the stock is either short or already reserved
                  by another delivery.
                </p>
              )}
              <DataTable
                columns={[
                  {
                    key: 'product',
                    header: 'Product',
                    render: (row) => {
                      const line = delivery.lines.find((l) => l.id === row.lineId);
                      return line ? `${line.product.name} (${line.product.sku})` : row.productId;
                    },
                  },
                  { key: 'qty', header: 'Required', render: (row) => formatQuantity(row.quantity) },
                  { key: 'onHand', header: 'On hand', render: (row) => formatQuantity(row.onHand) },
                  {
                    key: 'reserved',
                    header: 'Reserved',
                    render: (row) => formatQuantity(row.reservedQuantity),
                  },
                  {
                    key: 'free',
                    header: 'Free to use',
                    render: (row) => formatQuantity(row.freeToUse),
                  },
                  {
                    key: 'ok',
                    header: '',
                    render: (row) =>
                      row.isAvailable ? (
                        <Badge className="bg-emerald-100 text-emerald-800">Available</Badge>
                      ) : (
                        <Badge className="bg-rose-100 text-rose-700">Short</Badge>
                      ),
                  },
                ]}
                rows={availability.lines}
                getRowKey={(row) => row.lineId}
              />
            </div>
          </Card>
        )}

        <Card>
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-bold text-slate-800">Delivery Lines</h2>
          </div>
          <DataTable
            columns={columns}
            rows={delivery.lines}
            getRowKey={(row) => row.id}
            empty={<p className="py-12 text-center text-sm text-slate-500">No lines found.</p>}
          />
        </Card>

        {showEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="mb-4 text-xl font-bold">Edit Draft Delivery</h2>
              <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Customer</label>
                    <select
                      required
                      value={editPartnerId}
                      onChange={(e) => setEditPartnerId(e.target.value)}
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
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Warehouse
                    </label>
                    <select
                      required
                      value={editWarehouseId}
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

                  {editLines.length === 0 && (
                    <p className="text-sm text-slate-500 py-4 text-center border rounded-lg border-dashed">
                      No lines added.
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    {editLines.map((line) => (
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

      <div className="delivery-print-document hidden font-sans text-black bg-white">
        <div className="border-b-2 border-slate-900 pb-4 mb-8">
          <h1 className="text-3xl font-bold uppercase tracking-wider">StockPilot</h1>
          <h2 className="text-xl font-semibold text-slate-700 uppercase tracking-widest mt-1">
            Delivery Note
          </h2>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">
            Delivery Information
          </h3>
          <table className="w-full max-w-lg text-sm">
            <tbody>
              <tr>
                <td className="py-1 font-semibold w-32">Delivery No.</td>
                <td className="py-1">{delivery.reference}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-32">Status</td>
                <td className="py-1">{delivery.state}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-32">Date</td>
                <td className="py-1">{formatDate(delivery.createdAt)}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-32">Customer</td>
                <td className="py-1">{delivery.partner?.name || '-'}</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold w-32">Warehouse</td>
                <td className="py-1">{delivery.warehouse.name}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">Delivery Lines</h3>
          <table className="w-full text-left border-collapse text-sm">
            <thead className="table-header-group">
              <tr className="border-b-2 border-slate-900">
                <th className="py-2 px-2 font-bold w-12">#</th>
                <th className="py-2 px-2 font-bold">Product</th>
                <th className="py-2 px-2 font-bold">SKU</th>
                <th className="py-2 px-2 font-bold text-right">Quantity</th>
                <th className="py-2 px-2 font-bold text-right">Ship From</th>
              </tr>
            </thead>
            <tbody>
              {delivery.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-300 break-inside-avoid">
                  <td className="py-3 px-2">{i + 1}</td>
                  <td className="py-3 px-2">{l.product.name}</td>
                  <td className="py-3 px-2">{l.product.sku}</td>
                  <td className="py-3 px-2 text-right">
                    {formatQuantity(l.quantity)} {l.product.uom.code}
                  </td>
                  <td className="py-3 px-2 text-right">{l.sourceLocation.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-16">
          <h3 className="text-lg font-bold border-b border-slate-300 pb-2 mb-4">Summary</h3>
          <p className="text-sm">Total Lines: {delivery.lines.length}</p>
        </div>

        <div className="flex justify-between border-t border-slate-900 pt-16 break-inside-avoid">
          <div className="w-64">
            <p className="mb-8 font-semibold">Picked By</p>
            <div className="border-b border-slate-900 mb-2"></div>
            <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
            <p className="text-xs text-slate-600">Date: ________________</p>
          </div>
          <div className="w-64">
            <p className="mb-8 font-semibold">Received By</p>
            <div className="border-b border-slate-900 mb-2"></div>
            <p className="text-xs text-slate-600 mb-4">Name / Signature</p>
            <p className="text-xs text-slate-600">Date: ________________</p>
          </div>
        </div>

        <div className="mt-16 text-center text-xs text-slate-500 pt-4 pb-4 print-footer">
          StockPilot • Delivery Note • {delivery.reference}
        </div>
      </div>
    </>
  );
}
