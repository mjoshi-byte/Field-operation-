import React, { useState } from 'react';
import { supabase } from '../supabaseClient.js';

// Google sign-in via Supabase Auth OAuth. Clicking the button redirects to Google,
// then back here already signed in — App.jsx's onAuthStateChange listener picks up
// the new session automatically.
export default function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setError('');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
      // On success the browser redirects to Google, so no further action here.
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#14213d' }}>
      <div style={{ background: 'white', padding: 32, borderRadius: 12, width: 380 }}>
        <h2 style={{ marginTop: 0 }}>FO Training &amp; OJT</h2>
        <p style={{ color: '#555' }}>Sign in with your Google account to continue.</p>

        <button
          onClick={signInWithGoogle}
          disabled={busy}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid #ddd',
            background: 'white',
            cursor: busy ? 'default' : 'pointer',
            fontSize: 15,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
          </svg>
          {busy ? 'Redirecting…' : 'Sign in with Google'}
        </button>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <hr />
        <p style={{ fontSize: 13, color: '#888' }}>
          First time signing in? An account is created automatically from your Google email. Admins can add
          FOs/trainers by email from the Admin page once signed in.
        </p>
      </div>
    </div>
  );
}
