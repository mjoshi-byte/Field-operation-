import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'kn', label: 'Kannada' },
  { value: 'te', label: 'Telugu' },
  { value: 'mr', label: 'Marathi' },
];
const FILE_TYPES = ['pdf', 'slide', 'video', 'document', 'image'];

function guessFileType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slide';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['pdf'].includes(ext)) return 'pdf';
  return 'document';
}

// Just the plain filename, extension stripped — never the folder path, so titles
// stay short and readable even when uploading a whole folder.
function titleFromFile(f) {
  return f.name.replace(/\.[^/.]+$/, '');
}

// For a folder upload, webkitRelativePath looks like "MyFolder/sub/file.pdf" — this
// pulls out just the top-level folder name, used as the Topic so files uploaded
// together stay grouped in the library even though each gets its own title.
// Browsers download .pptx/.ppt/.docx/.doc/.xlsx straight away instead of previewing
// them (there's no native viewer), so route those through Google's viewer, which
// renders them in a new tab. PDFs, images and videos already preview fine as-is.
function viewableUrl(fileUrl, fileType, filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const officeExt = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx'];
  if (fileType === 'slide' || officeExt.includes(ext)) {
    return `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;
  }
  return fileUrl;
}

function folderNameFromFile(f) {
  if (!f.webkitRelativePath) return null;
  const parts = f.webkitRelativePath.split('/');
  return parts.length > 1 ? parts[0] : null;
}

// Recognizes a trailing language word on a filename — "qc-sop_Hindi", "Field Officer
// SOP - Kannada", "doc (Marathi)" — however it's separated (_ / - / " - " / spaces /
// parens). Returns the base title with that word stripped, plus the language code,
// so "qc-sop" and "qc-sop_Hindi" are recognized as the same document in two languages
// instead of two separate library entries.
const LANGUAGE_WORDS = { english: 'en', hindi: 'hi', kannada: 'kn', telugu: 'te', marathi: 'mr' };
function detectLanguageAndBase(nameNoExt) {
  const m = nameNoExt.match(/^(.*?)[\s_-]+\(?(english|hindi|kannada|telugu|marathi)\)?\s*$/i);
  if (m) {
    return { base: m[1].trim(), lang: LANGUAGE_WORDS[m[2].toLowerCase()] };
  }
  return { base: nameNoExt.trim(), lang: null }; // null = use the language dropdown's selection
}

export default function Library({ user }) {
  const isStaff = ['admin', 'supervisor', 'trainer'].includes(user.role);
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('en');
  const [fileType, setFileType] = useState('pdf');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [formError, setFormError] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [views, setViews] = useState(null);
  const [viewsError, setViewsError] = useState('');

  function load() {
    api.listLibrary(q ? { q } : {}).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }

  useEffect(load, [q]);

  async function handleOpen(item) {
    if (user.role === 'fo') {
      api.markLibraryViewed(item.id).catch(() => {});
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, viewed: true } : it)));
    }
  }

  async function uploadOne(f) {
    // Small files go through our API; anything over ~4MB (videos, big decks) uploads
    // straight to storage from the browser so it isn't limited by Vercel's function
    // body-size cap.
    const SMALL_FILE_LIMIT = 4 * 1024 * 1024;
    return f.size <= SMALL_FILE_LIMIT ? api.uploadLibraryFile(f) : api.uploadLibraryFileDirect(f);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setFormError('');
    if (files.length === 0) return setFormError('Choose at least one file (or a folder) to upload');
    if (files.length === 1 && !title.trim()) return setFormError('Title is required');
    setUploading(true);
    setUploadProgress('');
    try {
      // One file selected with a title typed in → single library item, as before.
      // Multiple files (or a whole folder) → upload every file, then group files that
      // share the same base title (after stripping a trailing language word like
      // "_Hindi") into ONE library item with several language versions attached,
      // instead of a separate card per file.
      const multi = files.length > 1;
      if (!multi) {
        const f = files[0];
        setUploadProgress(`Uploading ${f.name}`);
        const { file_url } = await uploadOne(f);
        await api.addLibraryItem({
          title: title.trim(),
          topic: topic.trim() || folderNameFromFile(f) || null,
          files: [{ language, file_type: guessFileType(f.name) || fileType, file_url }],
        });
      } else {
        const groups = new Map(); // base title (lowercased) -> { title, topic, files: [] }
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setUploadProgress(`Uploading ${i + 1} of ${files.length}: ${f.name}`);
          const { file_url } = await uploadOne(f);
          const { base, lang } = detectLanguageAndBase(titleFromFile(f));
          const key = base.toLowerCase();
          if (!groups.has(key)) {
            groups.set(key, { title: base, topic: topic.trim() || folderNameFromFile(f) || null, files: [] });
          }
          groups.get(key).files.push({
            language: lang || language,
            file_type: guessFileType(f.name) || fileType,
            file_url,
          });
        }
        for (const group of groups.values()) {
          await api.addLibraryItem(group);
        }
      }
      setTitle('');
      setTopic('');
      setLanguage('en');
      setFileType('pdf');
      setFiles([]);
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  async function toggleViews(item) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    setViews(null);
    setViewsError('');
    try {
      const r = await api.libraryViews(item.id);
      setViews(r.views);
    } catch (err) {
      setViewsError(err.message);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteLibraryItem(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleMark(item, foId, nextViewed) {
    await api.markLibraryView(item.id, foId, nextViewed);
    setViews((prev) =>
      prev.map((v) => (v.fo_id === foId ? { ...v, viewed_at: nextViewed ? new Date().toISOString() : null } : v))
    );
  }

  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2>Content library</h2>
        {isStaff && <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ Add content'}</button>}
      </div>

      {isStaff && showForm && (
        <form
          onSubmit={handleAdd}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            display: 'grid',
            gap: 10,
          }}
        >
          <div>
            <label>Title{files.length > 1 ? ' (ignored — using each file’s name)' : ''}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rig handling SOP"
              disabled={files.length > 1}
            />
          </div>
          <div>
            <label>Topic (optional)</label>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Rig handling" />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label>Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ width: '100%' }}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>File type</label>
              <select value={fileType} onChange={(e) => setFileType(e.target.value)} style={{ width: '100%' }}>
                {FILE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label>File(s)</label>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '6px 0 0' }}>
              Hold Ctrl/Cmd to pick several files at once, or use the folder picker below to upload
              every file inside a folder.
            </p>
          </div>
          <div>
            <label>Or upload a whole folder</label>
            <input
              type="file"
              // non-standard attributes; browsers (Chrome/Edge/Firefox) support this to pick a folder
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </div>
          {files.length > 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              {files.length} file{files.length > 1 ? 's' : ''} selected
              {files.length > 1 ? ' — each becomes its own library entry.' : '.'}
            </p>
          )}
          {uploading && uploadProgress && (
            <p style={{ fontSize: 13, color: 'var(--color-accent)', margin: 0 }}>{uploadProgress}</p>
          )}
          {formError && <p style={{ color: 'var(--color-danger)', margin: 0 }}>{formError}</p>}
          <button disabled={uploading} type="submit">{uploading ? 'Uploading…' : 'Upload & add'}</button>
        </form>
      )}

      <input
        placeholder="Search topics or titles…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', marginBottom: 16, boxSizing: 'border-box' }}
      />
      {!items && <p>Loading…</p>}
      {items && items.length === 0 && <p>No content yet.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {items?.map((item) => (
          <div
            key={item.id}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: 14,
            }}
          >
            <h4 style={{ margin: '0 0 6px' }}>{item.title}</h4>
            {item.topic && <p style={{ color: 'var(--color-text-muted)', margin: '0 0 8px' }}>{item.topic}</p>}
            {item.file ? (
              <>
                <a
                  href={viewableUrl(item.file.file_url, item.file.file_type, item.file.file_url)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => handleOpen(item)}
                >
                  Open ({item.file.file_type})
                </a>
                {item.used_fallback && (
                  <p style={{ color: 'var(--color-cta)', fontSize: 13 }}>Not available in your language — showing English.</p>
                )}
                {user.role === 'fo' && (
                  <p style={{ fontSize: 13, color: item.viewed ? 'var(--color-success)' : 'var(--color-text-muted)', margin: '6px 0 0' }}>
                    {item.viewed ? '✓ Watched' : 'Not watched yet'}
                  </p>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--color-text-muted)' }}>No file attached</p>
            )}
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Updated {new Date(item.updated_at).toLocaleDateString()}
            </p>

            {isStaff && (
              <>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => toggleViews(item)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                      fontSize: 13,
                      minHeight: 32,
                      padding: '0 10px',
                    }}
                  >
                    {expandedId === item.id ? 'Hide watch status' : 'Watch status'}
                  </button>
                  <button
                    onClick={() => handleDelete(item)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-danger)',
                      color: 'var(--color-danger)',
                      fontSize: 13,
                      minHeight: 32,
                      padding: '0 10px',
                    }}
                  >
                    Delete
                  </button>
                </div>

                {expandedId === item.id && (
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                    {viewsError && <p style={{ color: 'var(--color-danger)' }}>{viewsError}</p>}
                    {!views && !viewsError && <p>Loading…</p>}
                    {views && views.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No FOs yet.</p>}
                    {views &&
                      views.map((v) => (
                        <div
                          key={v.fo_id}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}
                        >
                          <span style={{ fontSize: 14 }}>
                            {v.name} {v.city ? `(${v.city})` : ''} —{' '}
                            <span style={{ color: v.viewed_at ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                              {v.viewed_at ? 'watched' : 'not watched'}
                            </span>
                          </span>
                          <button
                            onClick={() => toggleMark(item, v.fo_id, !v.viewed_at)}
                            style={{ fontSize: 12, minHeight: 28, padding: '0 8px' }}
                          >
                            {v.viewed_at ? 'Unmark' : 'Mark watched'}
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
