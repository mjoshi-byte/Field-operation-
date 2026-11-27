import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function TrainerOverview() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  function load() {
    api.ojtOverview().then((r) => setOverview(r.overview)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (!overview) return <p>Loading…</p>;

  return (
    <div>
      <h2>OJT overview</h2>
      <p style={{ color: '#666' }}>Who's on which day, who's waiting for review, who's been sent back, who's finished.</p>
      {overview.map((row) => (
        <div key={row.fo.id} style={{ background: 'white', borderRadius: 10, padding: 14, marginBottom: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{row.fo.name}</strong> — {row.fo.city || 'no city'}{' '}
              {row.fo.status !== 'active' && <span style={{ color: 'crimson' }}>({row.fo.status})</span>}
            </div>
            <div>
              Day: {row.currentDay ?? '—'} · Approved {row.approvedCount}/{row.totalDays}
              <button style={{ marginLeft: 12 }} onClick={() => setExpanded(expanded === row.fo.id ? null : row.fo.id)}>
                {expanded === row.fo.id ? 'Hide' : 'Review'}
              </button>
            </div>
          </div>
          {expanded === row.fo.id && <ReviewPanel foId={row.fo.id} days={row.days} onDone={load} />}
        </div>
      ))}
    </div>
  );
}

function ReviewPanel({ foId, days, onDone }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submittedDay = days.find((d) => d.status === 'submitted');

  async function decide(decision) {
    if (!submittedDay) return;
    setBusy(true);
    try {
      // Need day id — fetch from checklist since overview only has day_number
      const checklist = await api.checklist(foId);
      const match = checklist.find((d) => d.day_number === submittedDay.day_number);
      await api.reviewDay(foId, match.id, decision, comment);
      setComment('');
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          {days.map((d) => (
            <tr key={d.day_number} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: 6 }}>{d.title}</td>
              <td style={{ padding: 6 }}>{d.status || 'locked'}</td>
              <td style={{ padding: 6, color: '#888' }}>{d.reviewer_comment || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {submittedDay ? (
        <>
          <p>
            <strong>{submittedDay.title}</strong> is waiting for review.
          </p>
          <textarea
            placeholder="Comment (required for Needs redo)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ width: '100%', minHeight: 60, marginBottom: 8, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={() => decide('approved')} style={{ background: '#146c2e', color: 'white' }}>
              Approve
            </button>
            <button disabled={busy} onClick={() => decide('needs_redo')} style={{ background: '#9b1c1c', color: 'white' }}>
              Needs redo
            </button>
          </div>
        </>
      ) : (
        <p style={{ color: '#888' }}>Nothing currently waiting for review.</p>
      )}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}
