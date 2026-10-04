/*
 * src/components/Layout.tsx — app shell
 *
 * Keeps every visited view mounted and simply shows/hides it on
 * navigation.  This mirrors the old single-page behavior: once a view
 * has loaded its data, revisiting it re-renders instantly instead of
 * refetching from the API or flashing a spinner.
 */

import { useEffect, useState } from 'react';
import { NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ProfileModal from './ProfileModal';
import BooksView from './BooksView';
import RoomsView from './RoomsView';
import UsersView from './UsersView';
import Dashboard from './Dashboard';

const roleLabels: Record<string, string> = {
  admin: 'מנהל',
  editor: 'עורך',
  viewer: 'צופה',
};

const VIEWS: { path: string; name: string; adminOnly?: boolean }[] = [
  { path: '/dashboard', name: 'לוח בקרה', adminOnly: true },
  { path: '/books', name: 'ספרים' },
  { path: '/rooms', name: 'חדרים ומדפים' },
  { path: '/users', name: 'ניהול משתמשים', adminOnly: true },
];

export default function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);

  const current = VIEWS.find(
    (v) => v.path === pathname && (!v.adminOnly || me?.role === 'admin'),
  )?.path;

  useEffect(() => {
    if (!current) return;
    setSeen((prev) => (prev.includes(current) ? prev : [...prev, current]));
  }, [current]);

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  if (!current) return <Navigate to="/books" replace />;

  return (
    <div id="app">
      <header>
        <div className="header-row">
          <h1>📚 מנהל ספרייה</h1>
          {me && (
            <div className="user-box">
              <span>{me.username}</span>
              <span className={`role-badge badge-${me.role}`}>
                {roleLabels[me.role]}
              </span>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setProfileOpen(true)}
              >
                שינוי סיסמה
              </button>
              <button className="btn btn-secondary btn-small" onClick={handleLogout}>
                התנתקות
              </button>
            </div>
          )}
        </div>
        <nav>
          {VIEWS.filter((v) => !v.adminOnly || me?.role === 'admin').map((v) => (
            <NavLink key={v.path} className="nav-btn" to={v.path}>
              {v.name}
            </NavLink>
          ))}
        </nav>
      </header>

      <main>
        {seen.includes('/books') && (
          <div style={{ display: current === '/books' ? 'block' : 'none' }}>
            <BooksView />
          </div>
        )}
        {seen.includes('/rooms') && (
          <div style={{ display: current === '/rooms' ? 'block' : 'none' }}>
            <RoomsView />
          </div>
        )}
        {seen.includes('/users') && (
          <div style={{ display: current === '/users' ? 'block' : 'none' }}>
            <UsersView />
          </div>
        )}
        {seen.includes('/dashboard') && (
          <div style={{ display: current === '/dashboard' ? 'block' : 'none' }}>
            <Dashboard />
          </div>
        )}
      </main>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}