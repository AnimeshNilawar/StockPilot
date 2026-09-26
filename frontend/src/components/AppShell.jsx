import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { can, isAdmin, isInventoryManager, isWarehouseScoped } from '../lib/permissions';

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [openDropdown, setOpenDropdown] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const navRef = useRef(null);

  // Close open dropdowns on click outside or route change
  useEffect(() => {
    setOpenDropdown(null);
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenDropdown(null);
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Build role-aware grouped navigation
  const navGroups = [
    {
      type: 'link',
      to: '/dashboard',
      label: 'Dashboard',
      show: can.viewDashboard(user),
    },
    {
      type: 'group',
      key: 'inventory',
      label: 'Inventory',
      show: can.readStock(user) || can.viewMoveHistory(user) || can.moveStock(user),
      items: [
        { to: '/stock', label: 'Stock Balances', show: can.readStock(user) || can.moveStock(user) },
        { to: '/moves', label: 'Move History', show: can.viewMoveHistory(user) || can.readStock(user) },
        { to: '/stock?lowStock=true', label: 'Low Stock Alerts', show: can.readStock(user) },
      ],
    },
    {
      type: 'group',
      key: 'operations',
      label: 'Operations',
      show:
        can.createReceipt(user) ||
        can.validateReceipt(user) ||
        can.createDelivery(user) ||
        can.validateDelivery(user) ||
        can.createTransfer(user) ||
        can.validateTransfer(user) ||
        can.createAdjustment(user) ||
        can.validateAdjustment(user),
      items: [
        { to: '/receipts', label: 'Receipts', show: can.createReceipt(user) || can.validateReceipt(user) },
        {
          to: '/deliveries',
          label: 'Deliveries',
          show: can.createDelivery(user) || can.pickDelivery(user) || can.validateDelivery(user),
        },
        {
          to: '/transfers',
          label: 'Internal Transfers',
          show: can.createTransfer(user) || can.validateTransfer(user) || can.readStock(user),
        },
        {
          to: '/adjustments',
          label: 'Adjustments / Counts',
          show: can.createAdjustment(user) || can.validateAdjustment(user) || can.readStock(user),
        },
      ],
    },
    {
      type: 'group',
      key: 'catalog',
      label: 'Catalog',
      show: can.readProducts(user) || can.writeProducts(user) || isAdmin(user) || isInventoryManager(user),
      items: [
        { to: '/products', label: 'Products', show: true },
        { to: '/categories', label: 'Categories', show: true },
        { to: '/uoms', label: 'Units of Measure', show: true },
      ],
    },
    {
      type: 'group',
      key: 'warehouses',
      label: 'Warehouses',
      show: can.readWarehouses(user) || can.writeWarehouses(user) || isAdmin(user) || isInventoryManager(user),
      items: [
        { to: '/warehouses', label: 'Warehouses', show: true },
        { to: '/locations', label: 'Locations', show: true },
      ],
    },
    {
      type: 'group',
      key: 'admin',
      label: 'Administration',
      show: can.manageUsers(user) || isAdmin(user),
      items: [
        { to: '/users', label: 'User Management', show: can.manageUsers(user) },
      ],
    },
  ];

  const visibleGroups = navGroups.filter((g) => {
    if (g.type === 'link') return g.show;
    if (g.type === 'group') {
      const activeItems = (g.items || []).filter((i) => i.show);
      return g.show && activeItems.length > 0;
    }
    return false;
  });

  const isGroupActive = (group) => {
    if (group.type === 'link') {
      return location.pathname === group.to;
    }
    if (group.type === 'group') {
      return (group.items || []).some((i) => {
        const path = i.to.split('?')[0];
        return location.pathname.startsWith(path);
      });
    }
    return false;
  };

  const roleBadgeColor = isAdmin(user)
    ? 'bg-purple-100 text-purple-700 border-purple-200'
    : isInventoryManager(user)
    ? 'bg-blue-100 text-blue-700 border-blue-200'
    : 'bg-emerald-100 text-emerald-700 border-emerald-200';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-xs" ref={navRef}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          {/* Left brand & Desktop Nav */}
          <div className="flex items-center gap-6">
            <NavLink to="/dashboard" className="flex items-center gap-2 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow-sm transition-transform group-hover:scale-105">
                S
              </div>
              <div className="flex flex-col">
                <span className="text-base font-bold tracking-tight text-slate-900 leading-tight">StockPilot</span>
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest leading-none">Inventory</span>
              </div>
            </NavLink>

            {/* Desktop Grouped Navbar */}
            <nav className="hidden lg:flex items-center gap-1">
              {visibleGroups.map((group) => {
                if (group.type === 'link') {
                  const active = location.pathname === group.to;
                  return (
                    <NavLink
                      key={group.to}
                      to={group.to}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {group.label}
                    </NavLink>
                  );
                }

                const active = isGroupActive(group);
                const isOpen = openDropdown === group.key;
                const items = group.items.filter((i) => i.show);

                return (
                  <div key={group.key} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenDropdown(isOpen ? null : group.key)}
                      className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        active || isOpen
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <span>{group.label}</span>
                      <svg
                        className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180 text-blue-700' : 'text-slate-400'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {isOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                        {items.map((item) => {
                          const itemPath = item.to.split('?')[0];
                          const isItemActive = location.pathname === itemPath;
                          return (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              className={`flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                                isItemActive
                                  ? 'bg-blue-50 text-blue-700 font-semibold'
                                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                              }`}
                            >
                              {item.label}
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          {/* Right User & Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Desktop User Menu Dropdown */}
            <div className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                  {(user?.name || user?.email || 'U')[0].toUpperCase()}
                </div>
                <div className="text-left text-xs">
                  <p className="font-semibold text-slate-800 leading-tight truncate max-w-[130px]">
                    {user?.name || user?.email}
                  </p>
                  <p className="text-[10px] text-slate-500 capitalize leading-none mt-0.5">
                    {user?.role?.toLowerCase().replace(/_/g, ' ')}
                  </p>
                </div>
                <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-50 animate-in fade-in duration-150">
                  <div className="border-b border-slate-100 pb-2.5 mb-2">
                    <p className="text-sm font-semibold text-slate-900">{user?.name || user?.email}</p>
                    <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${roleBadgeColor}`}>
                        {user?.role?.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  {isWarehouseScoped(user) && (
                    <div className="py-2 border-b border-slate-100 mb-2">
                      <p className="text-[11px] font-medium text-slate-400 uppercase">Assigned Scope</p>
                      <p className="text-xs font-semibold text-slate-700 mt-0.5">
                        {user?.warehouseIds?.length ? `${user.warehouseIds.length} warehouse(s)` : 'Assigned Warehouse'}
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={signOut}
                    className="w-full text-left rounded-lg px-2.5 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>

            {/* Quick Sign Out (Always visible on mobile) */}
            <button
              type="button"
              onClick={signOut}
              className="sm:hidden rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700"
            >
              Sign out
            </button>

            {/* Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg border border-slate-300 p-2 text-slate-700 lg:hidden hover:bg-slate-50"
              aria-label="Toggle navigation"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden max-h-[80vh] overflow-y-auto">
            <div className="mb-3 border-b border-slate-100 pb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">{user?.name || user?.email}</p>
                <p className="text-xs text-slate-500 capitalize">{user?.role?.toLowerCase().replace(/_/g, ' ')}</p>
              </div>
              <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${roleBadgeColor}`}>
                {user?.role?.replace(/_/g, ' ')}
              </span>
            </div>

            <nav className="flex flex-col gap-1.5">
              {visibleGroups.map((group) => {
                if (group.type === 'link') {
                  const active = location.pathname === group.to;
                  return (
                    <NavLink
                      key={group.to}
                      to={group.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium ${
                        active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {group.label}
                    </NavLink>
                  );
                }

                const items = group.items.filter((i) => i.show);
                return (
                  <div key={group.key} className="py-1">
                    <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      {group.label}
                    </p>
                    <div className="flex flex-col gap-0.5 pl-2 border-l-2 border-slate-100">
                      {items.map((item) => {
                        const itemPath = item.to.split('?')[0];
                        const isItemActive = location.pathname === itemPath;
                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`rounded-lg px-3 py-1.5 text-sm ${
                              isItemActive
                                ? 'bg-blue-50 text-blue-700 font-semibold'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            {item.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-xs ${className}`}>
      {children}
    </section>
  );
}
