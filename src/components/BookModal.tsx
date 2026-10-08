import { useMemo, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { api, type Book, type BookInput } from '../api';
import { useData } from '../data/DataContext';

interface BookModalProps {
  book: Book | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function BookModal({ book, onClose, onSaved }: BookModalProps) {
  const { rooms, shelves, genres } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [isbn, setIsbn] = useState(book?.isbn ?? '');
  const [genre, setGenre] = useState(book?.genre ?? '');
  const [notes, setNotes] = useState(book?.notes ?? '');
  const [shelfId, setShelfId] = useState(book?.shelfId ? String(book.shelfId) : '');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const val = genre.trim().toLowerCase();
    if (!val) return [];
    return genres.filter((g) => g.toLowerCase().includes(val)).slice(0, 8);
  }, [genre, genres]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data: BookInput = {
      title: title.trim(),
      author: author.trim() || null,
      isbn: isbn.trim() || null,
      genre: genre.trim() || null,
      notes: notes.trim() || null,
      shelf_id: shelfId ? Number(shelfId) : null,
    };
    try {
      if (book) {
        await api.updateBook(book.id, data);
      } else {
        await api.createBook(data);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={book ? 'ערוך ספר' : 'הוסף ספר'} onClose={onClose}>
      <form id="book-form" onSubmit={save}>
        <div className="form-group">
          <label htmlFor="book-title">כותרת *</label>
          <input
            id="book-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="book-author">מחבר/ת</label>
          <input
            id="book-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="book-isbn">ISBN</label>
            <input
              id="book-isbn"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
            />
          </div>
          <div className="form-group autocomplete-wrapper">
            <label htmlFor="book-genre">ז'אנר</label>
            <input
              id="book-genre"
              value={genre}
              onChange={(e) => {
                setGenre(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="suggestions-list">
                {suggestions.map((g) => (
                  <li
                    key={g}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setGenre(g);
                      setShowSuggestions(false);
                    }}
                  >
                    {g}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="book-shelf">מיקום</label>
          <select
            id="book-shelf"
            value={shelfId}
            onChange={(e) => setShelfId(e.target.value)}
          >
            <option value="">לא מוקצה</option>
            {rooms.map((room) => (
              <optgroup key={room.id} label={room.name}>
                {shelves
                  .filter((s) => s.roomId === room.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="book-notes">הערות</label>
          <textarea
            id="book-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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