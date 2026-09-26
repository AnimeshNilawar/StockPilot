import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { can } from '../lib/permissions';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', show: () => true },
  { to: '/products', label: 'Products', show: () => true },
  { to: '/categories', label: 'Categories', show: () => true },
  { to: '/uoms', label: 'Units', show: () => true },
  { to: '/warehouses', label: 'Warehouses', show: () => true },
  {
    to: '/stock',
    label: 'Stock balances',
    show: (user) => can.readStock(user) || can.moveStock(user),
  },
  {
    to: '/receipts',
    label: 'Receipts',
    show: (user) => can.createReceipt(user) || can.validateReceipt(user),
  },
  {
    to: '/deliveries',
    label: 'Deliveries',
    show: (user) => can.createDelivery(user) || can.pickDelivery(user) || can.validateDelivery(user),
  },
  {
    to: '/transfers',
    label: 'Internal Transfers',
    show: (user) => can.createTransfer(user) || can.validateTransfer(user) || can.readStock(user),
  },
  {
    to: '/adjustments',
    label: 'Adjustments',
    show: (user) => can.createAdjustment(user) || can.validateAdjustment(user) || can.readStock(user),
  },
  {
    to: '/moves',
    label: 'Move history',
    show: (user) => can.readStock(user) || can.moveStock(user),
  },
];

const navLinkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white">
              S
            </div>
            <span className="text-lg font-bold tracking-tight">StockPilot</span>
          </div>

          <nav className="ml-4 hidden flex-1 items-center gap-1 lg:flex">
            {NAV.filter((item) => item.show(user)).map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-800">{user?.name || user?.email}</p>
              <p className="text-xs text-slate-500">{user?.role?.replace(/_/g, ' ')}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Sign out
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 lg:hidden"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
            >
              ☰
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="flex flex-col gap-1 border-t border-slate-200 px-4 py-3 lg:hidden">
            {NAV.filter((item) => item.show(user)).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={navLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}
