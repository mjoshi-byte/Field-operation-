import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
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
import QuizLeaderboard from './pages/QuizLeaderboard.jsx';

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
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={sidebarStyle}>
        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--color-accent)', marginBottom: 28, letterSpacing: '-0.01em' }}>
          FO Training &amp; OJT
        </div>

        <NavSection label="Overview">
          {user.role === 'fo' ? (
            <NavItem to="/me">My Dashboard</NavItem>
          ) : (
            <NavItem to="/team">Team Dashboard</NavItem>
          )}
        </NavSection>

        <NavSection label="Training">
          {user.role === 'fo' && <NavItem to="/checklist">OJT Checklist</NavItem>}
          <NavItem to="/updates">Updates &amp; Quizzes</NavItem>
          <NavItem to="/library">Library</NavItem>
        </NavSection>

        {isStaff && (
          <NavSection label="Oversight">
            <NavItem to="/trainer/overview">OJT Overview</NavItem>
            <NavItem to="/trainer/publish">Publish Update</NavItem>
            <NavItem to="/leaderboard">Leaderboard</NavItem>
          </NavSection>
        )}

        {user.role === 'admin' && (
          <NavSection label="Administration">
            <NavItem to="/admin/users">Admin</NavItem>
          </NavSection>
        )}

        <div style={{ marginTop: 'auto', paddingTop: 20 }}>
          <div style={sectionLabelStyle}>Signed in as</div>
          <div
            style={{
              background: 'var(--color-surface-alt)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 10,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {user.name} · {user.role}
          </div>
          <button onClick={handleLogout} style={{ width: '100%' }}>
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
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
            {isStaff && <Route path="/leaderboard" element={<QuizLeaderboard />} />}
            {user.role === 'admin' && <Route path="/admin/users" element={<AdminUsers user={user} />} />}
            <Route path="*" element={<Navigate to={user.role === 'fo' ? '/me' : '/team'} />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function NavSection({ label, children }) {
  const hasContent = Array.isArray(children) ? children.some(Boolean) : !!children;
  if (!hasContent) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={sectionLabelStyle}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  );
}

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'block',
        padding: '10px 14px',
        borderRadius: 10,
        fontWeight: 600,
        fontSize: 14,
        textDecoration: 'none',
        color: isActive ? 'white' : 'var(--color-text-muted)',
        background: isActive ? 'var(--color-primary)' : 'transparent',
      })}
    >
      {children}
    </NavLink>
  );
}

const sidebarStyle = {
  width: 260,
  flexShrink: 0,
  background: 'var(--color-nav-bg)',
  borderRight: '1px solid var(--color-border)',
  padding: '24px 16px',
  display: 'flex',
  flexDirection: 'column',
};

const sectionLabelStyle = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 700,
  color: 'var(--color-text-muted)',
  marginBottom: 8,
};
