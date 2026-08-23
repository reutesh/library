// ========== TYPES ==========

interface Book {
  id: number;
  title: string;
  author: string | null;
  isbn: string | null;
  genre: string | null;
  shelf_id: number | null;
  room_id: number | null;
  notes: string | null;
  shelf_name: string | null;
  room_name: string | null;
}

interface BooksPage {
  data: Book[];
  total: number;
  page: number;
  limit: number;
}

interface Shelf {
  id: number;
  room_id: number;
  name: string;
  room_name: string;
  book_count: number;
}

interface Room {
  id: number;
  name: string;
  book_count: number;
}

type Role = 'admin' | 'editor' | 'viewer';

interface PublicUser {
  id: number;
  username: string;
  role: Role;
  allowed_room_ids: number[];
}

interface UserRow extends PublicUser {
  created_at: string;
}

// ========== API ==========

const api = {
  async get(url: string) {
    const res = await fetch('/api' + url);
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  },
  async post(url: string, data: unknown) {
    const res = await fetch('/api' + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  },
  async put(url: string, data: unknown) {
    const res = await fetch('/api' + url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  },
  async del(url: string) {
    const res = await fetch('/api' + url, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  },
};

// ========== STATE ==========

let currentUser: PublicUser | null = null;
let currentView = 'dashboard';
let activeFilters: { search: string; shelf_id: string; room_id: string; genre: string; author: string } = {
  search: '', shelf_id: '', room_id: '', genre: '', author: '',
};
let pendingBookShelfId: number | null = null;

let cacheRooms: Room[] = [];
let cacheShelves: Shelf[] = [];
let cacheGenres: string[] = [];
let cacheAuthors: string[] = [];

let booksPage = 1;
let pageSize = 24;
let totalBooks = 0;
let lastPageBooks: Book[] = [];
let lastUsers: UserRow[] = [];

// ========== PERMISSIONS ==========

function isAdmin(): boolean {
  return currentUser?.role === 'admin';
}

function roleLabel(role: Role): string {
  if (role === 'admin') return 'מנהל';
  if (role === 'editor') return 'עורך';
  return 'צופה';
}

function canEditRoom(roomId: number | null | undefined): boolean {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role !== 'editor') return false;
  return roomId != null && currentUser.allowed_room_ids.includes(Number(roomId));
}

function canEditBook(book: Book): boolean {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role !== 'editor') return false;
  return book.room_id != null && currentUser.allowed_room_ids.includes(book.room_id);
}

function canCreateBooks(): boolean {
  return !!currentUser && currentUser.role !== 'viewer';
}

// ========== AUTH FLOW ==========

async function boot(): Promise<void> {
  try {
    currentUser = await api.get('/auth/me') as PublicUser;
    enterApp();
  } catch {
    showLogin();
  }
}

function showLogin(): void {
  document.getElementById('login-screen')!.classList.add('active');
}

async function handleLogin(e: Event): Promise<void> {
  e.preventDefault();
  const errorEl = document.getElementById('login-error')!;
  errorEl.style.display = 'none';
  const username = (document.getElementById('login-username') as HTMLInputElement).value.trim();
  const password = (document.getElementById('login-password') as HTMLInputElement).value;
  try {
    currentUser = await api.post('/auth/login', { username, password }) as PublicUser;
    enterApp();
  } catch (err: any) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
}

function enterApp(): void {
  document.getElementById('login-screen')!.classList.remove('active');
  applyRoleUI();
  fetchAllData().then(() => loadView(currentView)).catch(err => alert(err.message));
}

async function logout(): Promise<void> {
  try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
  location.reload();
}

function applyRoleUI(): void {
  if (!currentUser) return;
  document.getElementById('user-box')!.style.display = 'flex';
  document.getElementById('user-name')!.textContent = currentUser.username;
  const badge = document.getElementById('user-role-badge')!;
  badge.textContent = roleLabel(currentUser.role);
  badge.className = 'role-badge badge-' + currentUser.role;
  document.getElementById('nav-users')!.style.display = isAdmin() ? '' : 'none';
  document.getElementById('btn-add-room')!.style.display = isAdmin() ? '' : 'none';
}

// ========== CACHE ==========

async function fetchAllData(): Promise<void> {
  const [rooms, shelves, genres, authors] = await Promise.all([
    api.get('/rooms') as Promise<Room[]>,
    api.get('/shelves') as Promise<Shelf[]>,
    api.get('/genres') as Promise<string[]>,
    api.get('/authors') as Promise<string[]>,
  ]);
  cacheRooms = rooms;
  cacheShelves = shelves;
  cacheGenres = genres;
  cacheAuthors = authors;
}

// ========== GENRE AUTOCOMPLETE ==========

function setupGenreAutocomplete(): void {
  const input = document.getElementById('book-genre') as HTMLInputElement;
  const list = document.getElementById('genre-suggestions') as HTMLUListElement;
  if (!input || !list) return;

  input.oninput = () => {
    const val = input.value.trim().toLowerCase();
    list.innerHTML = '';
    if (!val) { list.style.display = 'none'; return; }
    const matches = cacheGenres.filter(g => g.toLowerCase().includes(val) && g.toLowerCase() !== val);
    if (!matches.length) { list.style.display = 'none'; return; }
    list.style.display = 'block';
    matches.forEach(genre => {
      const li = document.createElement('li');
      li.textContent = genre;
      li.onmousedown = () => { input.value = genre; list.style.display = 'none'; };
      list.appendChild(li);
    });
  };

  input.onblur = () => { setTimeout(() => { list.style.display = 'none'; }, 200); };
}

// ========== NAVIGATION ==========

function switchTo(view: string): void {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-view="${view}"]`)!.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view)!.classList.add('active');
  currentView = view;
  loadView(view);
}

function initNav(): void {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTo((btn as HTMLElement).dataset.view!));
  });
}

function loadView(view: string): void {
  switch (view) {
    case 'dashboard': loadDashboard(); break;
    case 'books':
      pendingBookShelfId = null;
      booksPage = 1;
      resetBooksHeader();
      loadFilterDropdowns();
      setupFilterListeners();
      activeFilters = { search: '', shelf_id: '', room_id: '', genre: '', author: '' };
      loadBooks();
      break;
    case 'rooms': loadRooms(); break;
    case 'users': loadUsers(); break;
  }
}

// ========== DASHBOARD ==========

async function loadDashboard(): Promise<void> {
  const [stats, unassigned] = await Promise.all([
    api.get('/stats') as Promise<{ total_books: number; total_rooms: number; total_shelves: number; unassigned_books: number }>,
    api.get('/books?shelf_id=none&limit=8') as Promise<BooksPage>,
  ]);
  document.getElementById('stats')!.innerHTML = `
    <div class="stat-card"><h3>${stats.total_books}</h3><p>ספרים</p></div>
    <div class="stat-card"><h3>${stats.total_rooms}</h3><p>חדרים</p></div>
    <div class="stat-card"><h3>${stats.total_shelves}</h3><p>מדפים</p></div>
    <div class="stat-card"><h3>${stats.unassigned_books}</h3><p>לא מוקצים</p></div>
  `;
  const container = document.getElementById('unassigned-books')!;
  if (!unassigned.data.length) {
    container.innerHTML = '<div class="empty-state"><p>כל הספרים מוקצים למדפים!</p></div>';
  } else {
    container.innerHTML = unassigned.data.map(bookCard).join('');
  }
}

// ========== BOOKS ==========

let searchTimeout: ReturnType<typeof setTimeout>;

function initBookSearch(): void {
  document.getElementById('book-search')!.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      activeFilters.search = (e.target as HTMLInputElement).value;
      booksPage = 1;
      loadBooks();
    }, 300);
  });
}

function renderBooks(books: Book[]): void {
  const container = document.getElementById('books-list')!;
  if (!books.length) {
    container.innerHTML = '<div class="empty-state"><h3>לא נמצאו ספרים</h3><p>אין ספרים התואמים את הסינון</p></div>';
  } else {
    container.innerHTML = books.map(bookCard).join('');
  }
}

async function loadBooks(): Promise<void> {
  const params = new URLSearchParams();
  if (activeFilters.search) params.set('search', activeFilters.search);
  if (activeFilters.shelf_id) params.set('shelf_id', activeFilters.shelf_id);
  if (activeFilters.room_id) params.set('room_id', activeFilters.room_id);
  if (activeFilters.genre) params.set('genre', activeFilters.genre);
  if (activeFilters.author) params.set('author', activeFilters.author);
  params.set('page', String(booksPage));
  params.set('limit', String(pageSize));
  try {
    const res = await api.get('/books?' + params.toString()) as BooksPage;
    totalBooks = res.total;
    lastPageBooks = res.data;
    renderBooks(res.data);
    renderPagination();
  } catch (err: any) {
    alert(err.message);
  }
}

function renderPagination(): void {
  const container = document.getElementById('pagination-bar')!;
  const totalPages = Math.max(1, Math.ceil(totalBooks / pageSize));
  if (booksPage > totalPages) {
    booksPage = totalPages;
    void loadBooks();
    return;
  }
  if (!totalBooks) {
    container.innerHTML = '';
    return;
  }

  let numbers = '';
  const windowSize = 5;
  let start = Math.max(1, booksPage - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  for (let p = start; p <= end; p++) {
    numbers += `<button class="btn btn-small page-btn ${p === booksPage ? 'btn-primary' : 'btn-secondary'}" data-action="goto-page" data-page="${p}">${p}</button>`;
  }

  container.innerHTML = `
    <div class="pagination-info">${totalBooks} ספרים · עמוד ${booksPage} מתוך ${totalPages}</div>
    <div class="pagination-controls">
      <button class="btn btn-secondary btn-small" data-action="goto-page" data-page="${booksPage - 1}" ${booksPage <= 1 ? 'disabled' : ''}>הקודם</button>
      ${numbers}
      <button class="btn btn-secondary btn-small" data-action="goto-page" data-page="${booksPage + 1}" ${booksPage >= totalPages ? 'disabled' : ''}>הבא</button>
      <select id="page-size" title="כמות לדף">
        ${[12, 24, 48, 96].map(n => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n} לדף</option>`).join('')}
      </select>
    </div>
  `;
  document.getElementById('page-size')!.addEventListener('change', (e) => {
    pageSize = Number((e.target as HTMLSelectElement).value);
    booksPage = 1;
    loadBooks();
  });
}

function loadFilterDropdowns(): void {
  const roomSelect = document.getElementById('filter-room') as HTMLSelectElement;
  const shelfSelect = document.getElementById('filter-shelf') as HTMLSelectElement;
  const genreSelect = document.getElementById('filter-genre') as HTMLSelectElement;
  const authorSelect = document.getElementById('filter-author') as HTMLSelectElement;

  const currentRoom = roomSelect.value;
  const currentShelf = shelfSelect.value;
  const currentGenre = genreSelect.value;
  const currentAuthor = authorSelect.value;

  roomSelect.innerHTML = '<option value="">כל החדרים</option>';
  cacheRooms.forEach(r => {
    const opt = document.createElement('option');
    opt.value = String(r.id);
    opt.textContent = r.name;
    roomSelect.appendChild(opt);
  });

  shelfSelect.innerHTML = '<option value="">כל המדפים</option>';
  let lastRoom = '';
  cacheShelves.forEach(s => {
    if (s.room_name !== lastRoom) {
      const grp = document.createElement('optgroup');
      grp.label = s.room_name;
      shelfSelect.appendChild(grp);
      lastRoom = s.room_name;
    }
    const opt = document.createElement('option');
    opt.value = String(s.id);
    opt.textContent = s.name;
    (shelfSelect.lastChild as HTMLOptGroupElement).appendChild(opt);
  });

  genreSelect.innerHTML = '<option value="">כל הז\u2019אנרים</option>';
  cacheGenres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    genreSelect.appendChild(opt);
  });

  authorSelect.innerHTML = '<option value="">כל המחברים</option>';
  cacheAuthors.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    authorSelect.appendChild(opt);
  });

  roomSelect.value = currentRoom;
  shelfSelect.value = currentShelf;
  genreSelect.value = currentGenre;
  authorSelect.value = currentAuthor;
}

