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
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ToastViewport } from './components/ToastViewport';

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

            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/uoms" element={<UomsPage />} />
              <Route path="/warehouses" element={<WarehousesPage />} />
              <Route path="/warehouses/:warehouseId/locations" element={<LocationsPage />} />
              <Route path="/locations" element={<LocationsPage />} />
              <Route path="/stock" element={<StockBalancesPage />} />
              <Route path="/moves" element={<MoveHistoryPage />} />
              <Route path="/receipts" element={<ReceiptsPage />} />
              <Route path="/receipts/:id" element={<ReceiptDetailPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <ToastViewport />
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
