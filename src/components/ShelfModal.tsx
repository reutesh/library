import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { api } from '../api';

interface ShelfModalProps {
  roomId: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function ShelfModal({ roomId, onClose, onSaved }: ShelfModalProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setBusy(true);
    try {
      await api.createShelf(roomId, name.trim());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="הוסף מדף" onClose={onClose}>
      <form id="shelf-form" onSubmit={save}>
        <div className="form-group">
          <label htmlFor="shelf-name">שם המדף *</label>
          <input
            id="shelf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
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