function setupFilterListeners(): void {
  ['filter-room', 'filter-shelf', 'filter-genre', 'filter-author'].forEach(id => {
    document.getElementById(id)!.addEventListener('change', (e) => {
      const key = id.replace('filter-', '') as keyof typeof activeFilters;
      activeFilters[key] = (e.target as HTMLSelectElement).value;
      booksPage = 1;
      loadBooks();
    });
  });
}

function clearFilters(): void {
  activeFilters = { search: '', shelf_id: '', room_id: '', genre: '', author: '' };
  booksPage = 1;
  (document.getElementById('book-search') as HTMLInputElement).value = '';
  (document.getElementById('filter-room') as HTMLSelectElement).value = '';
  (document.getElementById('filter-shelf') as HTMLSelectElement).value = '';
  (document.getElementById('filter-genre') as HTMLSelectElement).value = '';
  (document.getElementById('filter-author') as HTMLSelectElement).value = '';
  loadBooks();
}

function viewShelfBooks(shelfId: number, shelfName: string): void {
  switchToBooksDirect();
  const headerEl = document.getElementById('books-view-header')!;
  headerEl.innerHTML = `
    <button class="btn btn-secondary btn-small" data-action="back-to-rooms">← חזרה לחדרים</button>
    <h2>ספרים במדף: ${esc(shelfName)}</h2>
    <div class="actions">
      ${canCreateBooks() ? '<button class="btn btn-primary" id="btn-add-book">+ הוסף ספר</button>' : ''}
    </div>
  `;
  const addBtn = document.getElementById('btn-add-book');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      pendingBookShelfId = shelfId;
      openBookModal();
    });
  }

  activeFilters = { search: '', shelf_id: String(shelfId), room_id: '', genre: '', author: '' };
  booksPage = 1;
  (document.getElementById('book-search') as HTMLInputElement).value = '';
  loadFilterDropdowns();
  setupFilterListeners();
  loadBooks();
}

