import { useEffect, useState } from 'react';
import { api, type User } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import { roleLabels } from '../roles';
import Loading from './Loading';
import UserModal from './UserModal';

export default function UsersView() {
  const { me } = useAuth();
  const { rooms } = useData();
  const [users, setUsers] = useState<User[] | null>(null);
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  const load = async () => {
    try {
      setUsers(await api.users());
    } catch {
      setUsers([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const deleteUser = async (id: number) => {
    if (!confirm('בטוח למחוק משתמש זה?')) return;
    try {
      await api.deleteUser(id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה במחיקה');
    }
  };

  const roomNames = (ids: number[]) =>
    ids
      .map((rid) => rooms.find((r) => r.id === rid)?.name ?? `#${rid}`)
      .join(', ');

  return (
    <section className="view">
      <div className="view-header">
        <h2>ניהול משתמשים</h2>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + הוסף משתמש
        </button>
      </div>

      {users === null ? (
        <Loading />
      ) : users.length === 0 ? (
        <div className="empty-state">
          <h3>👥</h3>
          <p>אין משתמשים</p>
        </div>
      ) : (
        <table className="users-table">
          <thead>
            <tr>
              <th>שם משתמש</th>
              <th>תפקיד</th>
              <th>חדרים מותרים</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{roleLabels[u.role]}</td>
                <td>{roomNames(u.allowedRoomIds) || '—'}</td>
                <td className="row-actions">
                  <button className="btn btn-primary btn-small" onClick={() => setEditing(u)}>
                    עריכה
                  </button>
                  {u.id !== me?.id && (
                    <button className="btn btn-danger btn-small" onClick={() => deleteUser(u.id)}>
                      מחיקה
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing !== null && (
        <UserModal
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}