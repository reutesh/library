/*
 * src/components/Layout.tsx — app shell
 *
 * Header, navigation and the routes of the logged-in app. Admin-only
 * routes redirect other roles to /books; unknown URLs show a 404 state.
 */

import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { roleLabels } from '../roles';
import ProfileModal from './ProfileModal';
import BooksView from './BooksView';
import RoomsView from './RoomsView';
import UsersView from './UsersView';
import Dashboard from './Dashboard';

const VIEWS: { path: string; name: string; adminOnly?: boolean }[] = [
  { path: '/dashboard', name: 'לוח בקרה', adminOnly: true },
  { path: '/books', name: 'ספרים' },
  { path: '/rooms', name: 'חדרים ומדפים' },
  { path: '/users', name: 'ניהול משתמשים', adminOnly: true },
];

function NotFound() {
  return (
    <div className="empty-state">
      <h2>העמוד לא נמצא</h2>
      <p>הכתובת שחיפשת אינה קיימת במערכת.</p>
      <NavLink className="btn btn-primary" to="/books">
        חזרה לעמוד הספרים
      </NavLink>
    </div>
  );
}

export default function Layout() {
  const { me, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const isAdmin = me?.role === 'admin';

  return (
    <div id="app">
      <header className="app-header">
        <div className="header-row">
          <h1 className="app-brand">📚 מנהל ספרייה</h1>
          {me && (
            <div className="user-box">
              <div className="user-identity">
                <span className="user-name">{me.username}</span>
                <span className={`role-badge badge-${me.role}`}>
                  {roleLabels[me.role]}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setProfileOpen(true)}
              >
                שינוי סיסמה
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={logout}>
                התנתקות
              </button>
            </div>
          )}
        </div>
        <nav className="app-nav" aria-label="ניווט ראשי">
          {VIEWS.filter((v) => !v.adminOnly || isAdmin).map((v) => (
            <NavLink
              key={v.path}
              className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
              to={v.path}
            >
              {v.name}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="page-content">
        <Routes>
          <Route path="/" element={<Navigate to="/books" replace />} />
          <Route path="/books" element={<BooksView />} />
          <Route path="/rooms" element={<RoomsView />} />
          <Route
            path="/users"
            element={isAdmin ? <UsersView /> : <Navigate to="/books" replace />}
          />
          <Route
            path="/dashboard"
            element={isAdmin ? <Dashboard /> : <Navigate to="/books" replace />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}