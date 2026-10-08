import type { Book } from '../api';
import { useAuth } from '../auth/AuthContext';
import { canEditBook } from '../roles';

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
}

export default function BookCard({ book, onOpen, onEdit, onDelete }: BookCardProps) {
  const { me } = useAuth();

  const canEdit = canEditBook(me, book);

  return (
    <div
      className={`book-card${book.onLoan ? ' on-loan' : ''}`}
      onClick={() => onOpen(book)}
    >
      <h4>
        {book.title}{' '}
        {book.onLoan && <span className="tag tag-onloan">מושאל</span>}
        {book.status === 'pending' && (
          <span className="tag tag-pending">ממתין לאישור</span>
        )}
      </h4>
      {book.onLoan && book.borrowerName && (
        <div className="borrowed-to">מושאל ל־{book.borrowerName}</div>
      )}
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
          <button
            className="btn btn-primary btn-small"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(book);
            }}
          >
            עריכה
          </button>
          <button
            className="btn btn-danger btn-small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(book);
            }}
          >
            מחיקה
          </button>
        </div>
      )}
    </div>
  );
}
