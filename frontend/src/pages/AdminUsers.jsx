import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', city: '', preferred_language: 'en', role: 'fo', stage: 'ojt' });
  const [busy, setBusy] = useState(false);

  function load() {
    api.listUsers().then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function addUser(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.addUser(form);
      setForm({ name: '', email: '', city: '', preferred_language: 'en', role: 'fo', stage: 'ojt' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function move(id, stage) {
    await api.moveStage(id, stage);
    load();
  }
  async function hold(id) {
    const reason = prompt('Reason for hold?') || '';
    await api.hold(id, reason);
    load();
  }
  async function release(id) {
    await api.releaseHold(id);
    load();
  }

  return (
    <div>
      <h2>Admin — people</h2>

      <form onSubmit={addUser} style={{ background: 'white', padding: 16, borderRadius: 10, marginBottom: 20, maxWidth: 500 }}>
        <h3 style={{ marginTop: 0 }}>Add new hire / staff</h3>
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={inputStyle} />
        <input type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required style={inputStyle} />
        <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={inputStyle} />
        <select value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })} style={inputStyle}>
          {['en', 'hi', 'kn', 'te', 'mr'].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle}>
          <option value="fo">FO</option>
          <option value="trainer">Trainer</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Admin</option>
        </select>
        {form.role === 'fo' && (
          <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} style={inputStyle}>
            <option value="ojt">Start in OJT</option>
            <option value="production">Start directly in Production</option>
          </select>
        )}
        <button disabled={busy}>Add</button>
      </form>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!users && <p>Loading…</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
            <th style={th}>Name</th><th style={th}>Role</th><th style={th}>Stage</th><th style={th}>Status</th><th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={td}>{u.name} <span style={{ color: '#999' }}>({u.email})</span></td>
              <td style={td}>{u.role}</td>
              <td style={td}>{u.stage || '—'}</td>
              <td style={td}>{u.status}</td>
              <td style={td}>
                {u.role === 'fo' && u.stage === 'ojt' && <button onClick={() => move(u.id, 'production')}>Move to Production</button>}
                {u.role === 'fo' && u.stage === 'production' && <button onClick={() => move(u.id, 'ojt')}>Move to OJT</button>}
                {u.status === 'active' || u.status === 'retraining' ? (
                  <button onClick={() => hold(u.id)} style={{ marginLeft: 8 }}>Hold</button>
                ) : (
                  <button onClick={() => release(u.id)} style={{ marginLeft: 8 }}>Release hold</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inputStyle = { width: '100%', marginBottom: 10, boxSizing: 'border-box' };
const th = { padding: 8 };
const td = { padding: 8 };
