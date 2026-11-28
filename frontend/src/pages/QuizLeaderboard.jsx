import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function QuizLeaderboard() {
  const [stage, setStage] = useState('production');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api
      .leaderboard(stage)
      .then((r) => setData(r.leaderboard))
      .catch((e) => setError(e.message));
  }, [stage]);

  function tabStyle(active) {
    return {
      background: active ? 'var(--color-primary-dark)' : 'transparent',
      border: active ? 'none' : '1px solid var(--color-border)',
      color: active ? 'white' : 'var(--color-text)',
    };
  }

  return (
    <div>
      <h2>Quiz leaderboard</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={tabStyle(stage === 'ojt')} onClick={() => setStage('ojt')}>
          OJT
        </button>
        <button style={tabStyle(stage === 'production')} onClick={() => setStage('production')}>
          Production
        </button>
      </div>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && data.length === 0 && <p>No FOs in this stage yet.</p>}
      {data && data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>City</th>
              <th>Avg score</th>
              <th>Quizzes passed</th>
              <th>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={row.fo_id}>
                <td>{i + 1}</td>
                <td>{row.name}</td>
                <td>{row.city || '—'}</td>
                <td>{row.avg_score}%</td>
                <td>{row.quizzes_passed}</td>
                <td>{row.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
