/*
 * src/client/app.ts — Library Manager front-end
 *
 * Sections:
 *   1. Types & global state
 *   2. Helpers
 *   3. Navigation & view switching
 *   4. Authentication (login / logout / session)
 *   5. Books view (list, search, filters, pagination)
 *   6. Book modal (create / edit)
 *   7. Rooms & shelves view
 *   8. Users view (admin)
 *   9. Profile modal (self-service password change)
 *  10. Boot
 */

// ════════════════════════════════════════════════════════════
// 1. Types & global state
// ════════════════════════════════════════════════════════════

interface Me {
  id: number;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
  allowedRoomIds: number[];
}

interface Book {
  id: number;
  title: string;
  author: string | null;
  isbn: string | null;
  genre: string | null;
  notes: string | null;
  shelfId: number | null;
  shelfName: string | null;
  roomId: number | null;
  roomName: string | null;
  status: 'approved' | 'pending';
  createdBy: number | null;
  updatedAt: string;
}

interface Room {
  id: number;
  name: string;
  bookCount: number;
}

interface Shelf {
  id: number;
  roomId: number;
  name: string;
  bookCount: number;
}

interface User {
  id: number;
  username: string;
  role: string;
  allowedRoomIds: number[];
}

/** All in-memory state. */
let me: Me | null = null;
let allRooms: Room[] = [];
let allShelves: Shelf[] = [];
let allBooks: Book[] = [];
let allUsers: User[] = [];
let genres: string[] = [];
let authors: string[] = [];

// ── Pagination state ────────────────────────────────────────
let currentPage = 1;
let pageSize = 12;
let totalBooks = 0;
let showPendingBooks = false;

// ── Debounce timer for search ───────────────────────────────
let searchTimer: ReturnType<typeof setTimeout> | null = null;

// ════════════════════════════════════════════════════════════
// 2. Helpers
// ════════════════════════════════════════════════════════════

/** Shorthand document.getElementById. */
function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** Shorthand: get .value from an input/select element by id. */
function $v(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

/** Check if the user can edit room-related content. */
function canEditRoomLocation(roomId: number | null): boolean {
  if (!me || !roomId) return false;
  if (me.role === 'admin') return true;
  if (me.role === 'editor') return me.allowedRoomIds.includes(roomId);
  return false;
}

/** Check if the user can edit a specific book. */
function canEditBook(book: Book): boolean {
  if (!me) return false;
  if (me.role === 'admin') return true;
  if (me.role === 'editor') return canEditRoomLocation(book.roomId);
  // Viewer: own pending only
  if (book.status === 'pending' && book.createdBy === me.id) return true;
  return false;
}

// ════════════════════════════════════════════════════════════
// 3. Navigation & view switching
// ════════════════════════════════════════════════════════════

/** Switch to the named view, update nav button active states. */
function switchView(view: string) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

  const target = $(`view-${view}`);
  if (target) target.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  if (btn) btn.classList.add('active');

  // Load data on demand
  if (view === 'rooms') loadRooms();
  if (view === 'users') loadUsers();
  if (view === 'books') loadBooks();
  if (view === 'dashboard') loadDashboard();
}

// ════════════════════════════════════════════════════════════
// 4. Authentication
// ════════════════════════════════════════════════════════════

/** Show the login screen, hide the app. */
function showLogin() {
  $('login-screen').classList.add('active');
  $('app').style.display = 'none';
}

/** Hide the login screen, show the app header/user info. */
function enterApp() {
  $('login-screen').classList.remove('active');
  $('app').style.display = '';
  $('user-box').style.display = '';
  $('user-name').textContent = me!.username;
  $('user-role-badge').textContent =
    me!.role === 'admin' ? 'מנהל' : me!.role === 'editor' ? 'עורך' : 'צופה';
  $('user-role-badge').className = `role-badge badge-${me!.role}`;

  // Show/hide role-restricted nav buttons
  $('nav-dashboard').style.display = me!.role === 'admin' ? '' : 'none';
  $('nav-users').style.display = me!.role === 'admin' ? '' : 'none';

  switchView('books');
}

