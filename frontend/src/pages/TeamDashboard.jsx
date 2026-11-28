import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function TeamDashboard() {
  const [data, setData] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [stage, setStage] = useState('ojt');
  const [error, setError] = useState('');

  useEffect(() => {
    api.teamDashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api.leaderboard(stage).then((r) => setLeaderboard(r.leaderboard)).catch((e) => setError(e.message));
  }, [stage]);

  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return <p>Loading…</p>;

  const { fosAtAGlance, updateStats, late, quizAnalytics } = data;

  return (
    <div>
      <h2>Team dashboard</h2>

      <div style={grid}>
        <div style={card('var(--color-success)')}>
          <h3>FOs at a glance</h3>
          <table style={table}>
            <tbody>
              {fosAtAGlance.map((f) => (
                <tr key={f.id}><td style={td}>{f.name}</td><td style={td}>{f.city}</td><td style={td}>{f.stage}</td><td style={td}>{f.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={card('var(--color-danger)')}>
          <h3>Who's late</h3>
          {late.length === 0 && <p>Nobody overdue 🎉</p>}
          <table style={table}>
            <tbody>
              {late.map((l) => (
                <tr key={l.id}><td style={td}>{l.fo_name}</td><td style={td}>{l.title}</td><td style={td}>{l.hours_overdue}h overdue</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...card('var(--color-primary)'), marginTop: 16 }}>
        <h3>Update &amp; quiz stats</h3>
        <table style={table}>
          <thead>
            <tr><th style={th}>Title</th><th style={th}>Assigned</th><th style={th}>Opened</th><th style={th}>Acknowledged</th><th style={th}>Passed</th><th style={th}>Failed</th></tr>
          </thead>
          <tbody>
            {updateStats.map((u) => (
              <tr key={u.id}>
                <td style={td}>{u.title}</td><td style={td}>{u.assigned}</td><td style={td}>{u.opened}</td>
                <td style={td}>{u.acknowledged}</td><td style={td}>{u.passed}</td><td style={td}>{u.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...card(), marginTop: 16 }}>
        <h3>Quiz analytics</h3>
        <p>Average score: {quizAnalytics.avgScore ?? '—'}% · Pass rate: {quizAnalytics.passRate ?? '—'}%</p>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{quizAnalytics.note}</p>
        {quizAnalytics.mostMissed.length > 0 && (
          <>
            <h4>Most-missed questions</h4>
            <ul>{quizAnalytics.mostMissed.map((m) => <li key={m.question_id}>{m.question_text} — missed {m.misses}×</li>)}</ul>
          </>
        )}
      </div>

      <div style={{ ...card(), marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Leaderboard ({stage})</h3>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="ojt">OJT</option>
            <option value="production">Production</option>
          </select>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>OJT and Production have separate leaderboards — no combined view.</p>
        <table style={table}>
          <thead><tr><th style={th}>FO</th><th style={th}>Avg score</th><th style={th}>Quizzes passed</th></tr></thead>
          <tbody>
            {leaderboard?.map((l) => (
              <tr key={l.fo_id}><td style={td}>{l.name}</td><td style={td}>{l.avg_score}%</td><td style={td}>{l.quizzes_passed}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16 }}>
        <a style={{ cursor: 'pointer' }} onClick={() => api.downloadUpdatesCsv()}>Download updates data as spreadsheet (CSV)</a>
      </p>
    </div>
  );
}

const grid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
// These tables sit inside colored cards rather than the page's default styled
// <table>, so give them their own transparent, minimal look instead of the
// global table/thead/tbody styling.
const table = { width: '100%', borderCollapse: 'collapse', background: 'transparent', boxShadow: 'none' };
const th = { textAlign: 'left', padding: 6, borderBottom: '2px solid var(--color-border)', color: 'var(--color-text)', background: 'transparent' };
const td = { padding: 6, borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' };
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
