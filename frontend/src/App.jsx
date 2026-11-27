import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';

import Login from './pages/Login.jsx';
import FODashboard from './pages/FODashboard.jsx';
import OJTChecklist from './pages/OJTChecklist.jsx';
import UpdatesList from './pages/UpdatesList.jsx';
import UpdateQuiz from './pages/UpdateQuiz.jsx';
import Library from './pages/Library.jsx';
import TrainerOverview from './pages/TrainerOverview.jsx';
import PublishUpdate from './pages/PublishUpdate.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import TeamDashboard from './pages/TeamDashboard.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('fo_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => localStorage.removeItem('fo_token'))
      .finally(() => setLoading(false));
  }, []);

  function handleLogin(u) {
    setUser(u);
    if (u.role === 'fo') navigate('/me');
    else navigate('/team');
  }

  function handleLogout() {
    api.logout().catch(() => {});
    localStorage.removeItem('fo_token');
    setUser(null);
    navigate('/login');
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login onLogin={handleLogin} />} />
      </Routes>
    );
  }

  const isStaff = ['admin', 'supervisor', 'trainer'].includes(user.role);

  return (
    <div>
      <header style={navStyle}>
        <strong>FO Training &amp; OJT</strong>
        <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {user.role === 'fo' && <Link to="/me">My Dashboard</Link>}
          {user.role === 'fo' && <Link to="/checklist">OJT Checklist</Link>}
          <Link to="/updates">Updates &amp; Quizzes</Link>
          <Link to="/library">Library</Link>
          {isStaff && <Link to="/trainer/overview">OJT Overview</Link>}
          {isStaff && <Link to="/trainer/publish">Publish Update</Link>}
          {isStaff && <Link to="/team">Team Dashboard</Link>}
          {user.role === 'admin' && <Link to="/admin/users">Admin</Link>}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>{user.name} ({user.role})</span>
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
        <Routes>
          <Route path="/login" element={<Navigate to={user.role === 'fo' ? '/me' : '/team'} />} />
          <Route path="/me" element={<FODashboard user={user} />} />
          <Route path="/checklist" element={<OJTChecklist user={user} />} />
          <Route path="/updates" element={<UpdatesList user={user} />} />
          <Route path="/updates/:id" element={<UpdateQuiz user={user} />} />
          <Route path="/library" element={<Library user={user} />} />
          {isStaff && <Route path="/trainer/overview" element={<TrainerOverview user={user} />} />}
          {isStaff && <Route path="/trainer/publish" element={<PublishUpdate user={user} />} />}
          {isStaff && <Route path="/team" element={<TeamDashboard user={user} />} />}
          {user.role === 'admin' && <Route path="/admin/users" element={<AdminUsers user={user} />} />}
          <Route path="*" element={<Navigate to={user.role === 'fo' ? '/me' : '/team'} />} />
        </Routes>
      </main>
    </div>
  );
}

const navStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 20,
  padding: '12px 20px',
  background: '#14213d',
  color: 'white',
  flexWrap: 'wrap',
};