function switchToBooksDirect(): void {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="books"]')!.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-books')!.classList.add('active');
  currentView = 'books';
}

function resetBooksHeader(): void {
  const headerEl = document.getElementById('books-view-header')!;
  headerEl.innerHTML = `
    <h2>הספרים שלי</h2>
    <div class="actions">
      <input type="text" id="book-search" placeholder="חיפוש ספרים...">
      ${canCreateBooks() ? '<button class="btn btn-primary" id="btn-add-book">+ הוסף ספר</button>' : ''}
    </div>
  `;
  document.getElementById('book-search')!.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      activeFilters.search = (e.target as HTMLInputElement).value;
      booksPage = 1;
      loadBooks();
    }, 300);
  });
  const addBtn = document.getElementById('btn-add-book');
  if (addBtn) addBtn.addEventListener('click', () => openBookModal());
}

// ========== BOOK MODAL ==========

function bookCard(book: Book): string {
  const location = book.room_name
    ? `<div class="location">${esc(book.room_name)} › ${esc(book.shelf_name!)}</div>`
    : '<div class="location" style="color:#999">לא מוקצה</div>';
  const actions = canEditBook(book)
    ? `<div class="actions">
        <button class="btn btn-primary btn-small" data-action="edit-book" data-id="${book.id}">ערוך</button>
        <button class="btn btn-danger btn-small" data-action="delete-book" data-id="${book.id}">מחק</button>
      </div>`
    : '';
  return `
    <div class="book-card">
      <h4>${esc(book.title)}</h4>
      ${book.author ? `<div class="author">${esc(book.author)}</div>` : ''}
      <div class="meta">
        ${book.isbn ? `<span class="tag">ISBN: ${esc(book.isbn)}</span>` : ''}
        ${book.genre ? `<span class="tag">${esc(book.genre)}</span>` : ''}
      </div>
      ${location}
      ${book.notes ? `<p style="font-size:0.85rem;color:#666;margin-top:0.3rem">${esc(book.notes)}</p>` : ''}
      ${actions}
    </div>
  `;
}