/** Try to restore a session from the httpOnly cookie on page load. */
async function tryRestoreSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      me = await res.json();
      enterApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

/** Handle login form submit. */
function initLoginForm() {
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = ($('login-username') as HTMLInputElement).value.trim();
    const password = ($('login-password') as HTMLInputElement).value;
    const errorEl = $('login-error');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        errorEl.textContent = data.error || 'Login failed';
        errorEl.style.display = 'block';
        return;
      }
      me = await res.json();
      enterApp();
    } catch {
      errorEl.textContent = 'Network error';
      errorEl.style.display = 'block';
    }
  });
}

/** Handle logout button. */
function initLogout() {
  $('btn-logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    me = null;
    allBooks = [];
    allRooms = [];
    allShelves = [];
    allUsers = [];
    showLogin();
  });
}

// ════════════════════════════════════════════════════════════
// 5. Books view
// ════════════════════════════════════════════════════════════

/** Fetch the current page of books from the API and render. */
async function loadBooks() {
  const params = new URLSearchParams();
  params.set('page', String(currentPage));
  params.set('limit', String(pageSize));

  const q = ($('book-search') as HTMLInputElement).value.trim();
  if (q) params.set('q', q);

  const genre = ($('filter-genre') as HTMLSelectElement).value;
  const room = ($('filter-room') as HTMLSelectElement).value;
  const shelf = ($('filter-shelf') as HTMLSelectElement).value;
  const author = ($('filter-author') as HTMLSelectElement).value;

  if (genre) params.set('genre', genre);
  if (room) params.set('room', room);
  if (shelf) params.set('shelf', shelf);
  if (author) params.set('author', author);
  if (showPendingBooks) params.set('status', 'pending');

  try {
    const res = await fetch(`/api/books?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    allBooks = data.items;
    totalBooks = data.total;
    renderBooks();
    renderPaginationBar();
  } catch (err) {
    console.error('loadBooks', err);
  }
}

/** Render the book cards in the books view. */
function renderBooks() {
  const container = $('books-list');
  if (allBooks.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><h3>📚</h3><p>לא נמצאו ספרים</p></div>';
    return;
  }
  container.innerHTML = allBooks
    .map((b) => {
      const pendingTag =
        b.status === 'pending'
          ? '<span class="tag tag-pending">ממתין לאישור</span>'
          : '';
      const location = b.roomName
        ? `<div class="location">📍 ${b.roomName} › ${b.shelfName}</div>`
        : '';
      const genreTag = b.genre ? `<span class="tag">${b.genre}</span>` : '';
      const isbnTag = b.isbn ? `<span class="tag">ISBN: ${b.isbn}</span>` : '';

      let actions = '';
      if (canEditBook(b)) {
        actions = `
          <div class="actions">
            <button class="btn btn-primary btn-small" onclick="openBookModal(${b.id})">עריכה</button>
            <button class="btn btn-danger btn-small" onclick="deleteBook(${b.id})">מחיקה</button>
          </div>`;
      }

      return `
        <div class="book-card">
          <h4>${escHtml(b.title)} ${pendingTag}</h4>
          ${b.author ? `<div class="author">${escHtml(b.author)}</div>` : ''}
          <div class="meta">${genreTag} ${isbnTag}</div>
          ${location}
          ${b.notes ? `<div class="notes">${escHtml(b.notes)}</div>` : ''}
          ${actions}
        </div>`;
    })
    .join('');
}

/** Render the pagination controls below the book grid. */
function renderPaginationBar() {
  const totalPages = Math.max(1, Math.ceil(totalBooks / pageSize));
  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalBooks);

  $('pagination-bar').innerHTML = `
    <div class="pagination-info">
      מציג ${from}–${to} מתוך ${totalBooks}
    </div>
    <div class="pagination-controls">
      <button class="btn btn-secondary btn-small page-btn" onclick="goPage(1)" ${currentPage === 1 ? 'disabled' : ''}>«</button>
      <button class="btn btn-secondary btn-small page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹</button>
      <span style="padding:0 0.5rem">עמוד ${currentPage} / ${totalPages}</span>
      <button class="btn btn-secondary btn-small page-btn" onclick="goPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>
      <button class="btn btn-secondary btn-small page-btn" onclick="goPage(${totalPages})" ${currentPage >= totalPages ? 'disabled' : ''}>»</button>
      <select id="page-size" onchange="changePageSize(this.value)">
        <option value="6" ${pageSize === 6 ? 'selected' : ''}>6</option>
        <option value="12" ${pageSize === 12 ? 'selected' : ''}>12</option>
        <option value="24" ${pageSize === 24 ? 'selected' : ''}>24</option>
        <option value="48" ${pageSize === 48 ? 'selected' : ''}>48</option>
      </select>
    </div>`;
}

/** Navigate to a specific page. */
(window as any).goPage = function (page: number) {
  const totalPages = Math.max(1, Math.ceil(totalBooks / pageSize));
  currentPage = Math.max(1, Math.min(page, totalPages));
  loadBooks();
};

/** Change page size and reset to page 1. */
(window as any).changePageSize = function (val: string) {
  pageSize = parseInt(val, 10) || 12;
  currentPage = 1;
  loadBooks();
};

/** Delete a book after confirmation. */
(window as any).deleteBook = async function (id: number) {
  if (!confirm('בטוח למחוק?')) return;
  await fetch(`/api/books/${id}`, { method: 'DELETE' });
  loadBooks();
};

// ════════════════════════════════════════════════════════════
// 6. Book modal (create / edit)
// ════════════════════════════════════════════════════════════

/** Open the book modal for creating or editing.
 *  If `bookId` is provided, load the book data into the form. */
(window as any).openBookModal = async function (bookId?: number) {
  const modal = $('book-modal');
  const form = $('book-form') as HTMLFormElement;
  form.reset();
  ($('book-id') as HTMLInputElement).value = '';

  // Populate shelf dropdown from loaded rooms/shelves
  const shelfSelect = $('book-shelf') as HTMLSelectElement;
  shelfSelect.innerHTML = '<option value="">לא מוקצה</option>';
  for (const room of allRooms) {
    const roomShelves = allShelves.filter((s) => s.roomId === room.id);
    if (roomShelves.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = room.name;
    for (const s of roomShelves) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      group.appendChild(opt);
    }
    shelfSelect.appendChild(group);
  }

  if (bookId) {
    // Editing existing book
    $('book-modal-title').textContent = 'ערוך ספר';
    const res = await fetch(`/api/books/${bookId}`);
    if (!res.ok) return;
    const book: Book = await res.json();
    ($('book-id') as HTMLInputElement).value = String(book.id);
    ($('book-title') as HTMLInputElement).value = book.title;
    ($('book-author') as HTMLInputElement).value = book.author ?? '';
    ($('book-isbn') as HTMLInputElement).value = book.isbn ?? '';
    ($('book-genre') as HTMLInputElement).value = book.genre ?? '';
    ($('book-notes') as HTMLTextAreaElement).value = book.notes ?? '';
    if (book.shelfId) shelfSelect.value = String(book.shelfId);
  } else {
    $('book-modal-title').textContent = 'הוסף ספר';
  }

  modal.classList.add('active');
};

/** Save book (create or update) from the modal form. */
async function saveBook() {
  const form = $('book-form') as HTMLFormElement;
  const id = $v('book-id');
  const data = {
    title: ($('book-title') as HTMLInputElement).value.trim(),
    author: ($('book-author') as HTMLInputElement).value.trim() || null,
    isbn: ($('book-isbn') as HTMLInputElement).value.trim() || null,
    genre: ($('book-genre') as HTMLInputElement).value.trim() || null,
    notes: ($('book-notes') as HTMLTextAreaElement).value.trim() || null,
    shelf_id: ($('book-shelf') as HTMLSelectElement).value || null,
  };

  if (!data.title) {
    alert('כותרת חובה');
    return;
  }

  if (id) {
    await fetch(`/api/books/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } else {
    await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  $('book-modal').classList.remove('active');
  loadBooks();
}

// ════════════════════════════════════════════════════════════
// 7. Rooms & shelves view
// ════════════════════════════════════════════════════════════

/** Fetch rooms + shelves and render the rooms view. */
async function loadRooms() {
  const [roomsRes, shelvesRes] = await Promise.all([
    fetch('/api/rooms'),
    fetch('/api/books?all=true'),
  ]);

  if (!roomsRes.ok) return;
  allRooms = await roomsRes.json();

  // Shelves come from rooms; fetch them
  const shelvesPromises = allRooms.map((r) =>
    fetch(`/api/rooms/${r.id}/shelves`).then((res) =>
      res.ok ? res.json() : ([] as Shelf[]),
    ),
  );
  const shelvesArrays = await Promise.all(shelvesPromises);
  allShelves = shelvesArrays.flat();
  populateFilters();
  renderRooms();
}

/** Render the rooms → shelves → book-count hierarchy. */
function renderRooms() {
  const container = $('rooms-list');
  if (allRooms.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><h3>🏠</h3><p>אין חדרים עדיין</p></div>';
    return;
  }
  container.innerHTML = allRooms
    .map((room) => {
      const shelves = allShelves.filter((s) => s.roomId === room.id);
      const shelfCards = shelves
        .map(
          (s) => `
        <div class="shelf-card" data-action="view-shelf" onclick="viewShelfBooks(${s.id})">
          <h4>${escHtml(s.name)}</h4>
          <div class="book-count">${s.bookCount} ספרים</div>
          <div class="actions">
            <button class="btn btn-danger btn-small" onclick="event.stopPropagation(); deleteShelf(${s.id})">מחיקה</button>
          </div>
        </div>`,
        )
        .join('');

      return `
      <div class="room-card">
        <div class="room-header">
          <h3>${escHtml(room.name)}</h3>
          <span class="book-count">${room.bookCount} ספרים</span>
          <div class="room-actions">
            <button class="btn btn-primary btn-small" onclick="openShelfModal(${room.id})">+ מדף</button>
            <button class="btn btn-danger btn-small" onclick="deleteRoom(${room.id})">מחק חדר</button>
          </div>
        </div>
        <div class="room-body">
          <div class="shelves-grid">
            ${shelfCards}
            <div class="add-shelf-btn" onclick="openShelfModal(${room.id})">+ הוסף מדף</div>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

/** Navigate to books filtered by a specific shelf. Clears all other filters first. */
(window as any).viewShelfBooks = function (shelfId: number) {
  ($('filter-genre') as HTMLSelectElement).value = '';
  ($('filter-room') as HTMLSelectElement).value = '';
  ($('filter-author') as HTMLSelectElement).value = '';
  ($('book-search') as HTMLInputElement).value = '';
  ($('filter-shelf') as HTMLSelectElement).value = String(shelfId);
  currentPage = 1;
  showPendingBooks = false;
  switchView('books');
};

/** Open the room create modal. */
function initRoomModal() {
  $('btn-add-room').addEventListener('click', () => {
    ($('room-form') as HTMLFormElement).reset();
    ($('room-id') as HTMLInputElement).value = '';
    $('room-modal-title').textContent = 'הוסף חדר';
    $('room-modal').classList.add('active');
  });

  $('room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $v('room-id');
    const name = ($('room-name') as HTMLInputElement).value.trim();
    if (!name) return;

    if (id) {
      await fetch(`/api/rooms/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } else {
      await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    }
    $('room-modal').classList.remove('active');
    loadRooms();
  });

  $('btn-close-room-modal').addEventListener('click', () =>
    $('room-modal').classList.remove('active'),
  );
  $('btn-cancel-room').addEventListener('click', () =>
    $('room-modal').classList.remove('active'),
  );
}

/** Delete a room after confirmation. */
(window as any).deleteRoom = async function (id: number) {
  if (!confirm('בטוח למחוק חדר זה?')) return;
  await fetch(`/api/rooms/${id}`, { method: 'DELETE' });
  loadRooms();
};

/** Open the shelf create modal for a given room. */
(window as any).openShelfModal = function (roomId: number) {
  ($('shelf-form') as HTMLFormElement).reset();
  ($('shelf-id') as HTMLInputElement).value = '';
  ($('shelf-room-id') as HTMLInputElement).value = String(roomId);
  $('shelf-modal-title').textContent = 'הוסף מדף';
  $('shelf-modal').classList.add('active');
};

/** Save shelf (create) from the modal. */
function initShelfModal() {
  $('shelf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomId = Number($v('shelf-room-id'));
    const name = ($('shelf-name') as HTMLInputElement).value.trim();
    if (!name) return;

    await fetch(`/api/rooms/${roomId}/shelves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    $('shelf-modal').classList.remove('active');
    loadRooms();
  });

  $('btn-close-shelf-modal').addEventListener('click', () =>
    $('shelf-modal').classList.remove('active'),
  );
  $('btn-cancel-shelf').addEventListener('click', () =>
    $('shelf-modal').classList.remove('active'),
  );
}

/** Delete a shelf after confirmation. */
(window as any).deleteShelf = async function (id: number) {
  if (!confirm('בטוח למחוק מדף זה?')) return;
  await fetch(`/api/shelves/${id}`, { method: 'DELETE' });
  loadRooms();
};

// ════════════════════════════════════════════════════════════
// 8. Users view (admin)
// ════════════════════════════════════════════════════════════

/** Fetch and render the users table. */
async function loadUsers() {
  const res = await fetch('/api/users');
  if (!res.ok) return;
  allUsers = await res.json();
  renderUsers();
}

/** Render the admin users table. */
function renderUsers() {
  const container = $('users-list');
  if (allUsers.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><h3>👥</h3><p>אין משתמשים</p></div>';
    return;
  }

  const rows = allUsers
    .map((u) => {
      const roleLabel =
        u.role === 'admin'
          ? 'מנהל'
          : u.role === 'editor'
          ? 'עורך'
          : 'צופה';
      const rooms = u.allowedRoomIds
        .map((rid) => {
          const r = allRooms.find((rm) => rm.id === rid);
          return r ? escHtml(r.name) : `#${rid}`;
        })
        .join(', ');

      return `
        <tr>
          <td>${escHtml(u.username)}</td>
          <td>${roleLabel}</td>
          <td>${rooms || '—'}</td>
          <td class="row-actions">
            <button class="btn btn-primary btn-small" onclick="openUserModal(${u.id})">עריכה</button>
            <button class="btn btn-danger btn-small" onclick="deleteUser(${u.id})">מחיקה</button>
          </td>
        </tr>`;
    })
    .join('');

  container.innerHTML = `
    <table class="users-table">
      <thead>
        <tr>
          <th>שם משתמש</th>
          <th>תפקיד</th>
          <th>חדרים מותרים</th>
          <th>פעולות</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Open user modal for create or edit. */
(window as any).openUserModal = async function (userId?: number) {
  const form = $('user-form') as HTMLFormElement;
  form.reset();
  ($('user-id') as HTMLInputElement).value = '';
  $('password-hint').style.display = 'none';
  ($('user-password') as HTMLInputElement).required = true;

  // Populate room checkboxes
  const grid = $('user-rooms');
  grid.innerHTML = allRooms
    .map(
      (r) => `
        <label class="room-checkbox">
          <input type="checkbox" name="allowed_rooms" value="${r.id}"> ${escHtml(r.name)}
        </label>`,
    )
    .join('');

  if (userId) {
      $('user-modal-title').textContent = 'ערוך משתמש';
      const user = allUsers.find((u) => u.id === userId);
      if (user) {
        ($('user-id') as HTMLInputElement).value = String(user.id);
      ($('user-username') as HTMLInputElement).value = user.username;
      ($('user-role') as HTMLSelectElement).value = user.role;
      $('password-hint').style.display = '';
      ($('user-password') as HTMLInputElement).required = false;
      toggleUserRooms();
      // Check allowed rooms
      for (const rid of user.allowedRoomIds) {
        const cb = grid.querySelector(
          `input[value="${rid}"]`,
        ) as HTMLInputElement;
        if (cb) cb.checked = true;
      }
    }
  } else {
    $('user-modal-title').textContent = 'הוסף משתמש';
    toggleUserRooms();
  }
  $('user-modal').classList.add('active');
};

/** Show/hide room checkboxes based on role selection. */
function toggleUserRooms() {
  const role = ($('user-role') as HTMLSelectElement).value;
  $('user-rooms-group').style.display = role === 'editor' ? '' : 'none';
}

/** Save user (create or update) from the modal. */
function initUserModal() {
  $('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $v('user-id');
    const username = ($('user-username') as HTMLInputElement).value.trim();
    const password = ($('user-password') as HTMLInputElement).value;
    const role = ($('user-role') as HTMLSelectElement).value;

    const allowedRoomIds = Array.from(
      document.querySelectorAll('input[name="allowed_rooms"]:checked'),
    ).map((cb) => Number((cb as HTMLInputElement).value));

    const data: Record<string, any> = { username, role, allowed_room_ids: allowedRoomIds };
    if (password) data.password = password;

    if (id) {
      await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      data.password = password;
      await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    $('user-modal').classList.remove('active');
    loadUsers();
  });

  $('user-role').addEventListener('change', toggleUserRooms);
  $('btn-close-user-modal').addEventListener('click', () =>
    $('user-modal').classList.remove('active'),
  );
  $('btn-cancel-user').addEventListener('click', () =>
    $('user-modal').classList.remove('active'),
  );
}

/** Delete a user after confirmation. */
(window as any).deleteUser = async function (id: number) {
  if (!confirm('בטוח למחוק משתמש זה?')) return;
  await fetch(`/api/users/${id}`, { method: 'DELETE' });
  loadUsers();
};

// ════════════════════════════════════════════════════════════
// 9. Profile modal (self-service password change)
// ════════════════════════════════════════════════════════════

function initProfileModal() {
  $('btn-profile').addEventListener('click', () => {
    ($('profile-form') as HTMLFormElement).reset();
    $('profile-error').style.display = 'none';
    $('profile-modal').classList.add('active');
  });

  $('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = ($('profile-current-password') as HTMLInputElement).value;
    const newPw = ($('profile-new-password') as HTMLInputElement).value;
    const confirm = ($('profile-confirm-password') as HTMLInputElement).value;
    const errEl = $('profile-error');

    if (newPw !== confirm) {
      errEl.textContent = 'הסיסמאות אינן תואמות';
      errEl.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: current,
          new_password: newPw,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        errEl.textContent = data.error || 'שגיאה';
        errEl.style.display = 'block';
        return;
      }
      $('profile-modal').classList.remove('active');
      alert('הסיסמה שונתה בהצלחה');
    } catch {
      errEl.textContent = 'שגיאת רשת';
      errEl.style.display = 'block';
    }
  });

  $('btn-close-profile-modal').addEventListener('click', () =>
    $('profile-modal').classList.remove('active'),
  );
  $('btn-cancel-profile').addEventListener('click', () =>
    $('profile-modal').classList.remove('active'),
  );
}

// ════════════════════════════════════════════════════════════
// 10. Boot
// ════════════════════════════════════════════════════════════

/** Escape HTML to prevent XSS in rendered strings. */
function escHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Initialize all event listeners and try to restore the session. */
function boot() {
  initLoginForm();
  initLogout();
  initRoomModal();
  initShelfModal();
  initUserModal();
  initProfileModal();

  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (view) switchView(view);
    });
  });

  // Book search with debounce
  $('book-search').addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      loadBooks();
    }, 300);
  });

  // Filter dropdowns → reload books
  ['filter-genre', 'filter-room', 'filter-shelf', 'filter-author'].forEach((id) => {
    $(id).addEventListener('change', () => {
      currentPage = 1;
      loadBooks();
    });
  });

  // Clear filters button
  document
    .querySelector('[data-action="clear-filters"]')
    ?.addEventListener('click', () => {
      ($('filter-genre') as HTMLSelectElement).value = '';
      ($('filter-room') as HTMLSelectElement).value = '';
      ($('filter-shelf') as HTMLSelectElement).value = '';
      ($('filter-author') as HTMLSelectElement).value = '';
      ($('book-search') as HTMLInputElement).value = '';
      showPendingBooks = false;
      currentPage = 1;
      loadBooks();
    });

  // Book modal buttons
  $('btn-add-book').addEventListener('click', () =>
    (window as any).openBookModal(),
  );
  $('book-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveBook();
  });
  $('btn-close-book-modal').addEventListener('click', () =>
    $('book-modal').classList.remove('active'),
  );
  $('btn-cancel-book').addEventListener('click', () =>
    $('book-modal').classList.remove('active'),
  );

  // Genre autocomplete
  initGenreAutocomplete();

  tryRestoreSession();
}

/** Set up genre input autocomplete suggestions. */
function initGenreAutocomplete() {
  const input = $('book-genre') as HTMLInputElement;
  const list = $('genre-suggestions');

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val) {
      list.style.display = 'none';
      return;
    }
    const matches = genres.filter((g) => g.toLowerCase().includes(val));
    if (matches.length === 0) {
      list.style.display = 'none';
      return;
    }
    list.innerHTML = matches
      .map((g) => `<li onclick="selectGenre('${escHtml(g)}')">${escHtml(g)}</li>`)
      .join('');
    list.style.display = 'block';
  });

  input.addEventListener('blur', () => {
    setTimeout(() => (list.style.display = 'none'), 150);
  });
}

/** Fill the genre input from autocomplete suggestion. */
(window as any).selectGenre = function (genre: string) {
  ($('book-genre') as HTMLInputElement).value = genre;
  $('genre-suggestions').style.display = 'none';
};

/** Load dashboard stats (admin only). */
async function loadDashboard() {
  const res = await fetch('/api/stats');
  if (!res.ok) return;
  const s = await res.json();
  $('stats').innerHTML = `
    <div class="stat-card"><h3>${s.books}</h3><p>ספרים</p></div>
    <div class="stat-card"><h3>${s.shelves}</h3><p>מדפים</p></div>
    <div class="stat-card"><h3>${s.rooms}</h3><p>חדרים</p></div>
    <div class="stat-card"><h3>${s.users}</h3><p>משתמשים</p></div>
    <div class="stat-card"><h3>${s.pendingBooks}</h3><p>ספרים ממתינים</p></div>`;
}

/** Initialize filter dropdown options from cached data. */
function populateFilters() {
  // Genres
  const g = $('filter-genre') as HTMLSelectElement;
  g.innerHTML = '<option value="">כל הז\'אנרים</option>';
  genres.forEach((gen) => {
    const opt = document.createElement('option');
    opt.value = gen;
    opt.textContent = gen;
    g.appendChild(opt);
  });

  // Rooms
  const r = $('filter-room') as HTMLSelectElement;
  r.innerHTML = '<option value="">כל החדרים</option>';
  allRooms.forEach((room) => {
    const opt = document.createElement('option');
    opt.value = String(room.id);
    opt.textContent = room.name;
    r.appendChild(opt);
  });

  // Shelves
  const s = $('filter-shelf') as HTMLSelectElement;
  s.innerHTML = '<option value="">כל המדפים</option>';
  allShelves.forEach((shelf) => {
    const opt = document.createElement('option');
    opt.value = String(shelf.id);
    opt.textContent = shelf.name;
    s.appendChild(opt);
  });

  // Authors
  const a = $('filter-author') as HTMLSelectElement;
  a.innerHTML = '<option value="">כל המחברים</option>';
  authors.forEach((auth) => {
    const opt = document.createElement('option');
    opt.value = auth;
    opt.textContent = auth;
    a.appendChild(opt);
  });
}

/** Fetch all reference data needed for filter dropdowns and autocomplete. */
async function fetchAllData() {
  const [genresRes, authorsRes, roomsRes] = await Promise.all([
    fetch('/api/genres'),
    fetch('/api/authors'),
    fetch('/api/rooms'),
  ]);
  if (genresRes.ok) genres = await genresRes.json();
  if (authorsRes.ok) authors = await authorsRes.json();
  if (roomsRes.ok) allRooms = await roomsRes.json();

  // Fetch all shelves
  const shelvesArrays = await Promise.all(
    allRooms.map((r) =>
      fetch(`/api/rooms/${r.id}/shelves`).then((res) =>
        res.ok ? res.json() : ([] as Shelf[]),
      ),
    ),
  );
  allShelves = shelvesArrays.flat();
  populateFilters();
}

// ── Start ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  boot();
  fetchAllData();
});
