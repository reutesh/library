import { useEffect, useState } from 'react';
import { api, type Stats } from '../api';
import { usePersistentState } from '../data/persistentState';
import Loading from './Loading';

const STAT_LABELS: [keyof Stats, string][] = [
  ['books', 'ספרים'],
  ['shelves', 'מדפים'],
  ['rooms', 'חדרים'],
  ['users', 'משתמשים'],
  ['pendingBooks', 'ספרים ממתינים'],
];

export default function Dashboard() {
  const [stats, setStats] = usePersistentState<Stats | null>('stats', null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : 'שגיאה בטעינה'));
  }, []);

  return (
    <section className="view">
      <h2>לוח בקרה</h2>
      {error ? (
        <div className="login-error">{error}</div>
      ) : stats === null ? (
        <Loading label="טוען נתונים..." />
      ) : (
        <div className="stats-grid">
          {STAT_LABELS.map(([key, label]) => (
            <div className="stat-card" key={key}>
              <h3>{stats[key]}</h3>
              <p>{label}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}