import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login({ email, password });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100 max-w-sm w-full">
        <h1 className="text-2xl font-bold text-slate-800 mb-6 text-center">Sign in</h1>
        {error && <div className="mb-4 text-red-600 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input 
              type="email" 
              className="w-full border rounded-lg px-3 py-2" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              required 
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input 
              type="password" 
              className="w-full border rounded-lg px-3 py-2" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              required 
            />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700">
            Sign in
          </button>
        </form>
        <div className="mt-4 text-sm text-center">
          <Link to="/forgot-password" className="text-blue-600 hover:underline">Forgot password?</Link>
        </div>
        <div className="mt-2 text-sm text-center">
          Don't have an account? <Link to="/signup" className="text-blue-600 hover:underline">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
