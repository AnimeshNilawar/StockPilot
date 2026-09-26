import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { ForgotPassword } from './pages/ForgotPassword';
import { ProtectedRoute } from './components/ProtectedRoute';

function HealthCheck() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health'),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100 max-w-md w-full">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">API Health Status</h1>
        {isLoading && <p className="text-slate-500">Checking health...</p>}
        {isError && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg">
            <p className="font-medium">Error connecting to API</p>
            <p className="text-sm mt-1">{error.message}</p>
          </div>
        )}
        {data && (
          <div className="bg-emerald-50 text-emerald-700 p-4 rounded-lg">
            <p className="font-medium">API is Healthy</p>
            <pre className="text-sm mt-2 p-2 bg-emerald-100/50 rounded overflow-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
            S
          </div>
          <span className="text-xl font-bold tracking-tight">StockPilot</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function Dashboard() {
  return (
    <Layout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Welcome to StockPilot Dashboard</h1>
          <p className="text-slate-600 mb-6">Phase 1 - Auth setup complete. You are logged in.</p>
          <a
            href="/health"
            className="inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            Check API Health
          </a>
        </div>
      </div>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/health" element={<HealthCheck />} />
        
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
