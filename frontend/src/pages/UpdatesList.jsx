import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function UpdatesList({ user }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user.role === 'fo') {
      api.myUpdates(user.id).then((r) => setItems(r.items)).catch((e) => setError(e.message));
    } else {
      api.listUpdates().then((r) => setItems(r.updates)).catch((e) => setError(e.message));
    }
  }, [user]);

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (!items) return <p>Loading…</p>;

  if (user.role !== 'fo') {
    return (
      <div>
        <h2>Updates &amp; quizzes</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
              <th style={th}>Title</th>
              <th style={th}>Kind</th>
              <th style={th}>Status</th>
              <th style={th}>Published</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={td}>{u.title}</td>
                <td style={td}>{u.kind === 'standalone_quiz' ? 'Standalone quiz' : 'Update'}</td>
                <td style={td}>{u.status}</td>
                <td style={td}>{u.published_at ? new Date(u.published_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <h2>My updates &amp; quizzes</h2>
      {items.length === 0 && <p>Nothing assigned yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => (
          <li
            key={item.id}
            style={{
              background: 'white',
              borderRadius: 10,
              padding: 14,
              marginBottom: 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <Link to={`/updates/${item.update_id}`} style={{ fontWeight: 'bold' }}>
              {item.title}
            </Link>
            <div style={{ color: '#666', fontSize: 14 }}>
              {item.kind === 'standalone_quiz' ? 'Standalone quiz' : 'Update'} · Status: {item.status}{' '}
              {item.overdue ? (
                <span style={{ color: 'crimson' }}>· Overdue</span>
              ) : (
                item.status !== 'passed' && <span>· {item.hours_remaining}h left</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const th = { padding: 8 };
const td = { padding: 8 };
