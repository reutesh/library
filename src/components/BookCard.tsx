import type { Book } from '../api';
import { useAuth } from '../auth/AuthContext';

interface BookCardProps {
  book: Book;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
}

export default function BookCard({ book, onEdit, onDelete }: BookCardProps) {
  const { me } = useAuth();

  const canEdit =
    me?.role === 'admin' ||
    me?.role === 'editor'
      ? !!book.roomId && !!me && me.allowedRoomIds.includes(book.roomId)
      : book.status === 'pending' && book.createdBy === me?.id;

  return (
    <div className="book-card">
      <h4>
        {book.title}{' '}
        {book.status === 'pending' && (
          <span className="tag tag-pending">ממתין לאישור</span>
        )}
      </h4>
      {book.author && <div className="author">{book.author}</div>}
      <div className="meta">
        {book.genre && <span className="tag">{book.genre}</span>}
        {book.isbn && <span className="tag">ISBN: {book.isbn}</span>}
      </div>
      {book.roomName && (
        <div className="location">
          📍 {book.roomName} › {book.shelfName}
        </div>
      )}
      {book.notes && <div className="notes">{book.notes}</div>}
      {canEdit && (
        <div className="actions">
          <button className="btn btn-primary btn-small" onClick={() => onEdit(book)}>
            עריכה
          </button>
          <button className="btn btn-danger btn-small" onClick={() => onDelete(book)}>
            מחיקה
          </button>
        </div>
      )}
    </div>
  );
}