// ========== TYPES ==========

interface Book {
  id: number;
  title: string;
  author: string | null;
  isbn: string | null;
  genre: string | null;
  shelf_id: number | null;
  notes: string | null;
  shelf_name: string | null;
  room_name: string | null;
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

// ========== CACHE ==========

let cacheBooks: Book[] = [];
let cacheRooms: Room[] = [];
let cacheShelves: Shelf[] = [];
let cacheGenres: string[] = [];

async function fetchAllData(): Promise<void> {
  const [books, rooms, shelves, genres] = await Promise.all([
    api.get('/books') as Promise<Book[]>,
    api.get('/rooms') as Promise<Room[]>,
    api.get('/shelves') as Promise<Shelf[]>,
    api.get('/genres') as Promise<string[]>,
  ]);
  cacheBooks = books;
  cacheRooms = rooms;
  cacheShelves = shelves;
  cacheGenres = genres;
}

// ========== STATE ==========

let currentView = 'dashboard';
let activeFilters: { search: string; shelf_id: string; room_id: string; genre: string; author: string } = {
  search: '', shelf_id: '', room_id: '', genre: '', author: '',
};
let pendingBookShelfId: number | null = null;

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

function initNav(): void {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = (btn as HTMLElement).dataset.view!;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + view)!.classList.add('active');
      currentView = view;
      loadView(view);
    });
  });
}

function loadView(view: string): void {
  switch (view) {
    case 'dashboard': loadDashboard(); break;
    case 'books':
      pendingBookShelfId = null;
      resetBooksHeader();
      loadFilterDropdowns();
      setupFilterListeners();
      activeFilters = { search: '', shelf_id: '', room_id: '', genre: '', author: '' };
      renderBooksWithFilters();
      break;
    case 'rooms': loadRooms(); break;
  }
}

// ========== DASHBOARD ==========

function loadDashboard(): void {
  const unassigned = cacheBooks.filter(b => !b.shelf_id);
  document.getElementById('stats')!.innerHTML = `
    <div class="stat-card"><h3>${cacheBooks.length}</h3><p>ספרים</p></div>
    <div class="stat-card"><h3>${cacheRooms.length}</h3><p>חדרים</p></div>
    <div class="stat-card"><h3>${cacheShelves.length}</h3><p>מדפים</p></div>
    <div class="stat-card"><h3>${unassigned.length}</h3><p>לא מוקצים</p></div>
  `;
  const container = document.getElementById('unassigned-books')!;
  if (!unassigned.length) {
    container.innerHTML = '<div class="empty-state"><p>כל הספרים מוקצים למדפים!</p></div>';
  } else {
    container.innerHTML = unassigned.map(bookCard).join('');
  }
}

// ========== BOOKS ==========

let searchTimeout: ReturnType<typeof setTimeout>;

function initBookSearch(): void {
  document.getElementById('book-search')!.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      activeFilters.search = (e.target as HTMLInputElement).value;
      renderBooksWithFilters();
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

function renderBooksWithFilters(): void {
  let filtered = cacheBooks;

  if (activeFilters.search) {
    const term = activeFilters.search.toLowerCase();
    filtered = filtered.filter(b =>
      (b.title && b.title.toLowerCase().includes(term)) ||
      (b.author && b.author.toLowerCase().includes(term)) ||
      (b.isbn && b.isbn.toLowerCase().includes(term)) ||
      (b.genre && b.genre.toLowerCase().includes(term))
    );
  }
  if (activeFilters.shelf_id) {
    filtered = filtered.filter(b => String(b.shelf_id) === activeFilters.shelf_id);
  }
  if (activeFilters.room_id) {
    filtered = filtered.filter(b => {
      const shelf = cacheShelves.find(s => s.id === b.shelf_id);
      return shelf && String(shelf.room_id) === activeFilters.room_id;
    });
  }
  if (activeFilters.genre) {
    filtered = filtered.filter(b => b.genre === activeFilters.genre);
  }
  if (activeFilters.author) {
    const term = activeFilters.author.toLowerCase();
    filtered = filtered.filter(b => b.author && b.author.toLowerCase().includes(term));
  }

  renderBooks(filtered);
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

  const authors = [...new Set(cacheBooks.map(b => b.author).filter(Boolean))].sort() as string[];
  authorSelect.innerHTML = '<option value="">כל המחברים</option>';
  authors.forEach(a => {
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
      renderBooksWithFilters();
    });
  });
}

function clearFilters(): void {
  activeFilters = { search: '', shelf_id: '', room_id: '', genre: '', author: '' };
  (document.getElementById('book-search') as HTMLInputElement).value = '';
  (document.getElementById('filter-room') as HTMLSelectElement).value = '';
  (document.getElementById('filter-shelf') as HTMLSelectElement).value = '';
  (document.getElementById('filter-genre') as HTMLSelectElement).value = '';
  (document.getElementById('filter-author') as HTMLSelectElement).value = '';
  renderBooksWithFilters();
}

