import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function FODashboard({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.foDashboard(user.id).then(setData).catch((e) => setError(e.message));
  }, [user.id]);

  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return <p>Loading…</p>;

  const { fo, pendingItems, scoreHistory, progress, ojtSummary } = data;

  return (
    <div>
      <h2>Hi {fo.name.split(' ')[0]} 👋</h2>

      {fo.status === 'on_hold' && (
        <div style={card('var(--color-danger)')}>
          <strong>You're on hold.</strong> {fo.hold_reason && <span>Reason: {fo.hold_reason}.</span>} Please reach out to
          your trainer or supervisor.
        </div>
      )}
      {fo.status === 'retraining' && (
        <div style={card('var(--color-warning)')}>
          <strong>You're marked for retraining.</strong> Review the material again, then retake the quiz.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={card('var(--color-primary)')}>
          <h3 style={{ marginTop: 0 }}>Stage: {fo.stage === 'ojt' ? 'OJT' : 'Production'}</h3>
          {ojtSummary && (
            <>
              <p>
                {ojtSummary.approved} of {ojtSummary.total} OJT days approved
              </p>
              <Link to="/checklist">Go to checklist →</Link>
            </>
          )}
          <p style={{ marginTop: 12 }}>
            Updates completed: {progress.completed} / {progress.total}
          </p>
        </div>

        <div style={card('var(--color-success)')}>
          <h3 style={{ marginTop: 0 }}>To do</h3>
          {pendingItems.length === 0 && <p>Nothing pending — you're all caught up.</p>}
          <ul>
            {pendingItems.map((item) => (
              <li key={item.id}>
                <Link to={`/updates/${item.update_id}`}>{item.title}</Link>{' '}
                {item.overdue ? (
                  <span style={{ color: 'var(--color-danger)' }}>— overdue</span>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)' }}>— {item.hours_remaining}h left</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ ...card(), marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Score history</h3>
        {scoreHistory.length === 0 && <p>No quiz attempts yet.</p>}
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent', boxShadow: 'none' }}>
          <tbody>
            {scoreHistory.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 6 }}>{s.title}</td>
                <td style={{ padding: 6 }}>Attempt {s.attempt_number}</td>
                <td style={{ padding: 6 }}>{s.score_percent}%</td>
                <td style={{ padding: 6, color: s.passed ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {s.passed ? 'Passed' : 'Failed'}
                </td>
                <td style={{ padding: 6, color: 'var(--color-text-muted)' }}>{new Date(s.taken_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function card(accent) {
  return {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderLeft: accent ? `4px solid ${accent}` : '1px solid var(--color-border)',
    borderRadius: 10,
    padding: 16,
    color: 'var(--color-text)',
  };
}
