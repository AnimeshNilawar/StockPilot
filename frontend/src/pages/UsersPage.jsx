import { useState } from 'react';
import { AppShell, Card, PageHeader } from '../components/AppShell';
import { DataTable } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { useDebounced } from '../hooks/useDebounced';
import {
  catalogKeys,
  useListQuery,
  useOptionsQuery,
  useApiMutation,
  api,
} from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { can, isAdmin, ROLES } from '../lib/permissions';
import { formatDate } from '../lib/format';
import { LoadingState, ErrorState, EmptyState } from '../components/States';
import {
  Modal,
  TextInput,
  Select,
  Button,
} from '../components/ui';
import { useToast } from '../components/Toast';

/**
 * Searchable Multi-Select Warehouse Picker.
 * - Client-side search against pre-loaded warehouse list by name and code
 * - Preserves hidden selected items during filtering
 * - Displays "Selected: X of Total"
 * - Provides "Select all visible" and "Clear visible" convenience controls
 */
function WarehousePicker({
  warehouses = [],
  selectedWarehouseIds = [],
  onChange,
  searchTerm = '',
  onSearchChange,
}) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredWarehouses = warehouses.filter((wh) => {
    if (!normalizedSearch) return true;
    const nameMatch = (wh.name || '').toLowerCase().includes(normalizedSearch);
    const codeMatch = (wh.shortCode || '').toLowerCase().includes(normalizedSearch);
    return nameMatch || codeMatch;
  });

  const handleSelectVisible = () => {
    const visibleIds = filteredWarehouses.map((w) => w.id);
    const newSelected = Array.from(new Set([...selectedWarehouseIds, ...visibleIds]));
    onChange(newSelected);
  };

  const handleClearVisible = () => {
    const visibleIdsSet = new Set(filteredWarehouses.map((w) => w.id));
    const newSelected = selectedWarehouseIds.filter((id) => !visibleIdsSet.has(id));
    onChange(newSelected);
  };

  const handleToggle = (whId) => {
    if (selectedWarehouseIds.includes(whId)) {
      onChange(selectedWarehouseIds.filter((id) => id !== whId));
    } else {
      onChange([...selectedWarehouseIds, whId]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-700">
          Selected: <span className="text-blue-600 font-bold">{selectedWarehouseIds.length}</span>
          {warehouses.length > 0 && <span className="text-slate-400 font-normal"> of {warehouses.length}</span>}
        </span>
        {filteredWarehouses.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectVisible}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors"
            >
              Select all visible
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={handleClearVisible}
              className="text-[11px] font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Clear visible
            </button>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search warehouses..."
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 pl-8 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 shadow-2xs transition-all"
        />
        <svg
          className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {searchTerm && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-600 font-bold px-1"
          >
            ×
          </button>
        )}
      </div>

      {/* Scrollable Checkbox List */}
      <div className="space-y-1 rounded-xl border border-slate-200 p-2 bg-slate-50/50 max-h-48 overflow-y-auto">
        {filteredWarehouses.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-500">
            No warehouses found
          </div>
        ) : (
          filteredWarehouses.map((wh) => {
            const isChecked = selectedWarehouseIds.includes(wh.id);
            return (
              <label
                key={wh.id}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer ${
                  isChecked ? 'bg-blue-50/70 border border-blue-100' : 'hover:bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggle(wh.id)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-100 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-800 flex-1">
                  {wh.name}{' '}
                  <span className="font-mono text-[11px] text-slate-500 font-normal">
                    ({wh.shortCode})
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const mayManage = can.manageUsers(currentUser) || isAdmin(currentUser);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [createWarehouseSearch, setCreateWarehouseSearch] = useState('');

  const [formValues, setFormValues] = useState({
    name: '',
    email: '',
    password: '',
    roleId: '',
    status: 'ACTIVE',
    warehouseIds: [],
  });

  const debouncedSearch = useDebounced(search);
  const params = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    roleId: roleId || undefined,
    warehouseId: warehouseId || undefined,
    status: status || undefined,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useListQuery(
    catalogKeys.users,
    '/users',
    params,
    { enabled: mayManage },
  );

  const warehousesQuery = useOptionsQuery(catalogKeys.warehouses, '/warehouses/options');
  const rolesQuery = useOptionsQuery(catalogKeys.roles, '/users/roles');

  const warehouses = warehousesQuery.data || [];
  const roles = rolesQuery.data || [];

  const createUserMutation = useApiMutation({
    mutationFn: (payload) => api.users.create(payload),
    invalidates: [catalogKeys.users],
    onSuccess: () => {
      toast.success('User created successfully');
      setCreateModalOpen(false);
      setCreateWarehouseSearch('');
      resetForm();
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to create user');
    },
  });

  const updateUserMutation = useApiMutation({
    mutationFn: ({ id, payload }) => api.users.update(id, payload),
    invalidates: [catalogKeys.users],
    onSuccess: () => {
      toast.success('User updated successfully');
      setEditModalOpen(false);
      setSelectedUser(null);
      setWarehouseSearch('');
      resetForm();
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to update user');
    },
  });

  const resetForm = () => {
    setFormValues({
      name: '',
      email: '',
      password: '',
      roleId: '',
      status: 'ACTIVE',
      warehouseIds: [],
    });
  };

  const openCreateModal = () => {
    const staffRole = roles.find((r) => r.name === ROLES.WAREHOUSE_STAFF);
    setFormValues({
      name: '',
      email: '',
      password: '',
      roleId: staffRole ? staffRole.id : roles[0]?.id || '',
      status: 'ACTIVE',
      warehouseIds: [],
    });
    setCreateWarehouseSearch('');
    setCreateModalOpen(true);
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setFormValues({
      name: user.name || '',
      email: user.email || '',
      password: '',
      roleId: user.roleId || user.role?.id || '',
      status: user.status || 'ACTIVE',
      warehouseIds: (user.warehouses || []).map((w) => w.id),
    });
    setWarehouseSearch('');
    setEditModalOpen(true);
  };

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    createUserMutation.mutate(formValues);
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!selectedUser) return;
    updateUserMutation.mutate({
      id: selectedUser.id,
      payload: {
        name: formValues.name,
        roleId: formValues.roleId,
        status: formValues.status,
        warehouseIds: formValues.warehouseIds,
      },
    });
  };

  const selectedRole = roles.find((r) => r.id === formValues.roleId);
  const isSelectedRoleScoped = selectedRole?.name === ROLES.WAREHOUSE_STAFF;

  const roleBadge = (roleName) => {
    switch (roleName) {
      case ROLES.ADMIN:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            Administrator
          </span>
        );
      case ROLES.INVENTORY_MANAGER:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            Inventory Manager
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            Warehouse Staff
          </span>
        );
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700">
            {(row.name || row.email || 'U')[0].toUpperCase()}
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-slate-900">{row.name || '—'}</span>
            <span className="text-xs text-slate-500">{row.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => roleBadge(row.role?.name),
    },
    {
      key: 'warehouses',
      header: 'Assigned Warehouses',
      render: (row) => {
        if (row.role?.name === ROLES.ADMIN || row.role?.name === ROLES.INVENTORY_MANAGER) {
          return (
            <span className="text-xs font-medium text-slate-500 italic">
              All Warehouses (System-wide)
            </span>
          );
        }
        if (!row.warehouses || row.warehouses.length === 0) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
              No Access Assigned
            </span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            {row.warehouses.map((w) => (
              <span
                key={w.id}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
              >
                {w.name} ({w.shortCode})
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            row.status === 'ACTIVE'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              : 'bg-rose-100 text-rose-800 border border-rose-200'
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Joined',
      render: (row) => <span className="text-xs text-slate-500">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={() => openEditModal(row)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs"
        >
          Edit Access
        </button>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="User & Access Management"
        description="Manage system users, assign operational roles, and configure granular warehouse access."
        actions={
          mayManage && (
            <Button variant="primary" onClick={openCreateModal}>
              + Add User
            </Button>
          )
        }
      />

      <Card>
        {/* Filters */}
        <div className="border-b border-slate-200 bg-slate-50/50 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div className="lg:col-span-2">
              <label
                htmlFor="user-search"
                className="mb-1 block text-xs font-medium text-slate-600 uppercase tracking-wider"
              >
                Search Users
              </label>
              <input
                id="user-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by name or email..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all shadow-sm"
              />
            </div>

            <div>
              <Select
                label="Role"
                name="roleId"
                value={roleId}
                onChange={(e) => {
                  setRoleId(e.target.value);
                  setPage(1);
                }}
                options={roles.map((r) => ({
                  value: r.id,
                  label: r.name.replace(/_/g, ' '),
                }))}
                placeholder="All Roles"
              />
            </div>

            <div>
              <Select
                label="Warehouse Assignment"
                name="warehouseId"
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  setPage(1);
                }}
                options={warehouses.map((w) => ({
                  value: w.id,
                  label: `${w.name} (${w.shortCode})`,
                }))}
                placeholder="All Warehouses"
              />
            </div>

            <div>
              <Select
                label="Status"
                name="status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
              />
            </div>
          </div>

          {(search || roleId || warehouseId || status) && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-200/60">
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setRoleId('');
                  setWarehouseId('');
                  setStatus('');
                  setPage(1);
                }}
                className="font-medium text-blue-600 hover:text-blue-700 underline"
              >
                Clear all filters
              </button>
              {isFetching && !isLoading && (
                <span className="font-medium text-blue-600 animate-pulse">
                  Updating user list...
                </span>
              )}
            </div>
          )}
        </div>

        {!mayManage ? (
          <EmptyState
            title="Access Restricted"
            description="You do not have administrative permission to view or manage user accounts."
          />
        ) : isLoading ? (
          <LoadingState />
        ) : isError ? (
          <div className="p-6">
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={data?.items}
              empty={
                <EmptyState
                  title="No users found"
                  description="No registered users match the active filter criteria."
                />
              }
            />
            <Pagination
              pagination={data?.pagination}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </Card>

      {/* Create User Modal */}
      <Modal
        open={createModalOpen}
        title="Add New User"
        onClose={() => {
          setCreateModalOpen(false);
          setCreateWarehouseSearch('');
        }}
        size="md"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setCreateModalOpen(false);
                setCreateWarehouseSearch('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateSubmit}
              busy={createUserMutation.isPending}
            >
              Create User
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <TextInput
            label="Full Name"
            name="name"
            required
            value={formValues.name}
            onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
            placeholder="e.g. Rahul Sharma"
          />

          <TextInput
            label="Email Address"
            name="email"
            type="email"
            required
            value={formValues.email}
            onChange={(e) => setFormValues({ ...formValues, email: e.target.value })}
            placeholder="e.g. rahul@example.com"
          />

          <TextInput
            label="Initial Password"
            name="password"
            type="password"
            required
            value={formValues.password}
            onChange={(e) => setFormValues({ ...formValues, password: e.target.value })}
            placeholder="Minimum 8 characters"
            hint="User can change this password after their first login."
          />

          <Select
            label="System Role"
            name="roleId"
            required
            value={formValues.roleId}
            onChange={(e) => setFormValues({ ...formValues, roleId: e.target.value })}
            options={roles.map((r) => ({
              value: r.id,
              label: r.name.replace(/_/g, ' '),
            }))}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Warehouse Access
            </label>
            {!isSelectedRoleScoped ? (
              <p className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                {selectedRole?.name === ROLES.ADMIN ? 'Administrators' : 'Inventory Managers'} have
                unrestricted system-wide access across all warehouses automatically.
              </p>
            ) : (
              <WarehousePicker
                warehouses={warehouses}
                selectedWarehouseIds={formValues.warehouseIds}
                onChange={(newIds) => setFormValues({ ...formValues, warehouseIds: newIds })}
                searchTerm={createWarehouseSearch}
                onSearchChange={setCreateWarehouseSearch}
              />
            )}
          </div>

          <Select
            label="Account Status"
            name="status"
            value={formValues.status}
            onChange={(e) => setFormValues({ ...formValues, status: e.target.value })}
            options={[
              { value: 'ACTIVE', label: 'Active (Permitted to log in)' },
              { value: 'INACTIVE', label: 'Inactive (Disabled)' },
            ]}
          />
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        open={editModalOpen}
        title={`Edit Access — ${selectedUser?.name || selectedUser?.email || 'User'}`}
        onClose={() => {
          setEditModalOpen(false);
          setWarehouseSearch('');
        }}
        size="md"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setEditModalOpen(false);
                setWarehouseSearch('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleEditSubmit}
              busy={updateUserMutation.isPending}
            >
              Save Changes
            </Button>
          </div>
        }
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <TextInput
            label="Email Address"
            name="email"
            value={formValues.email}
            disabled
            hint="Email addresses cannot be changed once created."
          />

          <TextInput
            label="Full Name"
            name="name"
            value={formValues.name}
            onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
          />

          <Select
            label="System Role"
            name="roleId"
            value={formValues.roleId}
            onChange={(e) => setFormValues({ ...formValues, roleId: e.target.value })}
            options={roles.map((r) => ({
              value: r.id,
              label: r.name.replace(/_/g, ' '),
            }))}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Warehouse Access
            </label>
            {!isSelectedRoleScoped ? (
              <p className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                {selectedRole?.name === ROLES.ADMIN ? 'Administrators' : 'Inventory Managers'} have
                unrestricted system-wide access across all warehouses automatically.
              </p>
            ) : (
              <WarehousePicker
                warehouses={warehouses}
                selectedWarehouseIds={formValues.warehouseIds}
                onChange={(newIds) => setFormValues({ ...formValues, warehouseIds: newIds })}
                searchTerm={warehouseSearch}
                onSearchChange={setWarehouseSearch}
              />
            )}
          </div>

          <Select
            label="Account Status"
            name="status"
            value={formValues.status}
            onChange={(e) => setFormValues({ ...formValues, status: e.target.value })}
            options={[
              { value: 'ACTIVE', label: 'Active (Permitted to log in)' },
              { value: 'INACTIVE', label: 'Inactive (Revoke access)' },
            ]}
          />

          {selectedUser?.id === currentUser?.id && (
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
              <strong>Notice:</strong> You are editing your own account. Changing your role or
              deactivating yourself may immediately alter your administrative session.
            </div>
          )}
        </form>
      </Modal>
    </AppShell>
  );
}
