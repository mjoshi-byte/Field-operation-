import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('mobile'); // 'mobile' | 'code'
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestOtp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.requestOtp(mobile.trim());
      setDevCode(res.dev_code || '');
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.verifyOtp(mobile.trim(), code.trim());
      localStorage.setItem('fo_token', res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#14213d' }}>
      <div style={{ background: 'white', padding: 32, borderRadius: 12, width: 360 }}>
        <h2 style={{ marginTop: 0 }}>FO Training &amp; OJT</h2>
        <p style={{ color: '#555' }}>Sign in with your mobile number.</p>

        {step === 'mobile' && (
          <form onSubmit={requestOtp}>
            <label>Mobile number</label>
            <input
              style={{ width: '100%', marginBottom: 12, boxSizing: 'border-box' }}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="9000000004"
              required
            />
            <button disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Sending…' : 'Send OTP'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify}>
            {devCode && (
              <p style={{ background: '#fffae6', padding: 8, borderRadius: 6, fontSize: 14 }}>
                No SMS gateway configured yet — your OTP is <strong>{devCode}</strong> (also logged on the server console).
              </p>
            )}
            <label>Enter the 6-digit code</label>
            <input
              style={{ width: '100%', marginBottom: 12, boxSizing: 'border-box' }}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
            />
            <button disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button type="button" style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#555' }} onClick={() => setStep('mobile')}>
              Use a different number
            </button>
          </form>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <hr />
        <p style={{ fontSize: 13, color: '#888' }}>
          Sample accounts (seeded): Admin 9000000001 · Trainer 9000000002 · Supervisor 9000000003 · FO 9000000004
        </p>
      </div>
    </div>
  );
}