function openBookModal(book: Book | null = null): void {
  loadShelfSelect(book?.shelf_id ?? null);
  setupGenreAutocomplete();
  if (book) {
    document.getElementById('book-modal-title')!.textContent = 'ערוך ספר';
    (document.getElementById('book-id') as HTMLInputElement).value = String(book.id);
    (document.getElementById('book-title') as HTMLInputElement).value = book.title;
    (document.getElementById('book-author') as HTMLInputElement).value = book.author || '';
    (document.getElementById('book-isbn') as HTMLInputElement).value = book.isbn || '';
    (document.getElementById('book-genre') as HTMLInputElement).value = book.genre || '';
    (document.getElementById('book-shelf') as HTMLSelectElement).value = book.shelf_id ? String(book.shelf_id) : '';
    (document.getElementById('book-notes') as HTMLTextAreaElement).value = book.notes || '';
  } else {
    document.getElementById('book-modal-title')!.textContent = 'הוסף ספר';
    (document.getElementById('book-form') as HTMLFormElement).reset();
    (document.getElementById('book-id') as HTMLInputElement).value = '';
    if (pendingBookShelfId) {
      (document.getElementById('book-shelf') as HTMLSelectElement).value = String(pendingBookShelfId);
    }
  }
  document.getElementById('book-modal')!.classList.add('active');
}

