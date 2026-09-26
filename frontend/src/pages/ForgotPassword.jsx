import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState(1);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const handleForgot = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/forgot-password', { email });
      setStep(2);
      setMessage('OTP sent if email exists.');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/verify-otp', { email, otp });
      setResetToken(res.data.resetToken);
      setStep(3);
      setMessage('OTP verified. Set your new password.');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/reset-password', { resetToken, newPassword });
      navigate('/login');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100 max-w-sm w-full">
        <h1 className="text-2xl font-bold text-slate-800 mb-6 text-center">Reset Password</h1>
        {error && <div className="mb-4 text-red-600 text-sm">{error}</div>}
        {message && <div className="mb-4 text-emerald-600 text-sm">{message}</div>}
        
        {step === 1 && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input type="email" className="w-full border rounded-lg px-3 py-2" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2">Send OTP</button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Enter OTP</label>
              <input type="text" className="w-full border rounded-lg px-3 py-2" value={otp} onChange={e => setOtp(e.target.value)} required />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2">Verify</button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">New Password</label>
              <input type="password" className="w-full border rounded-lg px-3 py-2" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2">Reset Password</button>
          </form>
        )}
        
        <div className="mt-4 text-sm text-center">
          <Link to="/login" className="text-blue-600 hover:underline">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