function viewShelfBooks(shelfId: number, shelfName: string): void {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="books"]')!.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-books')!.classList.add('active');
  currentView = 'books';

  const headerEl = document.getElementById('books-view-header')!;
  headerEl.innerHTML = `
    <button class="btn btn-secondary btn-small" data-action="back-to-rooms">← חזרה לחדרים</button>
    <h2>ספרים במדף: ${esc(shelfName)}</h2>
    <div class="actions">
      <button class="btn btn-primary" id="btn-add-book">+ הוסף ספר</button>
    </div>
  `;
  document.getElementById('btn-add-book')!.addEventListener('click', () => {
    pendingBookShelfId = shelfId;
    openBookModal();
  });

  activeFilters = { search: '', shelf_id: String(shelfId), room_id: '', genre: '', author: '' };
  (document.getElementById('book-search') as HTMLInputElement).value = '';
  loadFilterDropdowns();
  setupFilterListeners();
  renderBooksWithFilters();
}

function resetBooksHeader(): void {
  const headerEl = document.getElementById('books-view-header')!;
  headerEl.innerHTML = `
    <h2>הספרים שלי</h2>
    <div class="actions">
      <input type="text" id="book-search" placeholder="חיפוש ספרים...">
      <button class="btn btn-primary" id="btn-add-book">+ הוסף ספר</button>
    </div>
  `;
  document.getElementById('book-search')!.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      activeFilters.search = (e.target as HTMLInputElement).value;
      renderBooksWithFilters();
    }, 300);
  });
  document.getElementById('btn-add-book')!.addEventListener('click', () => openBookModal());
}

function bookCard(book: Book): string {
  const location = book.room_name
    ? `<div class="location">${esc(book.room_name)} › ${esc(book.shelf_name!)}</div>`
    : '<div class="location" style="color:#999">לא מוקצה</div>';
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
      <div class="actions">
        <button class="btn btn-primary btn-small" data-action="edit-book" data-id="${book.id}">ערוך</button>
        <button class="btn btn-danger btn-small" data-action="delete-book" data-id="${book.id}">מחק</button>
      </div>
    </div>
  `;
}

function openBookModal(book: Book | null = null): void {
  loadShelfSelect();
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

function editBook(id: number): void {
  const book = cacheBooks.find(b => b.id === id);
  if (book) openBookModal(book);
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
    await fetchAllData();
    loadView(currentView);
  } catch (err: any) {
    alert(err.message);
  }
}

async function deleteBook(id: number): Promise<void> {
  if (!confirm('למחוק ספר זה?')) return;
  try {
    await api.del('/books/' + id);
    await fetchAllData();
    loadView(currentView);
  } catch (err: any) {
    alert(err.message);
  }
}

// ========== SHELF SELECT ==========

function loadShelfSelect(): void {
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
    opt.textContent = shelf.name;
    optgroup!.appendChild(opt);
  });

  if (pendingBookShelfId) {
    select.value = String(pendingBookShelfId);
  }
}

// ========== ROOMS ==========

function loadRooms(): void {
  const container = document.getElementById('rooms-list')!;

  if (!cacheRooms.length) {
    container.innerHTML = '<div class="empty-state"><h3>אין חדרים עדיין</h3><p>הוסף חדר כדי להתחיל לארגן את הספרים</p></div>';
    return;
  }

  container.innerHTML = cacheRooms.map(room => {
    const roomShelves = cacheShelves.filter(s => s.room_id === room.id);
    return `
      <div class="room-card">
        <div class="room-header">
          <h3>${esc(room.name)}</h3>
          <div class="room-actions">
            <span class="book-count">${room.book_count} ספרים</span>
            <button class="btn btn-primary btn-small" data-action="edit-room" data-id="${room.id}">ערוך</button>
            <button class="btn btn-danger btn-small" data-action="delete-room" data-id="${room.id}">מחק</button>
          </div>
        </div>
        <div class="room-body">
          <div class="shelves-grid">
            ${roomShelves.map(shelf => `
              <div class="shelf-card" data-action="view-shelf" data-id="${shelf.id}" data-name="${esc(shelf.name)}">
                <h4>${esc(shelf.name)}</h4>
                <div class="book-count">${shelf.book_count} ספרים</div>
                <div class="actions">
                  <button class="btn btn-primary btn-small" data-action="edit-shelf" data-id="${shelf.id}">ערוך</button>
                  <button class="btn btn-danger btn-small" data-action="delete-shelf" data-id="${shelf.id}">מחק</button>
                </div>
              </div>
            `).join('')}
            <div class="add-shelf-btn" data-action="add-shelf" data-room-id="${room.id}">+ הוסף מדף</div>
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

function editRoom(id: number): void {
  const room = cacheRooms.find(r => r.id === id);
  if (room) openRoomModal(room);
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

function editShelf(id: number): void {
  const shelf = cacheShelves.find(s => s.id === id);
  if (shelf) openShelfModal(shelf.room_id, shelf);
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
      case 'edit-room': editRoom(id); break;
      case 'delete-room': deleteRoom(id); break;
      case 'edit-shelf': editShelf(id); break;
      case 'delete-shelf': deleteShelf(id); break;
      case 'add-shelf': openShelfModal(roomId); break;
      case 'view-shelf': viewShelfBooks(id, name); break;
      case 'clear-filters': clearFilters(); break;
      case 'back-to-rooms':
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.nav-btn[data-view="rooms"]')!.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-rooms')!.classList.add('active');
        currentView = 'rooms';
        loadRooms();
        break;
    }
  });
}

// ========== INIT ==========

document.getElementById('btn-add-book')!.addEventListener('click', () => openBookModal());
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

initNav();
initBookSearch();
initDelegatedHandlers();
fetchAllData().then(() => loadDashboard());