function closeBookModal(): void {
  document.getElementById('book-modal')!.classList.remove('active');
}

async function saveBook(e: Event): Promise<void> {
  e.preventDefault();
  const id = (document.getElementById('book-id') as HTMLInputElement).value;
  const data = {
    title: (document.getElementById('book-title') as HTMLInputElement).value,
    author: (document.getElementById('book-author') as HTMLInputElement).value || null,
    isbn: (document.getElementById('book-isbn') as HTMLInputElement).value || null,
    genre: (document.getElementById('book-genre') as HTMLInputElement).value || null,
    shelf_id: (document.getElementById('book-shelf') as HTMLSelectElement).value
      ? Number((document.getElementById('book-shelf') as HTMLSelectElement).value)
      : null,
    notes: (document.getElementById('book-notes') as HTMLTextAreaElement).value || null,
  };
  try {
    if (id) await api.put('/books/' + id, data);
    else await api.post('/books', data);
    closeBookModal();
    pendingBookShelfId = null;
    await refreshAfterChange();
  } catch (err: any) {
    alert(err.message);
  }
}

async function deleteBook(id: number): Promise<void> {
  if (!confirm('למחוק ספר זה?')) return;
  try {
    await api.del('/books/' + id);
    await refreshAfterChange();
  } catch (err: any) {
    alert(err.message);
  }
}

async function refreshAfterChange(): Promise<void> {
  if (currentView === 'books') {
    await fetchAllData().catch(() => undefined);
    loadBooks();
  } else {
    await fetchAllData();
    loadView(currentView);
  }
}

function editBook(id: number): void {
  const book = lastPageBooks.find(b => b.id === id);
  if (book) openBookModal(book);
}

// ========== SHELF SELECT ==========

function loadShelfSelect(selectedShelfId: number | null): void {
  const select = document.getElementById('book-shelf') as HTMLSelectElement;
  select.innerHTML = '<option value="">לא מוקצה</option>';
  let currentRoom = '';
  let optgroup: HTMLOptGroupElement | null = null;

  cacheShelves.forEach(shelf => {
    if (shelf.room_name !== currentRoom) {
      optgroup = document.createElement('optgroup');
      optgroup.label = shelf.room_name;
      select.appendChild(optgroup);
      currentRoom = shelf.room_name;
    }
    const opt = document.createElement('option');
    opt.value = String(shelf.id);
    if (!canEditRoom(shelf.room_id)) {
      opt.disabled = true;
      opt.textContent = shelf.name + ' — אין הרשאת עריכה';
    } else {
      opt.textContent = shelf.name;
    }
    optgroup!.appendChild(opt);
  });

  if (selectedShelfId) select.value = String(selectedShelfId);
  if (pendingBookShelfId && !selectedShelfId) select.value = String(pendingBookShelfId);
}

// ========== ROOMS ==========

