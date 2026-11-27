import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Library({ user }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.listLibrary(q ? { q } : {}).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }

  useEffect(load, [q]);

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;

  return (
    <div>
      <h2>Content library</h2>
      <input
        placeholder="Search topics or titles…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', marginBottom: 16, boxSizing: 'border-box' }}
      />
      {!items && <p>Loading…</p>}
      {items && items.length === 0 && <p>No content yet.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {items?.map((item) => (
          <div key={item.id} style={{ background: 'white', borderRadius: 10, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <h4 style={{ margin: '0 0 6px' }}>{item.title}</h4>
            {item.topic && <p style={{ color: '#888', margin: '0 0 8px' }}>{item.topic}</p>}
            {item.file ? (
              <>
                <a href={item.file.file_url} target="_blank" rel="noreferrer">
                  Open ({item.file.file_type})
                </a>
                {item.used_fallback && <p style={{ color: '#a66', fontSize: 13 }}>Not available in your language — showing English.</p>}
              </>
            ) : (
              <p style={{ color: '#aaa' }}>No file attached</p>
            )}
            <p style={{ fontSize: 12, color: '#999' }}>Updated {new Date(item.updated_at).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
