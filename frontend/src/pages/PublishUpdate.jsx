import React, { useState } from 'react';
import { api } from '../api.js';

const LANGS = ['en', 'hi', 'kn', 'te', 'mr'];

export default function PublishUpdate() {
  const [kind, setKind] = useState('update');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [passMark, setPassMark] = useState(80);
  const [retakes, setRetakes] = useState(1);
  const [audienceType, setAudienceType] = useState('all');
  const [audienceCity, setAudienceCity] = useState('');
  const [files, setFiles] = useState([{ language: 'en', file_type: 'pdf', file_url: '' }]);
  const [questions, setQuestions] = useState([
    { language: 'en', question_text: '', options: ['', ''], correct_index: 0 },
  ]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function updateFile(i, patch) {
    setFiles(files.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function updateQuestion(i, patch) {
    setQuestions(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function updateOption(qi, oi, value) {
    setQuestions(
      questions.map((q, idx) =>
        idx === qi ? { ...q, options: q.options.map((o, j) => (j === oi ? value : o)) } : q
      )
    );
  }

  async function handleSubmit(e, publish) {
    e.preventDefault();
    setError('');
    setStatus('');
    setBusy(true);
    try {
      const body = {
        title,
        description,
        kind,
        pass_mark: Number(passMark),
        retakes_allowed: Number(retakes),
        audience_type: audienceType,
        audience_city: audienceType === 'city' ? audienceCity : undefined,
        files: kind === 'update' ? files.filter((f) => f.file_url) : [],
        questions: questions
          .filter((q) => q.question_text)
          .map((q) => ({ ...q, options: q.options.filter((o) => o) })),
      };
      const res = await api.createUpdate(body);
      if (publish) {
        await api.publishUpdate(res.update.id);
        setStatus('Published and assigned to the audience.');
      } else {
        setStatus('Saved as draft.');
      }
      setTitle('');
      setDescription('');
      setFiles([{ language: 'en', file_type: 'pdf', file_url: '' }]);
      setQuestions([{ language: 'en', question_text: '', options: ['', ''], correct_index: 0 }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h2>Publish an update or quiz</h2>
      <form>
        <label>Type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: '100%', marginBottom: 12 }}>
          <option value="update">Update (with content to read)</option>
          <option value="standalone_quiz">Standalone quiz</option>
        </select>

        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />

        <label>Short description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Pass mark (%)</label>
            <input type="number" value={passMark} onChange={(e) => setPassMark(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Retakes allowed</label>
            <input type="number" value={retakes} onChange={(e) => setRetakes(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <label>Audience</label>
        <select value={audienceType} onChange={(e) => setAudienceType(e.target.value)} style={inputStyle}>
          <option value="all">All FOs</option>
          <option value="city">A city</option>
          <option value="specific">Specific FOs (configure via API)</option>
        </select>
        {audienceType === 'city' && (
          <input placeholder="City name" value={audienceCity} onChange={(e) => setAudienceCity(e.target.value)} style={inputStyle} />
        )}

        {kind === 'update' && (
          <>
            <h3>Files (per language)</h3>
            {files.map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={f.language} onChange={(e) => updateFile(i, { language: e.target.value })}>
                  {LANGS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <select value={f.file_type} onChange={(e) => updateFile(i, { file_type: e.target.value })}>
                  {['pdf', 'slide', 'video', 'document', 'image'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  placeholder="https://…"
                  value={f.file_url}
                  onChange={(e) => updateFile(i, { file_url: e.target.value })}
                  style={{ flex: 1 }}
                />
              </div>
            ))}
            <button type="button" onClick={() => setFiles([...files, { language: 'en', file_type: 'pdf', file_url: '' }])}>
              + Add file
            </button>
          </>
        )}

        <h3>Quiz questions</h3>
        {questions.map((q, qi) => (
          <div key={qi} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <select value={q.language} onChange={(e) => updateQuestion(qi, { language: e.target.value })}>
              {LANGS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <input
              placeholder="Question text"
              value={q.question_text}
              onChange={(e) => updateQuestion(qi, { question_text: e.target.value })}
              style={inputStyle}
            />
            {q.options.map((opt, oi) => (
              <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <input
                  type="radio"
                  name={`correct-${qi}`}
                  checked={q.correct_index === oi}
                  onChange={() => updateQuestion(qi, { correct_index: oi })}
                />
                <input
                  placeholder={`Option ${oi + 1}`}
                  value={opt}
                  onChange={(e) => updateOption(qi, oi, e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            ))}
            <button type="button" onClick={() => updateQuestion(qi, { options: [...q.options, ''] })}>
              + Option
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setQuestions([...questions, { language: 'en', question_text: '', options: ['', ''], correct_index: 0 }])}
        >
          + Add question
        </button>

        <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
          <button disabled={busy} onClick={(e) => handleSubmit(e, false)}>Save draft</button>
          <button disabled={busy} onClick={(e) => handleSubmit(e, true)} style={{ background: '#146c2e', color: 'white' }}>
            Save &amp; Publish
          </button>
        </div>
      </form>
      {status && <p style={{ color: 'var(--color-success)' }}>{status}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  );
}

const inputStyle = { width: '100%', marginBottom: 12, boxSizing: 'border-box' };
