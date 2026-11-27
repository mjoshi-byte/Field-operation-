import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function OJTChecklist({ user }) {
  const [checklist, setChecklist] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.checklist(user.id).then(setChecklist).catch((e) => setError(e.message));
  }

  useEffect(load, [user.id]);

  async function toggle(subcheckId, checked) {
    try {
      await api.toggleSubcheck(user.id, subcheckId, checked);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function submitDay(dayId) {
    setBusy(true);
    try {
      await api.submitDay(user.id, dayId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (!checklist) return <p>Loading…</p>;

  return (
    <div>
      <h2>Five-day OJT checklist</h2>
      {checklist.map((day) => (
        <DayCard key={day.id} day={day} onToggle={toggle} onSubmit={() => submitDay(day.id)} busy={busy} />
      ))}
    </div>
  );
}

function DayCard({ day, onToggle, onSubmit, busy }) {
  const status = day.progress.status;
  const locked = status === 'locked';
  const allDone = day.items.every((i) => i.done);
  const canSubmit = !locked && allDone && (status === 'in_progress' || status === 'needs_redo');

  return (
    <div style={{ ...cardStyle, opacity: locked ? 0.55 : 1, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{day.title}</h3>
        <StatusBadge status={status} />
      </div>

      {locked && <p style={{ color: '#888' }}>Complete the previous day first.</p>}

      {!locked && day.progress.reviewer_comment && status === 'needs_redo' && (
        <div style={{ background: '#fff3cd', padding: 10, borderRadius: 6, margin: '10px 0' }}>
          <strong>Needs redo:</strong> {day.progress.reviewer_comment}
          {day.progress.redo_count >= 2 && <p style={{ margin: '6px 0 0' }}>This day has already been sent back twice.</p>}
        </div>
      )}

      {!locked &&
        day.items.map((item) => (
          <div key={item.id} style={{ marginTop: 12 }}>
            <strong>
              {item.title} {item.done && '✅'}
            </strong>
            <ul style={{ listStyle: 'none', paddingLeft: 8 }}>
              {item.subchecks.map((sc) => (
                <li key={sc.id} style={{ margin: '4px 0' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={sc.checked}
                      disabled={status === 'approved' || status === 'submitted'}
                      onChange={(e) => onToggle(sc.id, e.target.checked)}
                    />
                    {sc.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {canSubmit && (
        <button disabled={busy} onClick={onSubmit} style={{ marginTop: 12 }}>
          Submit day for review
        </button>
      )}
      {status === 'submitted' && <p style={{ color: '#666' }}>Waiting for trainer/supervisor review.</p>}
      {status === 'approved' && <p style={{ color: 'green' }}>Approved ✅</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    locked: ['Locked', '#ddd', '#555'],
    in_progress: ['In progress', '#dbe9ff', '#1b4b91'],
    submitted: ['Submitted', '#fff3cd', '#8a6d00'],
    approved: ['Approved', '#d4f5dd', '#146c2e'],
    needs_redo: ['Needs redo', '#fde0e0', '#9b1c1c'],
  };
  const [label, bg, color] = map[status] || [status, '#eee', '#333'];
  return (
    <span style={{ background: bg, color, padding: '4px 10px', borderRadius: 20, fontSize: 13 }}>{label}</span>
  );
}

const cardStyle = { background: 'white', borderRadius: 10, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
