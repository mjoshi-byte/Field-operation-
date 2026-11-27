import React, { useState } from 'react';
import { supabase } from '../supabaseClient.js';

// Email sign-in via Supabase Auth magic link — no password to manage. Supabase emails
// a link; clicking it redirects back here already signed in, and App.jsx's
// onAuthStateChange listener picks up the new session automatically.
export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendLink(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#14213d' }}>
      <div style={{ background: 'white', padding: 32, borderRadius: 12, width: 380 }}>
        <h2 style={{ marginTop: 0 }}>FO Training &amp; OJT</h2>
        <p style={{ color: '#555' }}>Sign in with your email — we'll send you a one-click link.</p>

        {!sent ? (
          <form onSubmit={sendLink}>
            <label>Email address</label>
            <input
              type="email"
              style={{ width: '100%', marginBottom: 12, boxSizing: 'border-box' }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
            <button disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        ) : (
          <div style={{ background: '#eefbf1', padding: 12, borderRadius: 8 }}>
            <p style={{ margin: 0 }}>
              Check <strong>{email}</strong> for a sign-in link. Open it on this device to continue.
            </p>
          </div>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <hr />
        <p style={{ fontSize: 13, color: '#888' }}>
          First time signing in? An account is created automatically from your email. Admins can add FOs/trainers by
          email from the Admin page once signed in.
        </p>
      </div>
    </div>
  );
}
