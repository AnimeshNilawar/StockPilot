import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { Badge } from '../components/DataTable';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { can, isAdmin, isInventoryManager, isWarehouseScoped } from '../lib/permissions';
import { formatQuantity, formatDateTime, documentTypeLabel, stateTone, stateLabel } from '../lib/format';
import { useToast } from '../components/Toast';

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [warehouses, setWarehouses] = useState([]);
  const [categories, setCategories] = useState([]);

  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('receipts');

  useEffect(() => {
    api.get('/warehouses/options')
      .then((res) => setWarehouses(res.data || []))
      .catch(() => {});
    api.get('/categories')
      .then((res) => setCategories(res.data?.items || []))
      .catch(() => {});
  }, []);

  const fetchDashboard = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams();
      if (warehouseId) params.append('warehouseId', warehouseId);
      if (categoryId) params.append('categoryId', categoryId);

      const res = await api.get(`/dashboard?${params.toString()}`);
      setDashboardData(res.data);
    } catch (err) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [warehouseId, categoryId]);

  const kpis = dashboardData?.kpis || {
    totalProductsInStock: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    pendingReceipts: 0,
    pendingDeliveries: 0,
    scheduledTransfers: 0,
    pendingAdjustments: 0,
  };

  const statCards = [
    {
      title: 'Products in Stock',
      value: kpis.totalProductsInStock,
      subtitle: 'Products with positive balance',
      to: warehouseId ? `/stock?warehouseId=${warehouseId}&nonZero=true` : '/stock?nonZero=true',
      color: 'text-slate-900',
      border: 'border-slate-200',
      bg: 'bg-white',
      badge: 'In Stock',
      badgeColor: 'bg-emerald-50 text-emerald-700',
    },
    {
      title: 'Low Stock Items',
      value: kpis.lowStockCount,
      subtitle: 'At or below reorder threshold',
      to: warehouseId ? `/stock?warehouseId=${warehouseId}&lowStock=true` : '/stock',
      color: kpis.lowStockCount > 0 ? 'text-amber-600' : 'text-slate-800',
      border: kpis.lowStockCount > 0 ? 'border-amber-200' : 'border-slate-200',
      bg: kpis.lowStockCount > 0 ? 'bg-amber-50/40' : 'bg-white',
      badge: 'Reorder Needed',
      badgeColor: 'bg-amber-100 text-amber-800',
    },
    {
      title: 'Out of Stock',
      value: kpis.outOfStockCount,
      subtitle: 'Depleted product inventory',
      to: warehouseId ? `/stock?warehouseId=${warehouseId}` : '/stock',
      color: kpis.outOfStockCount > 0 ? 'text-rose-600' : 'text-slate-800',
      border: kpis.outOfStockCount > 0 ? 'border-rose-200' : 'border-slate-200',
      bg: kpis.outOfStockCount > 0 ? 'bg-rose-50/40' : 'bg-white',
      badge: 'Critical',
      badgeColor: 'bg-rose-100 text-rose-700',
    },
    {
      title: 'Pending Receipts',
      value: kpis.pendingReceipts,
      subtitle: 'Draft / Waiting / Ready incoming',
      to: warehouseId ? `/receipts?warehouseId=${warehouseId}` : '/receipts',
      color: 'text-blue-600',
      border: 'border-blue-200',
      bg: 'bg-blue-50/30',
      badge: 'Inbound',
      badgeColor: 'bg-blue-100 text-blue-700',
    },
    {
      title: 'Pending Deliveries',
      value: kpis.pendingDeliveries,
      subtitle: 'Draft / Waiting / Ready outgoing',
      to: warehouseId ? `/deliveries?warehouseId=${warehouseId}` : '/deliveries',
      color: 'text-indigo-600',
      border: 'border-indigo-200',
      bg: 'bg-indigo-50/30',
      badge: 'Outbound',
      badgeColor: 'bg-indigo-100 text-indigo-700',
    },
    {
      title: 'Scheduled Transfers',
      value: kpis.scheduledTransfers,
      subtitle: 'Internal relocation orders',
      to: warehouseId ? `/transfers?warehouseId=${warehouseId}` : '/transfers',
      color: 'text-violet-600',
      border: 'border-violet-200',
      bg: 'bg-violet-50/30',
      badge: 'Internal',
      badgeColor: 'bg-violet-100 text-violet-700',
    },
  ];

  return (
    <AppShell>
      {/* Header & Composable Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Inventory Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Real-time inventory levels, operational pipeline, and stock movements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Warehouse Selector */}
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="rounded-lg border-slate-300 bg-white px-3 py-1.5 text-sm font-medium shadow-xs focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All Accessible Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.shortCode})
              </option>
            ))}
          </select>

          {/* Category Filter */}
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-lg border-slate-300 bg-white px-3 py-1.5 text-sm font-medium shadow-xs focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchDashboard(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {loading && !dashboardData ? (
        <div className="py-16">
          <LoadingState message="Loading inventory KPIs and movements..." />
        </div>
      ) : (
        <>
          {/* KPI Stat Cards Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-6">
            {statCards.map((card) => (
              <Link
                key={card.title}
                to={card.to}
                className={`group rounded-xl border p-4 shadow-xs transition-all hover:shadow-md hover:translate-y-[-1px] ${card.border} ${card.bg}`}
              >
                <div className="flex items-center justify-between gap-1 mb-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate">
                    {card.title}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                </div>
                <p className={`text-3xl font-extrabold tracking-tight ${card.color}`}>
                  {card.value}
                </p>
                <p className="mt-1 text-xs text-slate-500 line-clamp-1">{card.subtitle}</p>
              </Link>
            ))}
          </div>

          {/* Main Grid: Low Stock Alerts + Operations Pipeline */}
          <div className="grid gap-6 lg:grid-cols-12 mb-6">
            {/* Low Stock Alerts (7 cols) */}
            <Card className="lg:col-span-7 flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
                <div>
                  <h2 className="font-bold text-slate-900">Low Stock & Shortfall Alerts</h2>
                  <p className="text-xs text-slate-500">Products requiring procurement or relocation</p>
                </div>
                <Link
                  to={warehouseId ? `/stock?warehouseId=${warehouseId}` : '/stock'}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  View All Stock →
                </Link>
              </div>

              <div className="flex-1 p-0 overflow-x-auto">
                {(dashboardData?.lowStockItems || []).length === 0 ? (
                  <div className="p-8 text-center">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-2">
                      ✓
                    </div>
                    <p className="text-sm font-semibold text-slate-800">All Stock Levels Healthy</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      No products are currently at or below their reorder points.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-2.5">Product / SKU</th>
                        <th className="px-3 py-2.5 text-right">On Hand</th>
                        <th className="px-3 py-2.5 text-right">Min Qty</th>
                        <th className="px-3 py-2.5 text-right">Shortfall</th>
                        <th className="px-4 py-2.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dashboardData.lowStockItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-slate-900">{item.name}</p>
                            <p className="font-mono text-xs text-slate-500">{item.sku} • {item.category}</p>
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-slate-800">
                            {formatQuantity(item.onHand)} <span className="text-xs font-normal text-slate-500">{item.uom}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-600">
                            {formatQuantity(item.reorderMin)} <span className="text-xs font-normal text-slate-500">{item.uom}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-rose-600">
                            {formatQuantity(item.shortfall)} <span className="text-xs font-normal text-slate-500">{item.uom}</span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {item.isOutOfStock ? (
                              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                                Out of Stock
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                                Low Stock
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            {/* Pending Operations (5 cols) */}
            <Card className="lg:col-span-5 flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('receipts')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                      activeTab === 'receipts'
                        ? 'bg-blue-100 text-blue-800'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Pending Receipts ({kpis.pendingReceipts})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('deliveries')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                      activeTab === 'deliveries'
                        ? 'bg-blue-100 text-blue-800'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Pending Deliveries ({kpis.pendingDeliveries})
                  </button>
                </div>
                <Link
                  to={activeTab === 'receipts' ? '/receipts' : '/deliveries'}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  Manage →
                </Link>
              </div>

              <div className="flex-1 p-0">
                {activeTab === 'receipts' ? (
                  (dashboardData?.recentReceipts || []).length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No pending receipts currently in queue.
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {dashboardData.recentReceipts.map((r) => (
                        <li key={r.id} className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors">
                          <div>
                            <Link to={`/receipts/${r.id}`} className="font-semibold text-blue-600 hover:underline text-sm">
                              {r.reference}
                            </Link>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {r.partner} • {r.warehouse} ({r.lineCount} items)
                            </p>
                          </div>
                          <Badge className={stateTone(r.state)}>{r.state}</Badge>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  (dashboardData?.recentDeliveries || []).length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No pending deliveries currently in queue.
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {dashboardData.recentDeliveries.map((d) => (
                        <li key={d.id} className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors">
                          <div>
                            <Link to={`/deliveries/${d.id}`} className="font-semibold text-blue-600 hover:underline text-sm">
                              {d.reference}
                            </Link>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {d.partner} • {d.warehouse} ({d.lineCount} items)
                            </p>
                          </div>
                          <Badge className={stateTone(d.state)}>{d.state}</Badge>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </Card>
          </div>

          {/* Recent Ledger Stock Movements */}
          <Card>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h2 className="font-bold text-slate-900">Recent Completed Movements</h2>
                <p className="text-xs text-slate-500">Live immutable stock ledger audit feed</p>
              </div>
              <Link to="/moves" className="text-xs font-semibold text-blue-600 hover:underline">
                View Full Ledger →
              </Link>
            </div>

            <div className="p-0 overflow-x-auto">
              {(dashboardData?.recentMoves || []).length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No stock movements recorded yet. Completed transactions will appear here.
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Reference</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5">Route</th>
                      <th className="px-3 py-2.5 text-right">Quantity</th>
                      <th className="px-4 py-2.5 text-right">Done At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dashboardData.recentMoves.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-800">
                          {m.reference}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge className="bg-slate-100 text-slate-800">{documentTypeLabel(m.documentType)}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold text-slate-900">{m.productName}</span>{' '}
                          <span className="text-xs text-slate-500">({m.productSku})</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          <span className="font-medium text-slate-800">{m.fromLocation}</span> → <span className="font-medium text-slate-800">{m.toLocation}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                          {formatQuantity(m.quantity)} <span className="text-xs font-normal text-slate-500">{m.uom}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                          {formatDateTime(m.doneDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}
