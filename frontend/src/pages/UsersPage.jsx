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
  Checkbox,
  Button,
  fieldErrors,
} from '../components/ui';
import { useToast } from '../components/Toast';

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
    setEditModalOpen(true);
  };

  const handleWarehouseToggle = (whId) => {
    setFormValues((prev) => {
      const exists = prev.warehouseIds.includes(whId);
      return {
        ...prev,
        warehouseIds: exists
          ? prev.warehouseIds.filter((id) => id !== whId)
          : [...prev.warehouseIds, whId],
      };
    });
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
        onClose={() => setCreateModalOpen(false)}
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCreateModalOpen(false)}>
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
              <div className="space-y-2 rounded-xl border border-slate-200 p-3 bg-slate-50/50 max-h-48 overflow-y-auto">
                {warehouses.length === 0 ? (
                  <p className="text-xs text-slate-500">No active warehouses available.</p>
                ) : (
                  warehouses.map((wh) => (
                    <Checkbox
                      key={wh.id}
                      name={`wh-${wh.id}`}
                      label={`${wh.name} (${wh.shortCode})`}
                      checked={formValues.warehouseIds.includes(wh.id)}
                      onChange={() => handleWarehouseToggle(wh.id)}
                    />
                  ))
                )}
              </div>
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
        onClose={() => setEditModalOpen(false)}
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditModalOpen(false)}>
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
              <div className="space-y-2 rounded-xl border border-slate-200 p-3 bg-slate-50/50 max-h-48 overflow-y-auto">
                {warehouses.length === 0 ? (
                  <p className="text-xs text-slate-500">No active warehouses available.</p>
                ) : (
                  warehouses.map((wh) => (
                    <Checkbox
                      key={wh.id}
                      name={`edit-wh-${wh.id}`}
                      label={`${wh.name} (${wh.shortCode})`}
                      checked={formValues.warehouseIds.includes(wh.id)}
                      onChange={() => handleWarehouseToggle(wh.id)}
                    />
                  ))
                )}
              </div>
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
