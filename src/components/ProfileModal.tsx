import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { api } from '../api';

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ProfileModal({ open, onClose }: ProfileModalProps) {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPw !== confirm) {
      setError('הסיסמאות אינן תואמות');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, newPw);
      setCurrent('');
      setNewPw('');
      setConfirm('');
      onClose();
      alert('הסיסמה שונתה בהצלחה');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="שינוי סיסמה" onClose={onClose}>
      <form id="profile-form" onSubmit={submit}>
        <div className="form-group">
          <label htmlFor="profile-current-password">סיסמה נוכחית *</label>
          <input
            id="profile-current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <div className="form-group">
          <label htmlFor="profile-new-password">סיסמה חדשה *</label>
          <input
            id="profile-new-password"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label htmlFor="profile-confirm-password">אישור סיסמה *</label>
          <input
            id="profile-confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>
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