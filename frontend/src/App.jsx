import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { supabase } from './supabaseClient.js';

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

  async function loadAppUser() {
    try {
      const res = await api.me();
      setUser(res.user);
      if (res.user.role === 'fo') navigate('/me');
      else navigate('/team');
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Pick up an existing session (e.g. a page refresh) ...
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadAppUser();
      else setLoading(false);
    });
    // ...and react to sign-in (including the magic-link redirect) / sign-out as they happen.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') loadAppUser();
      if (event === 'SIGNED_OUT') setUser(null);
    });
    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogout() {
    supabase.auth.signOut();
    setUser(null);
    navigate('/login');
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  const isStaff = ['admin', 'supervisor', 'trainer'].includes(user.role);

  return (
    <div>
      <header style={navStyle}>
        <strong style={{ fontSize: '1.2rem', letterSpacing: '-0.01em' }}>FO Training &amp; OJT</strong>
        <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {user.role === 'fo' && <Link style={navLinkStyle} to="/me">My Dashboard</Link>}
          {user.role === 'fo' && <Link style={navLinkStyle} to="/checklist">OJT Checklist</Link>}
          <Link style={navLinkStyle} to="/updates">Updates &amp; Quizzes</Link>
          <Link style={navLinkStyle} to="/library">Library</Link>
          {isStaff && <Link style={navLinkStyle} to="/trainer/overview">OJT Overview</Link>}
          {isStaff && <Link style={navLinkStyle} to="/trainer/publish">Publish Update</Link>}
          {isStaff && <Link style={navLinkStyle} to="/team">Team Dashboard</Link>}
          {user.role === 'admin' && <Link style={navLinkStyle} to="/admin/users">Admin</Link>}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>{user.name} ({user.role})</span>
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.4)',
              color: 'white',
              fontWeight: 500,
            }}
          >
            Sign out
          </button>
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
  padding: '14px 24px',
  background: 'var(--color-primary)',
  color: 'white',
  flexWrap: 'wrap',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
};

const navLinkStyle = {
  color: 'rgba(255,255,255,0.85)',
  fontWeight: 500,
};
