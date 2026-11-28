import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';

// Implements the core loop: open -> read -> Acknowledge (only after opening) -> quiz
// starts right after -> score/pass-fail shown, per the blueprint.
export default function UpdateQuiz({ user }) {
  const { id } = useParams();
  const [update, setUpdate] = useState(null);
  const [opened, setOpened] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lang = user.preferred_language || 'en';

  useEffect(() => {
    api.getUpdate(id).then(setUpdate).catch((e) => setError(e.message));
  }, [id]);

  async function handleOpen() {
    try {
      await api.openUpdate(id, user.id);
      setOpened(true);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAcknowledge() {
    setBusy(true);
    try {
      await api.acknowledgeUpdate(id, user.id);
      setAcknowledged(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitQuiz(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = Object.entries(answers).map(([question_id, selected_index]) => ({
        question_id: Number(question_id),
        selected_index,
      }));
      const res = await api.submitQuiz(id, user.id, payload);
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!update) return <p>Loading…</p>;

  const isUpdateKind = update.update.kind === 'update';
  const files = update.update.files.filter((f) => f.language === lang);
  const fallbackFiles = update.update.files.filter((f) => f.language === 'en');
  const shownFiles = files.length ? files : fallbackFiles;

  const questions = update.update.questions.filter((q) => q.language === lang);
  const shownQuestions = questions.length ? questions : update.update.questions.filter((q) => q.language === 'en');

  const readyForQuiz = !isUpdateKind || acknowledged;

  if (result) {
    return (
      <div style={card}>
        <h2>{result.passed ? 'Passed ✅' : 'Not this time'}</h2>
        <p style={{ fontSize: 24 }}>{result.score_percent}%</p>
        <p>Attempt {result.attempt_number}</p>
        {!result.passed && <p>You've been marked for retraining. Review the material and take the quiz again.</p>}
        <h4>Review</h4>
        <ul>
          {result.graded.map((g) => {
            const q = shownQuestions.find((q) => q.id === g.question_id);
            return (
              <li key={g.question_id} style={{ color: g.correct ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {q?.question_text} — {g.correct ? 'Correct' : 'Incorrect'}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <h2>{update.update.title}</h2>
      {update.update.description && <p>{update.update.description}</p>}

      {isUpdateKind && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Read this {lang !== shownFiles[0]?.language ? '(shown in English — not yet available in your language)' : ''}</h3>
          {shownFiles.length === 0 && <p>No file attached.</p>}
          {shownFiles.map((f) => (
            <p key={f.id}>
              <a href={f.file_url} target="_blank" rel="noreferrer">
                {f.file_type.toUpperCase()}: {f.file_url}
              </a>
            </p>
          ))}

          {!opened && <button onClick={handleOpen}>I've opened this</button>}

          {opened && !acknowledged && (
            <button disabled={busy} onClick={handleAcknowledge} style={{ background: '#146c2e', color: 'white' }}>
              Acknowledge — I have read this
            </button>
          )}
          {acknowledged && <p style={{ color: 'var(--color-success)' }}>Acknowledged ✓</p>}
        </div>
      )}

      {readyForQuiz && (
        <form onSubmit={handleSubmitQuiz} style={{ ...card, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Quiz (pass mark: {update.update.pass_mark}%)</h3>
          {shownQuestions.map((q) => (
            <div key={q.id} style={{ marginBottom: 16 }}>
              <p style={{ fontWeight: 'bold' }}>{q.question_text}</p>
              {q.options.map((opt, idx) => (
                <label key={idx} style={{ display: 'block', margin: '4px 0' }}>
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    checked={answers[q.id] === idx}
                    onChange={() => setAnswers({ ...answers, [q.id]: idx })}
                  />{' '}
                  {opt}
                </label>
              ))}
            </div>
          ))}
          <button disabled={busy || Object.keys(answers).length < shownQuestions.length}>
            Submit quiz
          </button>
        </form>
      )}
    </div>
  );
}

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, color: 'var(--color-text)' };
