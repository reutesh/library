import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Book } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import Loading from './Loading';
import BookCard from './BookCard';
import BookModal from './BookModal';

export default function BooksView() {
  const { me } = useAuth();
  const { genres, authors, rooms, shelves } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const shelfParam = searchParams.get('shelf');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [genre, setGenre] = useState('');
  const [room, setRoom] = useState('');
  const [shelf, setShelf] = useState('');
  const [author, setAuthor] = useState('');
  const [showPending, setShowPending] = useState(false);

  const [books, setBooks] = useState<Book[] | null>(null);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Book | 'new' | null>(null);

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // A shelf selected from the rooms view arrives as ?shelf=<id>
  useEffect(() => {
    if (shelfParam === null) return;
    setShelf(shelfParam);
    setQ('');
    setGenre('');
    setRoom('');
    setAuthor('');
    setShowPending(false);
    setPage(1);
    setSearchParams({}, { replace: true });
  }, [shelfParam, setSearchParams]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', String(pageSize));
    if (debouncedQ) p.set('q', debouncedQ);
    if (genre) p.set('genre', genre);
    if (room) p.set('room', room);
    if (shelf) p.set('shelf', shelf);
    if (author) p.set('author', author);
    if (showPending) p.set('status', 'pending');
    return p;
  }, [page, pageSize, debouncedQ, genre, room, shelf, author, showPending]);

  useEffect(() => {
    let cancelled = false;
    api.books(params)
      .then((data) => {
        if (cancelled) return;
        setBooks(data.items);
        setTotal(data.total);
      })
      .catch(() => {
        if (!cancelled && books === null) {
          setBooks([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = books === null ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pendingToggleVisible = me?.role === 'admin';

  const clearFilters = () => {
    setQ('');
    setGenre('');
    setRoom('');
    setShelf('');
    setAuthor('');
    setShowPending(false);
    setPage(1);
  };

  const handleDelete = async (book: Book) => {
    if (!confirm('בטוח למחוק?')) return;
    try {
      await api.deleteBook(book.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error('deleteBook', err);
    }
  };

  return (
    <section className="view">
      <div className="view-header">
        <h2>הספרים שלי</h2>
        <div className="actions">
          <input
            type="text"
            id="book-search"
            placeholder="חיפוש ספרים..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + הוסף ספר
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <select value={genre} onChange={(e) => { setGenre(e.target.value); setPage(1); }}>
          <option value="">כל הז'אנרים</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select value={room} onChange={(e) => { setRoom(e.target.value); setPage(1); }}>
          <option value="">כל החדרים</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select value={shelf} onChange={(e) => { setShelf(e.target.value); setPage(1); }}>
          <option value="">כל המדפים</option>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select value={author} onChange={(e) => { setAuthor(e.target.value); setPage(1); }}>
          <option value="">כל המחברים</option>
          {authors.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {pendingToggleVisible && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={showPending}
              onChange={(e) => { setShowPending(e.target.checked); setPage(1); }}
            />
            ממתינים לאישור
          </label>
        )}
        <button className="btn btn-secondary btn-small" onClick={clearFilters}>
          נקה סינון
        </button>
      </div>

      {books === null ? (
        <Loading />
      ) : books.length === 0 ? (
        <div className="empty-state">
          <h3>📚</h3>
          <p>לא נמצאו ספרים</p>
        </div>
      ) : (
        <div className="book-grid">
          {books.map((b) => (
            <BookCard key={b.id} book={b} onEdit={setEditing} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {books !== null && books.length > 0 && (
        <div className="pagination-bar">
          <div className="pagination-info">
            מציג {from}–{to} מתוך {total}
          </div>
          <div className="pagination-controls">
            <button
              className="btn btn-secondary btn-small page-btn"
              onClick={() => setPage(1)}
              disabled={page === 1}
            >
              «
            </button>
            <button
              className="btn btn-secondary btn-small page-btn"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              ‹
            </button>
            <span style={{ padding: '0 0.5rem' }}>
              עמוד {page} / {totalPages}
            </span>
            <button
              className="btn btn-secondary btn-small page-btn"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              ›
            </button>
            <button
              className="btn btn-secondary btn-small page-btn"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
            >
              »
            </button>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {[6, 12, 24, 48].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {editing !== null && (
        <BookModal
          book={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setPage(1);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}