function loadRooms(): void {
  const container = document.getElementById('rooms-list')!;

  if (!cacheRooms.length) {
    container.innerHTML = '<div class="empty-state"><h3>אין חדרים עדיין</h3><p>הוסף חדר כדי להתחיל לארגן את הספרים</p></div>';
    return;
  }

  container.innerHTML = cacheRooms.map(room => {
    const editable = canEditRoom(room.id);
    const roomActions = isAdmin()
      ? `<button class="btn btn-primary btn-small" data-action="edit-room" data-id="${room.id}">ערוך</button>
         <button class="btn btn-danger btn-small" data-action="delete-room" data-id="${room.id}">מחק</button>`
      : '';
    const roomShelves = cacheShelves.filter(s => s.room_id === room.id);
    return `
      <div class="room-card">
        <div class="room-header">
          <h3>${esc(room.name)}</h3>
          <div class="room-actions">
            <span class="book-count">${room.book_count} ספרים</span>
            ${roomActions}
          </div>
        </div>
        <div class="room-body">
          <div class="shelves-grid">
            ${roomShelves.map(shelf => {
              const shelfActions = editable
                ? `<div class="actions">
                    <button class="btn btn-primary btn-small" data-action="edit-shelf" data-id="${shelf.id}">ערוך</button>
                    <button class="btn btn-danger btn-small" data-action="delete-shelf" data-id="${shelf.id}">מחק</button>
                  </div>`
                : '';
              return `
                <div class="shelf-card" data-action="view-shelf" data-id="${shelf.id}" data-name="${esc(shelf.name)}">
                  <h4>${esc(shelf.name)}</h4>
                  <div class="book-count">${shelf.book_count} ספרים</div>
                  ${shelfActions}
                </div>
              `;
            }).join('')}
            ${editable ? `<div class="add-shelf-btn" data-action="add-shelf" data-room-id="${room.id}">+ הוסף מדף</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openRoomModal(room: Room | null = null): void {
  if (room) {
    document.getElementById('room-modal-title')!.textContent = 'ערוך חדר';
    (document.getElementById('room-id') as HTMLInputElement).value = String(room.id);
    (document.getElementById('room-name') as HTMLInputElement).value = room.name;
  } else {
    document.getElementById('room-modal-title')!.textContent = 'הוסף חדר';
    (document.getElementById('room-form') as HTMLFormElement).reset();
    (document.getElementById('room-id') as HTMLInputElement).value = '';
  }
  document.getElementById('room-modal')!.classList.add('active');
}

function closeRoomModal(): void {
  document.getElementById('room-modal')!.classList.remove('active');
}

async function saveRoom(e: Event): Promise<void> {
  e.preventDefault();
  const id = (document.getElementById('room-id') as HTMLInputElement).value;
  const data = {
    name: (document.getElementById('room-name') as HTMLInputElement).value,
  };
  try {
    if (id) await api.put('/rooms/' + id, data);
    else await api.post('/rooms', data);
    closeRoomModal();
    await fetchAllData();
    loadRooms();
  } catch (err: any) {
    alert(err.message);
  }
}

async function deleteRoom(id: number): Promise<void> {
  if (!confirm('למחוק חדר זה וכל מדפיו? הספרים יפונו.')) return;
  try {
    await api.del('/rooms/' + id);
    await fetchAllData();
    loadRooms();
  } catch (err: any) {
    alert(err.message);
  }
}

// ========== SHELF MODAL ==========

function openShelfModal(roomId: number, shelf: Shelf | null = null): void {
  (document.getElementById('shelf-room-id') as HTMLInputElement).value = String(roomId);
  if (shelf) {
    document.getElementById('shelf-modal-title')!.textContent = 'ערוך מדף';
    (document.getElementById('shelf-id') as HTMLInputElement).value = String(shelf.id);
    (document.getElementById('shelf-name') as HTMLInputElement).value = shelf.name;
  } else {
    document.getElementById('shelf-modal-title')!.textContent = 'הוסף מדף';
    (document.getElementById('shelf-form') as HTMLFormElement).reset();
    (document.getElementById('shelf-id') as HTMLInputElement).value = '';
    (document.getElementById('shelf-room-id') as HTMLInputElement).value = String(roomId);
  }
  document.getElementById('shelf-modal')!.classList.add('active');
}

function closeShelfModal(): void {
  document.getElementById('shelf-modal')!.classList.remove('active');
}

async function saveShelf(e: Event): Promise<void> {
  e.preventDefault();
  const id = (document.getElementById('shelf-id') as HTMLInputElement).value;
  const data = {
    room_id: Number((document.getElementById('shelf-room-id') as HTMLInputElement).value),
    name: (document.getElementById('shelf-name') as HTMLInputElement).value,
  };
  try {
    if (id) await api.put('/shelves/' + id, data);
    else await api.post('/shelves', data);
    closeShelfModal();
    await fetchAllData();
    loadRooms();
  } catch (err: any) {
    alert(err.message);
  }
}

async function deleteShelf(id: number): Promise<void> {
  if (!confirm('למחוק מדף זה? הספרים עליו יפונו.')) return;
  try {
    await api.del('/shelves/' + id);
    await fetchAllData();
    loadRooms();
  } catch (err: any) {
    alert(err.message);
  }
}

// ========== USERS (admin) ==========

async function loadUsers(): Promise<void> {
  try {
    lastUsers = await api.get('/users') as UserRow[];
    renderUsers();
  } catch (err: any) {
    alert(err.message);
  }
}

function renderUsers(): void {
  const container = document.getElementById('users-list')!;
  const rows = lastUsers.map(u => {
    const perms = u.role === 'editor'
      ? (u.allowed_room_ids?.length
        ? `${u.allowed_room_ids.length} חדרים`
        : 'אין חדרים מוקצים')
      : (u.role === 'admin' ? 'הכל' : '—');
    const deleteBtn = currentUser && u.id !== currentUser.id
      ? `<button class="btn btn-danger btn-small" data-action="delete-user" data-id="${u.id}" data-name="${esc(u.username)}">מחק</button>`
      : '';
    return `
      <tr>
        <td>${esc(u.username)}${currentUser && u.id === currentUser.id ? ' <span class="tag">(אתה)</span>' : ''}</td>
        <td><span class="role-badge badge-${u.role}">${roleLabel(u.role)}</span></td>
        <td>${perms}</td>
        <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('he-IL') : ''}</td>
        <td class="row-actions">
          <button class="btn btn-primary btn-small" data-action="edit-user" data-id="${u.id}">ערוך</button>
          ${deleteBtn}
        </td>
      </tr>
    `;
  }).join('');
  container.innerHTML = `
    <table class="users-table">
      <thead>
        <tr><th>שם משתמש</th><th>תפקיד</th><th>הרשאות עריכה</th><th>נוצר</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function openUserModal(user: UserRow | null = null): void {
  buildUserRoomCheckboxes(user?.allowed_room_ids || []);
  const roleSelect = document.getElementById('user-role') as HTMLSelectElement;
  const passwordInput = document.getElementById('user-password') as HTMLInputElement;
  const hint = document.getElementById('password-hint')!;
  if (user) {
    document.getElementById('user-modal-title')!.textContent = 'ערוך משתמש';
    (document.getElementById('user-id') as HTMLInputElement).value = String(user.id);
    (document.getElementById('user-username') as HTMLInputElement).value = user.username;
    passwordInput.value = '';
    passwordInput.required = false;
    hint.style.display = 'block';
    roleSelect.value = user.role;
  } else {
    document.getElementById('user-modal-title')!.textContent = 'הוסף משתמש';
    (document.getElementById('user-form') as HTMLFormElement).reset();
    (document.getElementById('user-id') as HTMLInputElement).value = '';
    passwordInput.required = true;
    hint.style.display = 'none';
    roleSelect.value = 'viewer';
  }
  toggleUserRoomsGroup();
  document.getElementById('user-modal')!.classList.add('active');
}

function closeUserModal(): void {
  document.getElementById('user-modal')!.classList.remove('active');
}

function buildUserRoomCheckboxes(allowedIds: number[]): void {
  const container = document.getElementById('user-rooms')!;
  container.innerHTML = cacheRooms.map(r => `
    <label class="room-checkbox">
      <input type="checkbox" value="${r.id}" ${allowedIds.includes(r.id) ? 'checked' : ''}>
      ${esc(r.name)}
    </label>
  `).join('');
}

function toggleUserRoomsGroup(): void {
  const role = (document.getElementById('user-role') as HTMLSelectElement).value;
  document.getElementById('user-rooms-group')!.style.display = role === 'editor' ? '' : 'none';
}

async function saveUser(e: Event): Promise<void> {
  e.preventDefault();
  const id = (document.getElementById('user-id') as HTMLInputElement).value;
  const username = (document.getElementById('user-username') as HTMLInputElement).value.trim();
  const password = (document.getElementById('user-password') as HTMLInputElement).value;
  const role = (document.getElementById('user-role') as HTMLSelectElement).value as Role;
  const allowed_room_ids = Array.from(
    document.querySelectorAll<HTMLInputElement>('#user-rooms input:checked')
  ).map(cb => Number(cb.value));

  if (!id && password.length < 6) {
    alert('סיסמה חייבת להכיל לפחות 6 תווים');
    return;
  }

  const data: Record<string, unknown> = { username, role };
  if (!id || password) data.password = password;
  if (role === 'editor') data.allowed_room_ids = allowed_room_ids;

  try {
    if (id) await api.put('/users/' + id, data);
    else await api.post('/users', data);
    closeUserModal();
    await loadUsers();
  } catch (err: any) {
    alert(err.message);
  }
}

async function deleteUser(id: number, username: string): Promise<void> {
  if (!confirm(`למחוק את המשתמש "${username}"?`)) return;
  try {
    await api.del('/users/' + id);
    await loadUsers();
  } catch (err: any) {
    alert(err.message);
  }
}

// ========== UTILS ==========

function esc(str: string): string {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== DELEGATED EVENT HANDLERS ==========

function initDelegatedHandlers(): void {
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
    if (!target) return;
    const action = target.dataset.action!;
    const id = Number(target.dataset.id);
    const roomId = Number(target.dataset.roomId);
    const name = target.dataset.name || '';

    switch (action) {
      case 'edit-book': editBook(id); break;
      case 'delete-book': deleteBook(id); break;
      case 'edit-room': {
        const room = cacheRooms.find(r => r.id === id);
        if (room) openRoomModal(room);
        break;
      }
      case 'delete-room': deleteRoom(id); break;
      case 'edit-shelf': {
        const shelf = cacheShelves.find(s => s.id === id);
        if (shelf) openShelfModal(shelf.room_id, shelf);
        break;
      }
      case 'delete-shelf': deleteShelf(id); break;
      case 'add-shelf': openShelfModal(roomId); break;
      case 'view-shelf': viewShelfBooks(id, name); break;
      case 'clear-filters': clearFilters(); break;
      case 'goto-page':
        booksPage = Number(target.dataset.page);
        loadBooks();
        break;
      case 'edit-user': {
        const user = lastUsers.find(u => u.id === id);
        if (user) openUserModal(user);
        break;
      }
      case 'delete-user': deleteUser(id, name); break;
      case 'back-to-rooms': switchTo('rooms'); break;
    }
  });
}

// ========== INIT ==========

document.getElementById('login-form')!.addEventListener('submit', handleLogin);
document.getElementById('btn-logout')!.addEventListener('click', logout);

const addBookBtn = document.getElementById('btn-add-book');
if (addBookBtn) addBookBtn.addEventListener('click', () => openBookModal());
document.getElementById('btn-add-room')!.addEventListener('click', () => openRoomModal());
document.getElementById('btn-close-book-modal')!.addEventListener('click', closeBookModal);
document.getElementById('btn-cancel-book')!.addEventListener('click', closeBookModal);
document.getElementById('btn-close-room-modal')!.addEventListener('click', closeRoomModal);
document.getElementById('btn-cancel-room')!.addEventListener('click', closeRoomModal);
document.getElementById('btn-close-shelf-modal')!.addEventListener('click', closeShelfModal);
document.getElementById('btn-cancel-shelf')!.addEventListener('click', closeShelfModal);
document.getElementById('book-form')!.addEventListener('submit', saveBook);
document.getElementById('room-form')!.addEventListener('submit', saveRoom);
document.getElementById('shelf-form')!.addEventListener('submit', saveShelf);

document.getElementById('btn-add-user')!.addEventListener('click', () => openUserModal());
document.getElementById('btn-close-user-modal')!.addEventListener('click', closeUserModal);
document.getElementById('btn-cancel-user')!.addEventListener('click', closeUserModal);
document.getElementById('user-form')!.addEventListener('submit', saveUser);
document.getElementById('user-role')!.addEventListener('change', toggleUserRoomsGroup);

initNav();
initBookSearch();
initDelegatedHandlers();

boot();
