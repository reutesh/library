import { useEffect, useState } from 'react';
import { api, type Stats } from '../api';
import Loading from './Loading';

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <section className="view">
      <h2>לוח בקרה</h2>
      {stats === null ? (
        <Loading label="טוען נתונים..." />
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <h3>{stats.books}</h3>
              <p>ספרים</p>
            </div>
            <div className="stat-card">
              <h3>{stats.shelves}</h3>
              <p>מדפים</p>
            </div>
            <div className="stat-card">
              <h3>{stats.rooms}</h3>
              <p>חדרים</p>
            </div>
            <div className="stat-card">
              <h3>{stats.users}</h3>
              <p>משתמשים</p>
            </div>
            <div className="stat-card">
              <h3>{stats.pendingBooks}</h3>
              <p>ספרים ממתינים</p>
            </div>
          </div>
          <h3>ספרים לא מוקצים</h3>
          <div className="empty-state">
            <p>אין ספרים לא מוקצים</p>
          </div>
        </>
      )}
    </section>
  );
}