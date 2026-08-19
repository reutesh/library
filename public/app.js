"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/client/app.ts
  var require_app = __commonJS({
    "src/client/app.ts"() {
      var api = {
        async get(url) {
          const res = await fetch("/api" + url);
          if (!res.ok) throw new Error((await res.json()).error);
          return res.json();
        },
        async post(url, data) {
          const res = await fetch("/api" + url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
          });
          if (!res.ok) throw new Error((await res.json()).error);
          return res.json();
        },
        async put(url, data) {
          const res = await fetch("/api" + url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
          });
          if (!res.ok) throw new Error((await res.json()).error);
          return res.json();
        },
        async del(url) {
          const res = await fetch("/api" + url, { method: "DELETE" });
          if (!res.ok) throw new Error((await res.json()).error);
          return res.json();
        }
      };
      var cacheBooks = [];
      var cacheRooms = [];
      var cacheShelves = [];
      var cacheGenres = [];
      async function fetchAllData() {
        const [books, rooms, shelves, genres] = await Promise.all([
          api.get("/books"),
          api.get("/rooms"),
          api.get("/shelves"),
          api.get("/genres")
        ]);
        cacheBooks = books;
        cacheRooms = rooms;
        cacheShelves = shelves;
        cacheGenres = genres;
      }
      var currentView = "dashboard";
      var activeFilters = {
        search: "",
        shelf_id: "",
        room_id: "",
        genre: "",
        author: ""
      };
      var pendingBookShelfId = null;
      function setupGenreAutocomplete() {
        const input = document.getElementById("book-genre");
        const list = document.getElementById("genre-suggestions");
        if (!input || !list) return;
        input.oninput = () => {
          const val = input.value.trim().toLowerCase();
          list.innerHTML = "";
          if (!val) {
            list.style.display = "none";
            return;
          }
          const matches = cacheGenres.filter((g) => g.toLowerCase().includes(val) && g.toLowerCase() !== val);
          if (!matches.length) {
            list.style.display = "none";
            return;
          }
          list.style.display = "block";
          matches.forEach((genre) => {
            const li = document.createElement("li");
            li.textContent = genre;
            li.onmousedown = () => {
              input.value = genre;
              list.style.display = "none";
            };
            list.appendChild(li);
          });
        };
        input.onblur = () => {
          setTimeout(() => {
            list.style.display = "none";
          }, 200);
        };
      }
      function initNav() {
        document.querySelectorAll(".nav-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const view = btn.dataset.view;
            document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
            document.getElementById("view-" + view).classList.add("active");
            currentView = view;
            loadView(view);
          });
        });
      }
      function loadView(view) {
        switch (view) {
          case "dashboard":
            loadDashboard();
            break;
          case "books":
            pendingBookShelfId = null;
            resetBooksHeader();
            loadFilterDropdowns();
            setupFilterListeners();
            activeFilters = { search: "", shelf_id: "", room_id: "", genre: "", author: "" };
            renderBooksWithFilters();
            break;
          case "rooms":
            loadRooms();
            break;
        }
      }
      function loadDashboard() {
        const unassigned = cacheBooks.filter((b) => !b.shelf_id);
        document.getElementById("stats").innerHTML = `
    <div class="stat-card"><h3>${cacheBooks.length}</h3><p>\u05E1\u05E4\u05E8\u05D9\u05DD</p></div>
    <div class="stat-card"><h3>${cacheRooms.length}</h3><p>\u05D7\u05D3\u05E8\u05D9\u05DD</p></div>
    <div class="stat-card"><h3>${cacheShelves.length}</h3><p>\u05DE\u05D3\u05E4\u05D9\u05DD</p></div>
    <div class="stat-card"><h3>${unassigned.length}</h3><p>\u05DC\u05D0 \u05DE\u05D5\u05E7\u05E6\u05D9\u05DD</p></div>
  `;
        const container = document.getElementById("unassigned-books");
        if (!unassigned.length) {
          container.innerHTML = '<div class="empty-state"><p>\u05DB\u05DC \u05D4\u05E1\u05E4\u05E8\u05D9\u05DD \u05DE\u05D5\u05E7\u05E6\u05D9\u05DD \u05DC\u05DE\u05D3\u05E4\u05D9\u05DD!</p></div>';
        } else {
          container.innerHTML = unassigned.map(bookCard).join("");
        }
      }
      var searchTimeout;
      function initBookSearch() {
        document.getElementById("book-search").addEventListener("input", (e) => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            activeFilters.search = e.target.value;
            renderBooksWithFilters();
          }, 300);
        });
      }
      function renderBooks(books) {
        const container = document.getElementById("books-list");
        if (!books.length) {
          container.innerHTML = '<div class="empty-state"><h3>\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D5 \u05E1\u05E4\u05E8\u05D9\u05DD</h3><p>\u05D0\u05D9\u05DF \u05E1\u05E4\u05E8\u05D9\u05DD \u05D4\u05EA\u05D5\u05D0\u05DE\u05D9\u05DD \u05D0\u05EA \u05D4\u05E1\u05D9\u05E0\u05D5\u05DF</p></div>';
        } else {
          container.innerHTML = books.map(bookCard).join("");
        }
      }
      function renderBooksWithFilters() {
        let filtered = cacheBooks;
        if (activeFilters.search) {
          const term = activeFilters.search.toLowerCase();
          filtered = filtered.filter(
            (b) => b.title && b.title.toLowerCase().includes(term) || b.author && b.author.toLowerCase().includes(term) || b.isbn && b.isbn.toLowerCase().includes(term) || b.genre && b.genre.toLowerCase().includes(term)
          );
        }
        if (activeFilters.shelf_id) {
          filtered = filtered.filter((b) => String(b.shelf_id) === activeFilters.shelf_id);
        }
        if (activeFilters.room_id) {
          filtered = filtered.filter((b) => {
            const shelf = cacheShelves.find((s) => s.id === b.shelf_id);
            return shelf && String(shelf.room_id) === activeFilters.room_id;
          });
        }
        if (activeFilters.genre) {
          filtered = filtered.filter((b) => b.genre === activeFilters.genre);
        }
        if (activeFilters.author) {
          const term = activeFilters.author.toLowerCase();
          filtered = filtered.filter((b) => b.author && b.author.toLowerCase().includes(term));
        }
        renderBooks(filtered);
      }
      function loadFilterDropdowns() {
        const roomSelect = document.getElementById("filter-room");
        const shelfSelect = document.getElementById("filter-shelf");
        const genreSelect = document.getElementById("filter-genre");
        const authorSelect = document.getElementById("filter-author");
        const currentRoom = roomSelect.value;
        const currentShelf = shelfSelect.value;
        const currentGenre = genreSelect.value;
        const currentAuthor = authorSelect.value;
        roomSelect.innerHTML = '<option value="">\u05DB\u05DC \u05D4\u05D7\u05D3\u05E8\u05D9\u05DD</option>';
        cacheRooms.forEach((r) => {
          const opt = document.createElement("option");
          opt.value = String(r.id);
          opt.textContent = r.name;
          roomSelect.appendChild(opt);
        });
        shelfSelect.innerHTML = '<option value="">\u05DB\u05DC \u05D4\u05DE\u05D3\u05E4\u05D9\u05DD</option>';
        let lastRoom = "";
        cacheShelves.forEach((s) => {
          if (s.room_name !== lastRoom) {
            const grp = document.createElement("optgroup");
            grp.label = s.room_name;
            shelfSelect.appendChild(grp);
            lastRoom = s.room_name;
          }
          const opt = document.createElement("option");
          opt.value = String(s.id);
          opt.textContent = s.name;
          shelfSelect.lastChild.appendChild(opt);
        });
        genreSelect.innerHTML = '<option value="">\u05DB\u05DC \u05D4\u05D6\u2019\u05D0\u05E0\u05E8\u05D9\u05DD</option>';
        cacheGenres.forEach((g) => {
          const opt = document.createElement("option");
          opt.value = g;
          opt.textContent = g;
          genreSelect.appendChild(opt);
        });
        const authors = [...new Set(cacheBooks.map((b) => b.author).filter(Boolean))].sort();
        authorSelect.innerHTML = '<option value="">\u05DB\u05DC \u05D4\u05DE\u05D7\u05D1\u05E8\u05D9\u05DD</option>';
        authors.forEach((a) => {
          const opt = document.createElement("option");
          opt.value = a;
          opt.textContent = a;
          authorSelect.appendChild(opt);
        });
        roomSelect.value = currentRoom;
        shelfSelect.value = currentShelf;
        genreSelect.value = currentGenre;
        authorSelect.value = currentAuthor;
      }
      function setupFilterListeners() {
        ["filter-room", "filter-shelf", "filter-genre", "filter-author"].forEach((id) => {
          document.getElementById(id).addEventListener("change", (e) => {
            const key = id.replace("filter-", "");
            activeFilters[key] = e.target.value;
            renderBooksWithFilters();
          });
        });
      }
      function clearFilters() {
        activeFilters = { search: "", shelf_id: "", room_id: "", genre: "", author: "" };
        document.getElementById("book-search").value = "";
        document.getElementById("filter-room").value = "";
        document.getElementById("filter-shelf").value = "";
        document.getElementById("filter-genre").value = "";
        document.getElementById("filter-author").value = "";
        renderBooksWithFilters();
      }
      function viewShelfBooks(shelfId, shelfName) {
        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        document.querySelector('.nav-btn[data-view="books"]').classList.add("active");
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        document.getElementById("view-books").classList.add("active");
        currentView = "books";
        const headerEl = document.getElementById("books-view-header");
        headerEl.innerHTML = `
    <button class="btn btn-secondary btn-small" data-action="back-to-rooms">\u2190 \u05D7\u05D6\u05E8\u05D4 \u05DC\u05D7\u05D3\u05E8\u05D9\u05DD</button>
    <h2>\u05E1\u05E4\u05E8\u05D9\u05DD \u05D1\u05DE\u05D3\u05E3: ${esc(shelfName)}</h2>
    <div class="actions">
      <button class="btn btn-primary" id="btn-add-book">+ \u05D4\u05D5\u05E1\u05E3 \u05E1\u05E4\u05E8</button>
    </div>
  `;
        document.getElementById("btn-add-book").addEventListener("click", () => {
          pendingBookShelfId = shelfId;
          openBookModal();
        });
        activeFilters = { search: "", shelf_id: String(shelfId), room_id: "", genre: "", author: "" };
        document.getElementById("book-search").value = "";
        loadFilterDropdowns();
        setupFilterListeners();
        renderBooksWithFilters();
      }
      function resetBooksHeader() {
        const headerEl = document.getElementById("books-view-header");
        headerEl.innerHTML = `
    <h2>\u05D4\u05E1\u05E4\u05E8\u05D9\u05DD \u05E9\u05DC\u05D9</h2>
    <div class="actions">
      <input type="text" id="book-search" placeholder="\u05D7\u05D9\u05E4\u05D5\u05E9 \u05E1\u05E4\u05E8\u05D9\u05DD...">
      <button class="btn btn-primary" id="btn-add-book">+ \u05D4\u05D5\u05E1\u05E3 \u05E1\u05E4\u05E8</button>
    </div>
  `;
        document.getElementById("book-search").addEventListener("input", (e) => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            activeFilters.search = e.target.value;
            renderBooksWithFilters();
          }, 300);
        });
        document.getElementById("btn-add-book").addEventListener("click", () => openBookModal());
      }
      function bookCard(book) {
        const location = book.room_name ? `<div class="location">${esc(book.room_name)} \u203A ${esc(book.shelf_name)}</div>` : '<div class="location" style="color:#999">\u05DC\u05D0 \u05DE\u05D5\u05E7\u05E6\u05D4</div>';
        return `
    <div class="book-card">
      <h4>${esc(book.title)}</h4>
      ${book.author ? `<div class="author">${esc(book.author)}</div>` : ""}
      <div class="meta">
        ${book.isbn ? `<span class="tag">ISBN: ${esc(book.isbn)}</span>` : ""}
        ${book.genre ? `<span class="tag">${esc(book.genre)}</span>` : ""}
      </div>
      ${location}
      ${book.notes ? `<p style="font-size:0.85rem;color:#666;margin-top:0.3rem">${esc(book.notes)}</p>` : ""}
      <div class="actions">
        <button class="btn btn-primary btn-small" data-action="edit-book" data-id="${book.id}">\u05E2\u05E8\u05D5\u05DA</button>
        <button class="btn btn-danger btn-small" data-action="delete-book" data-id="${book.id}">\u05DE\u05D7\u05E7</button>
      </div>
    </div>
  `;
      }
      function openBookModal(book = null) {
        loadShelfSelect();
        setupGenreAutocomplete();
        if (book) {
          document.getElementById("book-modal-title").textContent = "\u05E2\u05E8\u05D5\u05DA \u05E1\u05E4\u05E8";
          document.getElementById("book-id").value = String(book.id);
          document.getElementById("book-title").value = book.title;
          document.getElementById("book-author").value = book.author || "";
          document.getElementById("book-isbn").value = book.isbn || "";
          document.getElementById("book-genre").value = book.genre || "";
          document.getElementById("book-shelf").value = book.shelf_id ? String(book.shelf_id) : "";
          document.getElementById("book-notes").value = book.notes || "";
        } else {
          document.getElementById("book-modal-title").textContent = "\u05D4\u05D5\u05E1\u05E3 \u05E1\u05E4\u05E8";
          document.getElementById("book-form").reset();
          document.getElementById("book-id").value = "";
          if (pendingBookShelfId) {
            document.getElementById("book-shelf").value = String(pendingBookShelfId);
          }
        }
        document.getElementById("book-modal").classList.add("active");
      }
      function closeBookModal() {
        document.getElementById("book-modal").classList.remove("active");
      }
      function editBook(id) {
        const book = cacheBooks.find((b) => b.id === id);
        if (book) openBookModal(book);
      }
      async function saveBook(e) {
        e.preventDefault();
        const id = document.getElementById("book-id").value;
        const data = {
          title: document.getElementById("book-title").value,
          author: document.getElementById("book-author").value || null,
          isbn: document.getElementById("book-isbn").value || null,
          genre: document.getElementById("book-genre").value || null,
          shelf_id: document.getElementById("book-shelf").value ? Number(document.getElementById("book-shelf").value) : null,
          notes: document.getElementById("book-notes").value || null
        };
        try {
          if (id) await api.put("/books/" + id, data);
          else await api.post("/books", data);
          closeBookModal();
          await fetchAllData();
          loadView(currentView);
        } catch (err) {
          alert(err.message);
        }
      }
      async function deleteBook(id) {
        if (!confirm("\u05DC\u05DE\u05D7\u05D5\u05E7 \u05E1\u05E4\u05E8 \u05D6\u05D4?")) return;
        try {
          await api.del("/books/" + id);
          await fetchAllData();
          loadView(currentView);
        } catch (err) {
          alert(err.message);
        }
      }
      function loadShelfSelect() {
        const select = document.getElementById("book-shelf");
        select.innerHTML = '<option value="">\u05DC\u05D0 \u05DE\u05D5\u05E7\u05E6\u05D4</option>';
        let currentRoom = "";
        let optgroup = null;
        cacheShelves.forEach((shelf) => {
          if (shelf.room_name !== currentRoom) {
            optgroup = document.createElement("optgroup");
            optgroup.label = shelf.room_name;
            select.appendChild(optgroup);
            currentRoom = shelf.room_name;
          }
          const opt = document.createElement("option");
          opt.value = String(shelf.id);
          opt.textContent = shelf.name;
          optgroup.appendChild(opt);
        });
        if (pendingBookShelfId) {
          select.value = String(pendingBookShelfId);
        }
      }
      function loadRooms() {
        const container = document.getElementById("rooms-list");
        if (!cacheRooms.length) {
          container.innerHTML = '<div class="empty-state"><h3>\u05D0\u05D9\u05DF \u05D7\u05D3\u05E8\u05D9\u05DD \u05E2\u05D3\u05D9\u05D9\u05DF</h3><p>\u05D4\u05D5\u05E1\u05E3 \u05D7\u05D3\u05E8 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05DC\u05D0\u05E8\u05D2\u05DF \u05D0\u05EA \u05D4\u05E1\u05E4\u05E8\u05D9\u05DD</p></div>';
          return;
        }
        container.innerHTML = cacheRooms.map((room) => {
          const roomShelves = cacheShelves.filter((s) => s.room_id === room.id);
          return `
      <div class="room-card">
        <div class="room-header">
          <h3>${esc(room.name)}</h3>
          <div class="room-actions">
            <span class="book-count">${room.book_count} \u05E1\u05E4\u05E8\u05D9\u05DD</span>
            <button class="btn btn-primary btn-small" data-action="edit-room" data-id="${room.id}">\u05E2\u05E8\u05D5\u05DA</button>
            <button class="btn btn-danger btn-small" data-action="delete-room" data-id="${room.id}">\u05DE\u05D7\u05E7</button>
          </div>
        </div>
        <div class="room-body">
          <div class="shelves-grid">
            ${roomShelves.map((shelf) => `
              <div class="shelf-card" data-action="view-shelf" data-id="${shelf.id}" data-name="${esc(shelf.name)}">
                <h4>${esc(shelf.name)}</h4>
                <div class="book-count">${shelf.book_count} \u05E1\u05E4\u05E8\u05D9\u05DD</div>
                <div class="actions">
                  <button class="btn btn-primary btn-small" data-action="edit-shelf" data-id="${shelf.id}">\u05E2\u05E8\u05D5\u05DA</button>
                  <button class="btn btn-danger btn-small" data-action="delete-shelf" data-id="${shelf.id}">\u05DE\u05D7\u05E7</button>
                </div>
              </div>
            `).join("")}
            <div class="add-shelf-btn" data-action="add-shelf" data-room-id="${room.id}">+ \u05D4\u05D5\u05E1\u05E3 \u05DE\u05D3\u05E3</div>
          </div>
        </div>
      </div>
    `;
        }).join("");
      }
      function openRoomModal(room = null) {
        if (room) {
          document.getElementById("room-modal-title").textContent = "\u05E2\u05E8\u05D5\u05DA \u05D7\u05D3\u05E8";
          document.getElementById("room-id").value = String(room.id);
          document.getElementById("room-name").value = room.name;
        } else {
          document.getElementById("room-modal-title").textContent = "\u05D4\u05D5\u05E1\u05E3 \u05D7\u05D3\u05E8";
          document.getElementById("room-form").reset();
          document.getElementById("room-id").value = "";
        }
        document.getElementById("room-modal").classList.add("active");
      }
      function closeRoomModal() {
        document.getElementById("room-modal").classList.remove("active");
      }
      function editRoom(id) {
        const room = cacheRooms.find((r) => r.id === id);
        if (room) openRoomModal(room);
      }
      async function saveRoom(e) {
        e.preventDefault();
        const id = document.getElementById("room-id").value;
        const data = {
          name: document.getElementById("room-name").value
        };
        try {
          if (id) await api.put("/rooms/" + id, data);
          else await api.post("/rooms", data);
          closeRoomModal();
          await fetchAllData();
          loadRooms();
        } catch (err) {
          alert(err.message);
        }
      }
      async function deleteRoom(id) {
        if (!confirm("\u05DC\u05DE\u05D7\u05D5\u05E7 \u05D7\u05D3\u05E8 \u05D6\u05D4 \u05D5\u05DB\u05DC \u05DE\u05D3\u05E4\u05D9\u05D5? \u05D4\u05E1\u05E4\u05E8\u05D9\u05DD \u05D9\u05E4\u05D5\u05E0\u05D5.")) return;
        try {
          await api.del("/rooms/" + id);
          await fetchAllData();
          loadRooms();
        } catch (err) {
          alert(err.message);
        }
      }
      function openShelfModal(roomId, shelf = null) {
        document.getElementById("shelf-room-id").value = String(roomId);
        if (shelf) {
          document.getElementById("shelf-modal-title").textContent = "\u05E2\u05E8\u05D5\u05DA \u05DE\u05D3\u05E3";
          document.getElementById("shelf-id").value = String(shelf.id);
          document.getElementById("shelf-name").value = shelf.name;
        } else {
          document.getElementById("shelf-modal-title").textContent = "\u05D4\u05D5\u05E1\u05E3 \u05DE\u05D3\u05E3";
          document.getElementById("shelf-form").reset();
          document.getElementById("shelf-id").value = "";
          document.getElementById("shelf-room-id").value = String(roomId);
        }
        document.getElementById("shelf-modal").classList.add("active");
      }
      function closeShelfModal() {
        document.getElementById("shelf-modal").classList.remove("active");
      }
      function editShelf(id) {
        const shelf = cacheShelves.find((s) => s.id === id);
        if (shelf) openShelfModal(shelf.room_id, shelf);
      }
      async function saveShelf(e) {
        e.preventDefault();
        const id = document.getElementById("shelf-id").value;
        const data = {
          room_id: Number(document.getElementById("shelf-room-id").value),
          name: document.getElementById("shelf-name").value
        };
        try {
          if (id) await api.put("/shelves/" + id, data);
          else await api.post("/shelves", data);
          closeShelfModal();
          await fetchAllData();
          loadRooms();
        } catch (err) {
          alert(err.message);
        }
      }
      async function deleteShelf(id) {
        if (!confirm("\u05DC\u05DE\u05D7\u05D5\u05E7 \u05DE\u05D3\u05E3 \u05D6\u05D4? \u05D4\u05E1\u05E4\u05E8\u05D9\u05DD \u05E2\u05DC\u05D9\u05D5 \u05D9\u05E4\u05D5\u05E0\u05D5.")) return;
        try {
          await api.del("/shelves/" + id);
          await fetchAllData();
          loadRooms();
        } catch (err) {
          alert(err.message);
        }
      }
      function esc(str) {
        if (!str) return "";
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
      }
      function initDelegatedHandlers() {
        document.addEventListener("click", (e) => {
          const target = e.target.closest("[data-action]");
          if (!target) return;
          const action = target.dataset.action;
          const id = Number(target.dataset.id);
          const roomId = Number(target.dataset.roomId);
          const name = target.dataset.name || "";
          switch (action) {
            case "edit-book":
              editBook(id);
              break;
            case "delete-book":
              deleteBook(id);
              break;
            case "edit-room":
              editRoom(id);
              break;
            case "delete-room":
              deleteRoom(id);
              break;
            case "edit-shelf":
              editShelf(id);
              break;
            case "delete-shelf":
              deleteShelf(id);
              break;
            case "add-shelf":
              openShelfModal(roomId);
              break;
            case "view-shelf":
              viewShelfBooks(id, name);
              break;
            case "clear-filters":
              clearFilters();
              break;
            case "back-to-rooms":
              document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
              document.querySelector('.nav-btn[data-view="rooms"]').classList.add("active");
              document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
              document.getElementById("view-rooms").classList.add("active");
              currentView = "rooms";
              loadRooms();
              break;
          }
        });
      }
      document.getElementById("btn-add-book").addEventListener("click", () => openBookModal());
      document.getElementById("btn-add-room").addEventListener("click", () => openRoomModal());
      document.getElementById("btn-close-book-modal").addEventListener("click", closeBookModal);
      document.getElementById("btn-cancel-book").addEventListener("click", closeBookModal);
      document.getElementById("btn-close-room-modal").addEventListener("click", closeRoomModal);
      document.getElementById("btn-cancel-room").addEventListener("click", closeRoomModal);
      document.getElementById("btn-close-shelf-modal").addEventListener("click", closeShelfModal);
      document.getElementById("btn-cancel-shelf").addEventListener("click", closeShelfModal);
      document.getElementById("book-form").addEventListener("submit", saveBook);
      document.getElementById("room-form").addEventListener("submit", saveRoom);
      document.getElementById("shelf-form").addEventListener("submit", saveShelf);
      initNav();
      initBookSearch();
      initDelegatedHandlers();
      fetchAllData().then(() => loadDashboard());
    }
  });
  require_app();
})();
