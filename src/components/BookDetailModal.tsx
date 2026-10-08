import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { api, type Book, type Loan } from '../api';
import { useAuth } from '../auth/AuthContext';
import { canEditBook, canLend as canLendBooks } from '../roles';

interface BookDetailModalProps {
  book: Book;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (book: Book) => void;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

export default function BookDetailModal({ book: initialBook, onClose, onChanged, onEdit }: BookDetailModalProps) {
  const { me } = useAuth();
  const [book, setBook] = useState<Book>(initialBook);
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [borrowerName, setBorrowerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canLend = canLendBooks(me);
  const canEdit = canEditBook(me, book);

  const load = useCallback(async () => {
    try {
      const [b, l] = await Promise.all([api.book(book.id), api.bookLoans(book.id)]);
      setBook(b);
      setLoans(l);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינה');
    }
  }, [book.id]);

  useEffect(() => {
    load();
  }, [load]);

  const activeLoan = loans?.find((l) => l.returnedAt === null) ?? null;

  const lend = async (e: FormEvent) => {
    e.preventDefault();
    const name = borrowerName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.lendBook(book.id, name);
      setBorrowerName('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהשאלה');
    } finally {
      setBusy(false);
    }
  };

  const giveBack = async () => {
    if (!activeLoan) return;
    setBusy(true);
    setError('');
    try {
      await api.returnLoan(activeLoan.id);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהחזרה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="פרטי ספר" onClose={onClose}>
      <div id="book-detail">
        <div className="detail-header">
          <h4>{book.title}</h4>
          {book.onLoan ? (
            <span className="tag tag-onloan">מושאל</span>
          ) : (
            <span className="tag tag-available">זמין</span>
          )}
          {book.status === 'pending' && (
            <span className="tag tag-pending">ממתין לאישור</span>
          )}
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary btn-small detail-edit"
              onClick={() => onEdit(book)}
            >
              עריכת ספר
            </button>
          )}
        </div>

        <div className="detail-row">
          <span className="label">מחבר/ת</span>
          <span className="value">{book.author || '—'}</span>
        </div>
        <div className="detail-row">
          <span className="label">ISBN</span>
          <span className="value">{book.isbn || '—'}</span>
        </div>
        <div className="detail-row">
          <span className="label">ז'אנר</span>
          <span className="value">{book.genre || '—'}</span>
        </div>
        <div className="detail-row">
          <span className="label">מיקום</span>
          <span className="value">
            {book.roomName ? `${book.roomName} › ${book.shelfName}` : 'לא מוקצה'}
          </span>
        </div>
        {book.notes && (
          <div className="detail-row">
            <span className="label">הערות</span>
            <span className="value">{book.notes}</span>
          </div>
        )}

        {book.onLoan && (
          <div className="loan-current">
            מושאל ל־<strong>{book.borrowerName}</strong>
            {activeLoan && <> מאז {fmt(activeLoan.lentAt)}</>}
          </div>
        )}

        {canLend && (
          <div className="loan-section">
            {book.onLoan ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={giveBack}
                disabled={busy}
              >
                {busy ? 'מעבד...' : 'החזר ספר'}
              </button>
            ) : (
              <form className="lend-form" onSubmit={lend}>
                <input
                  type="text"
                  value={borrowerName}
                  onChange={(e) => setBorrowerName(e.target.value)}
                  placeholder="שם המשאיל"
                  aria-label="שם המשאיל"
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'מעבד...' : 'השאל ספר'}
                </button>
              </form>
            )}
          </div>
        )}

        {error && <div className="login-error">{error}</div>}

        <div className="loan-section">
          <h4>היסטוריית השאלות</h4>
          {loans === null ? (
            <p className="field-hint">טוען היסטוריה...</p>
          ) : loans.length === 0 ? (
            <p className="field-hint">אין עדיין היסטוריית השאלות לספר הזה</p>
          ) : (
            <ul className="loan-history">
              {loans.map((l) => (
                <li key={l.id}>
                  <div className="loan-name">
                    {l.borrowerName}
                    {l.returnedAt === null && (
                      <span className="tag tag-onloan">נוכחית</span>
                    )}
                  </div>
                  <div className="loan-dates">
                    הושאל ב־{fmt(l.lentAt)}
                    {l.lentByName && <> על ידי {l.lentByName}</>}
                    {l.returnedAt ? (
                      <>
                        {' · '}
                        הוחזר ב־{fmt(l.returnedAt)}
                        {l.returnedByName && <> על ידי {l.returnedByName}</>}
                      </>
                    ) : (
                      ' · טרם הוחזר'
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
