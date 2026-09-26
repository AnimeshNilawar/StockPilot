import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { ForgotPassword } from './pages/ForgotPassword';
import { HealthCheck } from './pages/HealthCheck';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { UomsPage } from './pages/UomsPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { LocationsPage } from './pages/LocationsPage';
import { StockBalancesPage } from './pages/StockBalancesPage';
import { MoveHistoryPage } from './pages/MoveHistoryPage';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { ReceiptDetailPage } from './pages/ReceiptDetailPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { DeliveryDetailPage } from './pages/DeliveryDetailPage';
import { InternalTransfersPage } from './pages/InternalTransfersPage';
import { InternalTransferDetailPage } from './pages/InternalTransferDetailPage';
import { AdjustmentsPage } from './pages/AdjustmentsPage';
import { AdjustmentDetailPage } from './pages/AdjustmentDetailPage';
import { UsersPage } from './pages/UsersPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ToastViewport } from './components/ToastViewport';
import { can, isAdmin, isInventoryManager } from './lib/permissions';

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/health" element={<HealthCheck />} />

            {/* Base Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>

            {/* Catalog Routes */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.readProducts(u) || can.writeProducts(u) || isAdmin(u) || isInventoryManager(u)}
                  fallbackMessage="You do not have permission to access the product catalog."
                />
              }
            >
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/uoms" element={<UomsPage />} />
            </Route>

            {/* Warehouse Management Routes */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.readWarehouses(u) || can.writeWarehouses(u) || isAdmin(u) || isInventoryManager(u)}
                  fallbackMessage="You do not have permission to manage warehouses or locations."
                />
              }
            >
              <Route path="/warehouses" element={<WarehousesPage />} />
              <Route path="/warehouses/:warehouseId/locations" element={<LocationsPage />} />
              <Route path="/locations" element={<LocationsPage />} />
            </Route>

            {/* Stock & Movement Ledger */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.readStock(u) || can.viewMoveHistory(u) || can.moveStock(u)}
                  fallbackMessage="You do not have permission to view inventory balances or move history."
                />
              }
            >
              <Route path="/stock" element={<StockBalancesPage />} />
              <Route path="/moves" element={<MoveHistoryPage />} />
            </Route>

            {/* Receipts */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.createReceipt(u) || can.validateReceipt(u)}
                  fallbackMessage="You do not have permission to view or manage receipts."
                />
              }
            >
              <Route path="/receipts" element={<ReceiptsPage />} />
              <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
            </Route>

            {/* Deliveries */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.createDelivery(u) || can.pickDelivery(u) || can.validateDelivery(u)}
                  fallbackMessage="You do not have permission to view or manage deliveries."
                />
              }
            >
              <Route path="/deliveries" element={<DeliveriesPage />} />
              <Route path="/deliveries/:id" element={<DeliveryDetailPage />} />
            </Route>

            {/* Internal Transfers */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.createTransfer(u) || can.validateTransfer(u) || can.readStock(u)}
                  fallbackMessage="You do not have permission to view or perform internal transfers."
                />
              }
            >
              <Route path="/transfers" element={<InternalTransfersPage />} />
              <Route path="/transfers/:id" element={<InternalTransferDetailPage />} />
            </Route>

            {/* Adjustments */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.createAdjustment(u) || can.validateAdjustment(u) || can.readStock(u)}
                  fallbackMessage="You do not have permission to view or perform inventory adjustments."
                />
              }
            >
              <Route path="/adjustments" element={<AdjustmentsPage />} />
              <Route path="/adjustments/:id" element={<AdjustmentDetailPage />} />
            </Route>

            {/* Administration Routes */}
            <Route
              element={
                <ProtectedRoute
                  check={(u) => can.manageUsers(u) || isAdmin(u)}
                  fallbackMessage="You do not have administrative permission to access User & Access Management."
                />
              }
            >
              <Route path="/users" element={<UsersPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <ToastViewport />
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
