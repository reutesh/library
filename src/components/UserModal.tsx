import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { api, type Role, type User, type UserInput } from '../api';
import { useData } from '../data/DataContext';

interface UserModalProps {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function UserModal({ user, onClose, onSaved }: UserModalProps) {
  const { rooms } = useData();
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'viewer');
  const [allowedRoomIds, setAllowedRoomIds] = useState<number[]>(user?.allowedRoomIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggleRoom = (id: number) => {
    setAllowedRoomIds((prev) =>
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id],
    );
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data: UserInput = {
      username,
      role,
      allowed_room_ids: allowedRoomIds,
    };
    if (password) data.password = password;
    try {
      if (user) {
        await api.updateUser(user.id, data);
      } else {
        await api.createUser(data);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={user ? 'ערוך משתמש' : 'הוסף משתמש'} onClose={onClose}>
      <form id="user-form" onSubmit={save}>
        <div className="form-group">
          <label htmlFor="user-username">שם משתמש *</label>
          <input
            id="user-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="user-password">סיסמה {user ? '(השאר ריק כדי לא לשנות)' : '*'}</label>
          <input
            id="user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!user}
            minLength={6}
            autoComplete="new-password"
          />
          {user && <small className="field-hint">השאר ריק כדי להשאיר את הסיסמה ללא שינוי</small>}
        </div>
        <div className="form-group">
          <label htmlFor="user-role">תפקיד</label>
          <select id="user-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="viewer">צופה — צפייה בלבד</option>
            <option value="editor">עורך — עריכה בחדרים מסוימים</option>
            <option value="admin">מנהל — גישה להכל</option>
          </select>
        </div>
        {role === 'editor' && (
          <div className="form-group">
            <label>חדרים מותרים לעריכה</label>
            <div className="rooms-checkbox-grid">
              {rooms.map((r) => (
                <label className="room-checkbox" key={r.id}>
                  <input
                    type="checkbox"
                    checked={allowedRoomIds.includes(r.id)}
                    onChange={() => toggleRoom(r.id)}
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            ביטול
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'שומר...' : 'שמירה'}
          </button>
        </div>
      </form>
    </Modal>
  );
}