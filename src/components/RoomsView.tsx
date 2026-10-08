import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import { canEditRoom } from '../roles';
import Loading from './Loading';
import RoomModal from './RoomModal';
import ShelfModal from './ShelfModal';

export default function RoomsView() {
  const { me, reloadMe } = useAuth();
  const { rooms, shelves, refresh, referenceLoaded } = useData();
  const navigate = useNavigate();
  const [roomModal, setRoomModal] = useState(false);
  const [shelfRoomId, setShelfRoomId] = useState<number | null>(null);

  const deleteRoom = async (id: number) => {
    if (!confirm('בטוח למחוק חדר זה?')) return;
    try {
      await api.deleteRoom(id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה במחיקה');
    }
  };

  const deleteShelf = async (id: number) => {
    if (!confirm('בטוח למחוק מדף זה?')) return;
    try {
      await api.deleteShelf(id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה במחיקה');
    }
  };

  const afterSave = async () => {
    setRoomModal(false);
    setShelfRoomId(null);
    await refresh();
  };

  return (
    <section className="view">
      <div className="view-header">
        <h2>חדרים ומדפים</h2>
        {me?.role !== 'viewer' && (
          <button className="btn btn-primary" onClick={() => setRoomModal(true)}>
            + הוסף חדר
          </button>
        )}
      </div>

      {rooms.length === 0 && !referenceLoaded ? (
        <Loading />
      ) : rooms.length === 0 ? (
        <div className="empty-state">
          <h3>🏠</h3>
          <p>אין חדרים עדיין</p>
        </div>
      ) : (
        <div className="rooms-container">
          {rooms.map((room) => (
            <div className="room-card" key={room.id}>
              <div className="room-header">
                <h3>{room.name}</h3>
                <span className="book-count">{room.bookCount} ספרים</span>
                <div className="room-actions">
                  {canEditRoom(me, room.id) && (
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => setShelfRoomId(room.id)}
                    >
                      + מדף
                    </button>
                  )}
                  {me?.role === 'admin' && (
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => deleteRoom(room.id)}
                    >
                      מחק חדר
                    </button>
                  )}
                </div>
              </div>
              <div className="room-body">
                <div className="shelves-grid">
                  {shelves
                    .filter((s) => s.roomId === room.id)
                    .map((shelf) => (
                      <div
                        className="shelf-card"
                        key={shelf.id}
                        onClick={() => navigate(`/books?shelf=${shelf.id}`)}
                      >
                        <h4>{shelf.name}</h4>
                        <div className="book-count">{shelf.bookCount} ספרים</div>
                        {canEditRoom(me, room.id) && (
                          <div className="actions">
                            <button
                              className="btn btn-danger btn-small"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteShelf(shelf.id);
                              }}
                            >
                              מחיקה
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  {canEditRoom(me, room.id) && (
                    <div
                      className="add-shelf-btn"
                      onClick={() => setShelfRoomId(room.id)}
                    >
                      + הוסף מדף
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {roomModal && (
        <RoomModal
          onClose={() => setRoomModal(false)}
          onSaved={async () => {
            await afterSave();
            // Editors are granted access to rooms they create
            if (me?.role === 'editor') await reloadMe();
          }}
        />
      )}
      {shelfRoomId !== null && (
        <ShelfModal
          roomId={shelfRoomId}
          onClose={() => setShelfRoomId(null)}
          onSaved={afterSave}
        />
      )}
    </section>
  );
}