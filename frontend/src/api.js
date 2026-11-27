const BASE = '/api';

function getToken() {
  return localStorage.getItem('fo_token');
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
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
  // auth
  requestOtp: (mobile_number) => request('/auth/request-otp', { method: 'POST', body: { mobile_number }, auth: false }),
  verifyOtp: (mobile_number, code) => request('/auth/verify-otp', { method: 'POST', body: { mobile_number, code }, auth: false }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),

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

  // dashboard
  foDashboard: (id) => request(`/dashboard/fo/${id}`),
  teamDashboard: (params = {}) => request('/dashboard/team?' + new URLSearchParams(params)),
  leaderboard: (stage) => request(`/dashboard/leaderboard/${stage}`),
  notifications: () => request('/dashboard/notifications'),
  auditLog: () => request('/dashboard/audit'),
};
