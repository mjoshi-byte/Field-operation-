import { supabase } from './supabaseClient.js';

// In local dev, Vite's dev-server proxy (vite.config.js) forwards /api/* to
// http://localhost:4000, so the relative path works. In production on Vercel the
// frontend and backend are two separate deployments, so VITE_API_BASE must point at
// the backend's full URL (e.g. https://your-backend.vercel.app/api).
const BASE = import.meta.env.VITE_API_BASE || '/api';

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  // auth — actual sign-in/out happens via Supabase (see Login.jsx); this just fetches
  // the app-level user row that matches the signed-in Supabase account.
  me: () => request('/auth/me'),

  // users
  listUsers: (params = {}) => request('/users?' + new URLSearchParams(params)),
  addUser: (body) => request('/users', { method: 'POST', body }),
  moveStage: (id, stage) => request(`/users/${id}/move-stage`, { method: 'POST', body: { stage } }),
  hold: (id, reason) => request(`/users/${id}/hold`, { method: 'POST', body: { reason } }),
  releaseHold: (id) => request(`/users/${id}/release-hold`, { method: 'POST' }),

  // OJT
  checklist: (foId) => request(`/ojt/${foId}/checklist`),
  toggleSubcheck: (foId, subcheckId, checked) =>
    request(`/ojt/${foId}/subcheck/${subcheckId}`, { method: 'POST', body: { checked } }),
  submitDay: (foId, dayId) => request(`/ojt/${foId}/days/${dayId}/submit`, { method: 'POST' }),
  reviewDay: (foId, dayId, decision, comment) =>
    request(`/ojt/${foId}/days/${dayId}/review`, { method: 'POST', body: { decision, comment } }),
  ojtOverview: () => request('/ojt/overview/all'),
  ojtEligible: (foId) => request(`/ojt/${foId}/eligible`),

  // updates
  listUpdates: (params = {}) => request('/updates?' + new URLSearchParams(params)),
  getUpdate: (id) => request(`/updates/${id}`),
  createUpdate: (body) => request('/updates', { method: 'POST', body }),
  publishUpdate: (id) => request(`/updates/${id}/publish`, { method: 'POST' }),
  withdrawUpdate: (id) => request(`/updates/${id}/withdraw`, { method: 'POST' }),
  myUpdates: (foId) => request(`/updates/mine/${foId}`),
  openUpdate: (id, foId) => request(`/updates/${id}/open/${foId}`, { method: 'POST' }),
  acknowledgeUpdate: (id, foId) => request(`/updates/${id}/acknowledge/${foId}`, { method: 'POST' }),
  submitQuiz: (id, foId, answers) => request(`/updates/${id}/quiz/submit/${foId}`, { method: 'POST', body: { answers } }),

  // library
  listLibrary: (params = {}) => request('/library?' + new URLSearchParams(params)),
  addLibraryItem: (body) => request('/library', { method: 'POST', body }),
  // Small-file path (goes through our backend). Keep for files comfortably under ~4MB.
  uploadLibraryFile: async (file) => {
    const token = await getToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(BASE + '/library/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data; // { file_url }
  },
  // Large-file path: get a one-time signed URL from the backend, then upload the file
  // bytes straight to Supabase Storage from the browser — bypasses Vercel's serverless
  // body-size limit entirely, so this works for videos and large decks.
  uploadLibraryFileDirect: async (file, onProgress) => {
    const { path, token: uploadToken, file_url } = await request('/library/upload-url', {
      method: 'POST',
      body: { filename: file.name },
    });
    const { error } = await supabase.storage.from('library-files').uploadToSignedUrl(path, uploadToken, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (error) throw new Error(error.message || 'Upload to storage failed');
    if (onProgress) onProgress(100);
    return { file_url };
  },
  markLibraryViewed: (id) => request(`/library/${id}/view`, { method: 'POST' }),
  libraryViews: (id) => request(`/library/${id}/views`),
  markLibraryView: (id, foId, viewed) => request(`/library/${id}/mark/${foId}`, { method: 'PUT', body: { viewed } }),

  // dashboard
  foDashboard: (id) => request(`/dashboard/fo/${id}`),
  teamDashboard: (params = {}) => request('/dashboard/team?' + new URLSearchParams(params)),
  leaderboard: (stage) => request(`/dashboard/leaderboard/${stage}`),
  notifications: () => request('/dashboard/notifications'),
  auditLog: () => request('/dashboard/audit'),

  // CSV export needs the auth header (it's a protected route), so a plain <a href>
  // won't work — fetch it with the token attached, then trigger a browser download.
  downloadUpdatesCsv: async () => {
    const token = await getToken();
    const res = await fetch(BASE + '/dashboard/export/updates.csv', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Could not download CSV (' + res.status + ')');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'updates-export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
