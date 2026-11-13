/* =====================================================================
   Library Request & Availability Board  -  Assignment 1 (client-side)
   Idea #14: catalog search, hold queue, due dates, renewals,
             librarian processing.
   Vanilla JavaScript only. No backend: every "server" call below is a
   Promise + setTimeout that imitates an HTTP request/response.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1. CONSTANTS (variables)
  ------------------------------------------------------------------ */
  const STORAGE_KEY = 'lrab.state.v1';
  const DAY_MS = 86400000;
  const LOAN_DAYS = 14;        // length of a loan
  const RENEW_DAYS = 7;        // extension per renewal
  const MAX_RENEWALS = 2;      // renewals allowed per loan
  const MAX_ACTIVE = 3;        // loans + pending requests per student
  const API_DELAY = 450;       // simulated network latency (ms)
  const SEARCH_DEBOUNCE = 300; // wait after typing before searching (ms)

  const CATEGORIES = [
    'Algorithms', 'Artificial Intelligence', 'Databases', 'Mathematics',
    'Networking', 'Programming', 'Software Engineering', 'Systems', 'Web Development'
  ];
  const STATUS_LABEL = { available: 'Available', borrowed: 'Borrowed', reserved: 'Reserved' };

  /* A custom error that carries an HTTP-style status code. */
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  /* ------------------------------------------------------------------
     2. SMALL HELPERS (dates, DOM)
  ------------------------------------------------------------------ */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function endOfDayFromNow(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }
  function startOfDay(value) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function dayDiff(iso) {
    return Math.round((startOfDay(iso) - startOfDay(new Date())) / DAY_MS);
  }
  function isOverdue(iso) { return new Date(iso) < new Date(); }
  function addDays(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function relativeDue(iso) {
    const diff = dayDiff(iso);
    if (isOverdue(iso)) return diff < 0 ? `${-diff} day${diff === -1 ? '' : 's'} overdue` : 'overdue';
    if (diff === 0) return 'due today';
    if (diff === 1) return 'due tomorrow';
    return `${diff} days left`;
  }
  function toInputDate(value) {
    const d = new Date(value);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /* Tiny hyperscript helper: builds DOM safely (textContent, never innerHTML). */
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  /* ------------------------------------------------------------------
     3. DATA MODEL + SAMPLE RECORDS
        Book    { id, title, author, category, status, borrowedBy,
                  reservedFor, dueDate, renewals, queue[] }
        User    { id, name, studentId, email, role }
        Request { id, bookId, userId, status, createdAt, resolvedAt,
                  pickup, note, reason }
  ------------------------------------------------------------------ */
  function createSeed() {
    return {
      version: 1,
      role: 'student',
      nextBookNumber: 111,
      nextRequestNumber: 3,
      users: [
        { id: 'u1', name: 'Demo Student', studentId: 'CS-10001', email: 'demo.student@example.edu', role: 'student' },
        { id: 'u2', name: 'Aisha Khan', studentId: 'CS-10002', email: 'aisha@example.edu', role: 'student' },
        { id: 'u3', name: 'Bilal Ahmed', studentId: 'EE-10003', email: 'bilal@example.edu', role: 'student' },
        { id: 'u4', name: 'Sara Malik', studentId: 'SE-10004', email: 'sara@example.edu', role: 'student' },
        { id: 'lib1', name: 'Library Staff', studentId: '', email: 'staff@example.edu', role: 'librarian' }
      ],
      books: [
        { id: 'B101', title: 'Clean Code', author: 'Robert C. Martin', category: 'Software Engineering',
          status: 'available', borrowedBy: null, reservedFor: null, dueDate: null, renewals: 0, queue: [] },
        { id: 'B102', title: 'JavaScript Basics', author: 'David Flanagan', category: 'Programming',
          status: 'borrowed', borrowedBy: 'u2', reservedFor: null, dueDate: endOfDayFromNow(6), renewals: 0, queue: ['u3'] },
        { id: 'B103', title: 'Database Systems', author: 'Ramez Elmasri', category: 'Databases',
          status: 'available', borrowedBy: null, reservedFor: null, dueDate: null, renewals: 0, queue: [] },
        { id: 'B104', title: 'Operating Systems', author: 'Abraham Silberschatz', category: 'Systems',
          status: 'borrowed', borrowedBy: 'u1', reservedFor: null, dueDate: endOfDayFromNow(3), renewals: 0, queue: [] },
        { id: 'B105', title: 'Web Development', author: 'Jon Duckett', category: 'Web Development',
          status: 'reserved', borrowedBy: null, reservedFor: 'u3', dueDate: null, renewals: 0, queue: ['u4'] },
        { id: 'B106', title: 'Computer Networks', author: 'Andrew Tanenbaum', category: 'Networking',
          status: 'available', borrowedBy: null, reservedFor: null, dueDate: null, renewals: 0, queue: [] },
        { id: 'B107', title: 'Introduction to Algorithms', author: 'Thomas Cormen', category: 'Algorithms',
          status: 'borrowed', borrowedBy: 'u1', reservedFor: null, dueDate: endOfDayFromNow(-2), renewals: 1, queue: [] },
        { id: 'B108', title: 'Discrete Mathematics', author: 'Kenneth Rosen', category: 'Mathematics',
          status: 'borrowed', borrowedBy: 'u4', reservedFor: null, dueDate: endOfDayFromNow(9), renewals: 0, queue: ['u2', 'u1'] },
        { id: 'B109', title: 'Software Engineering', author: 'Ian Sommerville', category: 'Software Engineering',
          status: 'available', borrowedBy: null, reservedFor: null, dueDate: null, renewals: 0, queue: [] },
        { id: 'B110', title: 'Artificial Intelligence: A Modern Approach', author: 'Stuart Russell', category: 'Artificial Intelligence',
          status: 'reserved', borrowedBy: null, reservedFor: 'u4', dueDate: null, renewals: 0, queue: [] }
      ],
      requests: [
        { id: 'R001', bookId: 'B105', userId: 'u3', status: 'pending', createdAt: endOfDayFromNow(-1), resolvedAt: null,
          pickup: toInputDate(endOfDayFromNow(1)), note: 'Needed for the web design course.', reason: '' },
        { id: 'R002', bookId: 'B110', userId: 'u4', status: 'pending', createdAt: endOfDayFromNow(0), resolvedAt: null,
          pickup: toInputDate(endOfDayFromNow(2)), note: '', reason: '' }
      ]
    };
  }

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.books)) return parsed;
      }
    } catch (err) { /* storage unavailable or corrupted: fall back to seed */ }
    return createSeed();
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* ignore */ }
  }

  /* ------------------------------------------------------------------
     4. LOOKUPS + BUSINESS RULES (pure helpers)
  ------------------------------------------------------------------ */
  const findBook = (id) => state.books.find((b) => b.id === id);
  const findUser = (id) => state.users.find((u) => u.id === id);
  const findRequest = (id) => state.requests.find((r) => r.id === id);
  const currentUser = () => findUser(state.role === 'librarian' ? 'lib1' : 'u1');

  function mustFindBook(id) {
    const book = findBook(id);
    if (!book) throw new ApiError(404, 'Book not found.');
    return book;
  }
  function mustFindRequest(id) {
    const req = findRequest(id);
    if (!req) throw new ApiError(404, 'Request not found.');
    return req;
  }
  function requireRole(role) {
    if (state.role !== role) {
      throw new ApiError(403, `Forbidden: this action needs the ${role} role.`);
    }
  }

  const queuePosition = (book, userId) => book.queue.indexOf(userId) + 1; // 0 if not queued
  const activeCount = (userId) =>
    state.books.filter((b) => b.borrowedBy === userId).length +
    state.requests.filter((r) => r.userId === userId && r.status === 'pending').length;

  function renewBlockReason(book, userId) {
    if (book.borrowedBy !== userId) return 'You have not borrowed this book.';
    if (isOverdue(book.dueDate)) return 'Overdue books cannot be renewed. Please return it.';
    if (book.renewals >= MAX_RENEWALS) return `Renewal limit reached (${MAX_RENEWALS} renewals).`;
    if (book.queue.length > 0) return 'Other students are waiting for this book.';
    return null;
  }

  function createRequest(bookId, userId, extra = {}) {
    const req = {
      id: 'R' + String(state.nextRequestNumber++).padStart(3, '0'),
      bookId, userId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      pickup: extra.pickup || '',
      note: extra.note || '',
      reason: ''
    };
    state.requests.push(req);
    return req;
  }

  /* Called when a book comes back / a request is dropped.
     FIFO: the student at the FRONT of the queue is served first. */
  function promoteOrRelease(book) {
    book.borrowedBy = null;
    book.dueDate = null;
    book.renewals = 0;
    book.reservedFor = null;
    if (book.queue.length > 0) {
      const nextUser = book.queue.shift();            // dequeue (first in, first out)
      createRequest(book.id, nextUser, { note: 'Created automatically from the hold queue.' });
      book.status = 'reserved';
      book.reservedFor = nextUser;
    } else {
      book.status = 'available';
    }
  }

  function validateBookInput(data) {
    const title = String(data.title || '').trim();
    const author = String(data.author || '').trim();
    const category = String(data.category || '');
    if (title.length < 2 || title.length > 80) throw new ApiError(422, 'Title must be 2-80 characters.');
    if (author.length < 2 || author.length > 60) throw new ApiError(422, 'Author must be 2-60 characters.');
    if (!CATEGORIES.includes(category)) throw new ApiError(422, 'Please choose a valid category.');
    return { title, author, category };
  }

  /* ------------------------------------------------------------------
     5. SIMULATED SERVER (Promises + setTimeout)
        To connect a real API later, replace the body of callApi with:
          const res = await fetch(path, { method, headers, body });
          if (!res.ok) throw new ApiError(res.status, ...);
          return res.json();
        and move each handler's logic to the server.
  ------------------------------------------------------------------ */
  const httpLog = [];
  let inFlight = 0;

  function setNetworkStatus() {
    $('#netStatus').hidden = inFlight === 0;
    document.body.setAttribute('aria-busy', inFlight > 0 ? 'true' : 'false');
  }

  function callApi(method, path, handler) {
    const started = performance.now();
    inFlight++;
    setNetworkStatus();
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let status = method === 'POST' ? 201 : 200;
        let result;
        let failure = null;
        try {
          result = handler();
          if (method !== 'GET') saveState();
        } catch (err) {
          failure = err;
          status = err.status || 500;
        }
        inFlight--;
        setNetworkStatus();
        logHttp(method, path, status, Math.round(performance.now() - started));
        if (failure) reject(failure); else resolve(result);
      }, API_DELAY);
    });
  }

  function logHttp(method, path, status, ms) {
    httpLog.unshift({ method, path, status, ms });
    if (httpLog.length > 8) httpLog.pop();
    renderHttpLog();
  }

  /* The "API" - each function is one endpoint. */
  const api = {
    /* GET /api/books?q=&category=&status=   (Search API) */
    searchBooks({ q = '', category = '', availability = '' } = {}) {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (availability) params.set('status', availability);
      const query = params.toString();
      return callApi('GET', '/api/books' + (query ? '?' + query : ''), () => {
        const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return state.books
          .filter((book) => {
            const haystack = [book.title, book.author, book.category, book.id].map((v) => v.toLowerCase());
            const textOk = terms.every((term) => haystack.some((field) => field.includes(term)));
            const categoryOk = !category || book.category === category;
            const statusOk = !availability || book.status === availability;
            return textOk && categoryOk && statusOk;
          })
          .sort((a, b) => a.title.localeCompare(b.title));
      });
    },

    /* POST /api/requests  - request an available book */
    requestBook(bookId, { pickup = '', note = '' } = {}) {
      return callApi('POST', '/api/requests', () => {
        requireRole('student');
        const user = currentUser();
        const book = mustFindBook(bookId);
        if (book.status !== 'available') {
          throw new ApiError(409, `"${book.title}" is no longer available. Join its hold queue instead.`);
        }
        if (activeCount(user.id) >= MAX_ACTIVE) {
          throw new ApiError(422, `Limit reached: you can have at most ${MAX_ACTIVE} loans and pending requests.`);
        }
        const req = createRequest(book.id, user.id, { pickup, note });
        book.status = 'reserved';
        book.reservedFor = user.id;
        return req;
      });
    },

    /* POST /api/books/:id/queue  - join the FIFO hold queue */
    joinQueue(bookId) {
      return callApi('POST', `/api/books/${bookId}/queue`, () => {
        requireRole('student');
        const user = currentUser();
        const book = mustFindBook(bookId);
        if (book.status === 'available') throw new ApiError(409, 'This book is available - request it directly.');
        if (book.borrowedBy === user.id) throw new ApiError(409, 'You already have this book on loan.');
        if (book.reservedFor === user.id) throw new ApiError(409, 'You already have a pending request for this book.');
        if (book.queue.includes(user.id)) throw new ApiError(409, 'You are already in this queue.');
        book.queue.push(user.id);                         // enqueue at the back
        return { book, position: book.queue.length };
      });
    },

    /* DELETE /api/books/:id/queue */
    leaveQueue(bookId) {
      return callApi('DELETE', `/api/books/${bookId}/queue`, () => {
        requireRole('student');
        const book = mustFindBook(bookId);
        const index = book.queue.indexOf(currentUser().id);
        if (index === -1) throw new ApiError(404, 'You are not in this queue.');
        book.queue.splice(index, 1);
        return book;
      });
    },

    /* POST /api/loans/:id/renew */
    renew(bookId) {
      return callApi('POST', `/api/loans/${bookId}/renew`, () => {
        requireRole('student');
        const book = mustFindBook(bookId);
        const reason = renewBlockReason(book, currentUser().id);
        if (reason) throw new ApiError(409, reason);
        book.dueDate = addDays(book.dueDate, RENEW_DAYS);  // date calculation
        book.renewals += 1;
        return book;
      });
    },

    /* POST /api/loans/:id/return */
    returnBook(bookId) {
      return callApi('POST', `/api/loans/${bookId}/return`, () => {
        requireRole('student');
        const book = mustFindBook(bookId);
        if (book.borrowedBy !== currentUser().id) throw new ApiError(403, 'This is not your loan.');
        promoteOrRelease(book);
        return book;
      });
    },

    /* DELETE /api/requests/:id - student cancels own pending request */
    cancelRequest(requestId) {
      return callApi('DELETE', `/api/requests/${requestId}`, () => {
        requireRole('student');
        const req = mustFindRequest(requestId);
        if (req.userId !== currentUser().id) throw new ApiError(403, 'This is not your request.');
        if (req.status !== 'pending') throw new ApiError(409, 'Only pending requests can be cancelled.');
        req.status = 'cancelled';
        req.resolvedAt = new Date().toISOString();
        promoteOrRelease(mustFindBook(req.bookId));
        return req;
      });
    },

    /* PATCH /api/requests/:id  {status:'approved'} */
    approve(requestId) {
      return callApi('PATCH', `/api/requests/${requestId}`, () => {
        requireRole('librarian');
        const req = mustFindRequest(requestId);
        if (req.status !== 'pending') throw new ApiError(409, 'This request was already processed.');
        const book = mustFindBook(req.bookId);
        req.status = 'approved';
        req.resolvedAt = new Date().toISOString();
        book.status = 'borrowed';
        book.borrowedBy = req.userId;
        book.reservedFor = null;
        book.renewals = 0;
        book.dueDate = endOfDayFromNow(LOAN_DAYS);
        return { req, book };
      });
    },

    /* PATCH /api/requests/:id  {status:'rejected', reason} */
    reject(requestId, reason) {
      return callApi('PATCH', `/api/requests/${requestId}`, () => {
        requireRole('librarian');
        const cleaned = String(reason || '').trim();
        if (cleaned.length < 5) throw new ApiError(422, 'Please give a reason (at least 5 characters).');
        const req = mustFindRequest(requestId);
        if (req.status !== 'pending') throw new ApiError(409, 'This request was already processed.');
        req.status = 'rejected';
        req.reason = cleaned;
        req.resolvedAt = new Date().toISOString();
        promoteOrRelease(mustFindBook(req.bookId));
        return req;
      });
    },

    /* POST /api/books  (Create) */
    addBook(data) {
      return callApi('POST', '/api/books', () => {
        requireRole('librarian');
        const clean = validateBookInput(data);
        const duplicate = state.books.some((b) =>
          b.title.toLowerCase() === clean.title.toLowerCase() && b.author.toLowerCase() === clean.author.toLowerCase());
        if (duplicate) throw new ApiError(409, 'A book with this title and author already exists.');
        const book = Object.assign({
          id: 'B' + state.nextBookNumber++,
          status: 'available', borrowedBy: null, reservedFor: null, dueDate: null, renewals: 0, queue: []
        }, clean);
        state.books.push(book);
        return book;
      });
    },

    /* PUT /api/books/:id  (Update) */
    updateBook(bookId, data) {
      return callApi('PUT', `/api/books/${bookId}`, () => {
        requireRole('librarian');
        const book = mustFindBook(bookId);
        Object.assign(book, validateBookInput(data));
        return book;
      });
    },

    /* DELETE /api/books/:id  (Delete) */
    deleteBook(bookId) {
      return callApi('DELETE', `/api/books/${bookId}`, () => {
        requireRole('librarian');
        const book = mustFindBook(bookId);
        if (book.status !== 'available' || book.queue.length > 0) {
          throw new ApiError(409, 'Cannot delete a book that is on loan, reserved or has a queue.');
        }
        state.books = state.books.filter((b) => b.id !== bookId);
        state.requests = state.requests.filter((r) => r.bookId !== bookId);
        return book;
      });
    },

    /* PUT /api/profile */
    saveProfile(data) {
      return callApi('PUT', '/api/profile', () => {
        requireRole('student');
        const user = currentUser();
        const name = String(data.name || '').trim();
        const studentId = String(data.studentId || '').trim();
        const email = String(data.email || '').trim();
        if (name.length < 3) throw new ApiError(422, 'Name must be at least 3 characters.');
        if (!/^[A-Za-z]{2,6}-[0-9]{3,6}$/.test(studentId)) throw new ApiError(422, 'Student ID format is invalid.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'Email address is invalid.');
        Object.assign(user, { name, studentId, email });
        return user;
      });
    }
  };

  /* ------------------------------------------------------------------
     6. UI FEEDBACK: toast, validation, action wrapper
  ------------------------------------------------------------------ */
  let toastTimer = null;
  function toast(message, kind = 'info') {
    const box = $('#toast');
    box.textContent = message;
    box.className = 'toast ' + kind;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 4500);
  }

  function validateField(field) {
    const errorBox = document.getElementById(field.id + '-error');
    if (!errorBox) return true;
    // Extra rules the browser does not apply on its own (whitespace-only, minlength on scripted values)
    field.setCustomValidity('');
    const isText = field.tagName === 'TEXTAREA' || ['text', 'search'].includes(field.type);
    if (isText) {
      const trimmed = field.value.trim();
      if (field.required && trimmed === '') field.setCustomValidity('required');
      else if (field.minLength > 0 && trimmed !== '' && trimmed.length < field.minLength) field.setCustomValidity('short');
    }
    const valid = field.checkValidity();
    errorBox.textContent = valid ? '' : friendlyMessage(field);
    if (valid) field.removeAttribute('aria-invalid'); else field.setAttribute('aria-invalid', 'true');
    return valid;
  }
  function friendlyMessage(field) {
    const v = field.validity;
    if (v.customError) {
      return field.validationMessage === 'short'
        ? `Please enter at least ${field.minLength} characters.`
        : 'This field is required.';
    }
    if (v.valueMissing) return 'This field is required.';
    if (v.tooShort) return `Please enter at least ${field.minLength} characters.`;
    if (v.typeMismatch && field.type === 'email') return 'Please enter a valid email address, e.g. name@university.edu.';
    if (v.patternMismatch) return field.title || 'Please match the requested format.';
    if (v.rangeUnderflow) return 'That date is in the past.';
    if (v.rangeOverflow) return 'Please choose a date within the next 7 days.';
    if (v.badInput) return 'Please enter a valid value.';
    return field.validationMessage;
  }
  function validateForm(form) {
    let firstInvalid = null;
    $$('input, select, textarea', form).forEach((field) => {
      if (!validateField(field) && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }
  function liveValidate(form) {
    form.addEventListener('input', (e) => {
      if (e.target.getAttribute('aria-invalid') === 'true') validateField(e.target);
    });
    form.addEventListener('change', (e) => {
      if (e.target.getAttribute('aria-invalid') === 'true') validateField(e.target);
    });
  }

  /* Runs an API call from a button: disables it, shows the result, re-renders.
     Buttons inside static forms are restored afterwards; card/table buttons are
     rebuilt by the render functions. */
  async function act(button, task, successMessage) {
    const original = button ? button.textContent : '';
    const staticButton = Boolean(button && button.closest('form'));
    if (button) { button.disabled = true; button.textContent = 'Working\u2026'; }
    const restore = () => {
      if (button && button.isConnected) { button.disabled = false; button.textContent = original; }
    };
    try {
      const result = await task();
      toast(typeof successMessage === 'function' ? successMessage(result) : successMessage, 'success');
      renderAll();
      runSearch({ quiet: true });
      if (staticButton) restore();
      return result;
    } catch (err) {
      toast(err.message || 'Something went wrong.', 'error');
      restore();
      return null;
    }
  }

  /* ------------------------------------------------------------------
     7. RENDERING
  ------------------------------------------------------------------ */
  function statusBadge(status) {
    return h('span', { class: 'badge badge-' + status }, STATUS_LABEL[status] || status);
  }
  function requestBadge(status) {
    return h('span', { class: 'badge badge-' + status }, status.charAt(0).toUpperCase() + status.slice(1));
  }
  function emptyInline(text) { return h('p', { class: 'empty-inline' }, text); }
  function td(label, ...kids) { return h('td', { 'data-label': label }, h('div', { class: 'cell' }, ...kids)); }
  function table(captionText, headings, rows) {
    return h('table', null,
      h('caption', { class: 'visually-hidden' }, captionText),
      h('thead', null, h('tr', null, headings.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows));
  }

  /* ---- Dashboard ---- */
  function renderDashboard() {
    const total = state.books.length;
    const count = (s) => state.books.filter((b) => b.status === s).length;
    $('#stat-total').textContent = total;
    $('#stat-available').textContent = count('available');
    $('#stat-borrowed').textContent = count('borrowed');
    $('#stat-reserved').textContent = count('reserved');
    $('#stat-pending').textContent = state.requests.filter((r) => r.status === 'pending').length;
    $('#stat-waiting').textContent = state.books.reduce((sum, b) => sum + b.queue.length, 0);
    ['available', 'borrowed', 'reserved'].forEach((s) => {
      $('#seg-' + s).style.width = total ? (count(s) / total * 100) + '%' : '0%';
    });
    $('#availBar').setAttribute('aria-label',
      `Availability: ${count('available')} available, ${count('borrowed')} borrowed, ${count('reserved')} reserved out of ${total} books`);
  }

  /* ---- Catalogue cards ---- */
  function bookInfo(book, me) {
    const lines = [];
    if (book.status === 'available') {
      lines.push(h('p', null, 'Ready to request.'));
    } else if (book.status === 'borrowed') {
      if (book.borrowedBy === me.id) {
        lines.push(h('p', null, h('strong', null, 'You have this book.')));
      }
      lines.push(h('p', null, 'Due back: ', h('strong', null, formatDate(book.dueDate)), ` (${relativeDue(book.dueDate)})`));
    } else {
      lines.push(h('p', null, book.reservedFor === me.id
        ? 'Reserved for you - awaiting librarian approval.'
        : 'Held for another student - awaiting librarian approval.'));
    }
    if (book.queue.length > 0) {
      const mine = queuePosition(book, me.id);
      lines.push(h('p', null, `${book.queue.length} student${book.queue.length === 1 ? '' : 's'} waiting.`,
        mine ? h('strong', null, ` Your position: #${mine}.`) : null));
    }
    return h('div', { class: 'book-info' }, lines);
  }

  function bookActions(book, me) {
    if (state.role === 'librarian') {
      return [h('p', { class: 'card-note' }, 'Librarian view. Switch to the Student role to place requests.')];
    }
    if (book.borrowedBy === me.id) {
      const reason = renewBlockReason(book, me.id);
      return [
        reason
          ? h('p', { class: 'card-note' }, 'Cannot renew: ' + reason)
          : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => doRenew(e.currentTarget, book) }, 'Renew +7 days'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => doReturn(e.currentTarget, book) }, 'Return book')
      ];
    }
    if (book.reservedFor === me.id) {
      return [h('p', { class: 'card-note' }, 'Your request is pending approval. See My Requests.')];
    }
    if (book.status === 'available') {
      return [h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => doRequest(e.currentTarget, book) }, 'Request this book')];
    }
    if (book.queue.includes(me.id)) {
      return [h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => doLeaveQueue(e.currentTarget, book) }, 'Leave hold queue')];
    }
    return [h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => doJoinQueue(e.currentTarget, book) }, 'Join hold queue')];
  }

  function bookCard(book) {
    const me = currentUser();
    return h('li', { class: 'book-card status-' + book.status },
      h('div', { class: 'book-top' }, h('span', { class: 'tag' }, book.category), statusBadge(book.status)),
      h('h2', { class: 'book-title' }, book.title),
      h('p', { class: 'book-author' }, 'by ' + book.author),
      h('p', { class: 'book-id' }, 'ID: ' + book.id),
      bookInfo(book, me),
      h('div', { class: 'card-actions' }, bookActions(book, me)));
  }

  let lastResultCount = null;
  function renderBooks(books) {
    const grid = $('#bookGrid');
    grid.replaceChildren(...books.map(bookCard));
    const empty = books.length === 0;
    $('#emptyState').hidden = !empty;
    lastResultCount = books.length;
    $('#resultsStatus').textContent = empty
      ? 'No books found.'
      : `Showing ${books.length} of ${state.books.length} book${state.books.length === 1 ? '' : 's'}.`;
  }

  /* ---- Search (debounced, guards against out-of-order responses) ---- */
  let searchSeq = 0;
  let debounceTimer = null;

  function readFilters() {
    return {
      q: $('#searchInput').value,
      category: $('#categoryFilter').value,
      availability: $('#availabilityFilter').value
    };
  }
  async function runSearch({ quiet = false } = {}) {
    const input = $('#searchInput');
    if (!validateField(input)) return;                 // invalid input: do not search
    const seq = ++searchSeq;
    const grid = $('#bookGrid');
    if (!quiet) {
      grid.setAttribute('aria-busy', 'true');
      $('#resultsStatus').textContent = 'Searching…';
    }
    try {
      const results = await api.searchBooks(readFilters());
      if (seq !== searchSeq) return;                   // a newer search started: ignore this one
      renderBooks(results);
    } catch (err) {
      if (seq === searchSeq) { $('#resultsStatus').textContent = 'Search failed. Please try again.'; }
    } finally {
      if (seq === searchSeq) grid.setAttribute('aria-busy', 'false');
    }
  }
  function clearFilters() {
    $('#searchForm').reset();            // fires the form's "reset" event (handled in init)
  }

  /* ---- My Requests (student) ---- */
  function renderBorrowed() {
    const me = currentUser();
    const loans = state.books.filter((b) => b.borrowedBy === me.id).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const wrap = $('#borrowedWrap');
    if (loans.length === 0) {
      wrap.replaceChildren(emptyInline('You have no borrowed books right now. Browse the catalogue to request one.'));
      return;
    }
    const rows = loans.map((book) => {
      const reason = renewBlockReason(book, me.id);
      const overdue = isOverdue(book.dueDate);
      return h('tr', null,
        td('Book', h('strong', null, book.title), h('br'), h('span', { class: 'muted small' }, book.id + ' · ' + book.author)),
        td('Due date', formatDate(book.dueDate)),
        td('Status', h('span', { class: 'badge ' + (overdue ? 'badge-overdue' : 'badge-approved') }, relativeDue(book.dueDate))),
        td('Renewals', `${book.renewals} / ${MAX_RENEWALS}`),
        td('Actions', h('div', { class: 'actions' },
          reason
            ? h('span', { class: 'muted small' }, reason)
            : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => doRenew(e.currentTarget, book) }, 'Renew +7 days'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => doReturn(e.currentTarget, book) }, 'Return'))));
    });
    wrap.replaceChildren(table('My borrowed books', ['Book', 'Due date', 'Status', 'Renewals', 'Actions'], rows));
  }

  function renderQueues() {
    const me = currentUser();
    const queued = state.books.filter((b) => b.queue.length > 0);
    const wrap = $('#queueWrap');
    if (queued.length === 0) {
      wrap.replaceChildren(emptyInline('There are no hold queues right now.'));
      return;
    }
    queued.sort((a, b) => (queuePosition(b, me.id) > 0) - (queuePosition(a, me.id) > 0) || a.title.localeCompare(b.title));
    const items = queued.map((book) => {
      const myPos = queuePosition(book, me.id);
      let eta = 'Awaiting librarian decision on the current request.';
      if (book.status === 'borrowed') {
        const readyBy = addDays(book.dueDate, (Math.max(myPos, 1) - 1) * LOAN_DAYS);
        eta = myPos
          ? `Estimated ready after ${formatDate(readyBy)} (if returned on time).`
          : `Current loan due back ${formatDate(book.dueDate)}.`;
      }
      return h('li', { class: 'queue-item' + (myPos ? ' mine' : '') },
        h('div', { class: 'queue-head' },
          h('h3', null, book.title),
          statusBadge(book.status)),
        h('p', { class: 'muted small' }, `${book.id} · ${book.queue.length} waiting · ${eta}`),
        h('ol', { class: 'queue-people', 'aria-label': 'Queue order, first to last' },
          book.queue.map((uid, i) => h('li', { class: uid === me.id ? 'you' : null },
            uid === me.id ? `You (position #${i + 1})` : 'Another student'))),
        myPos
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => doLeaveQueue(e.currentTarget, book) }, 'Leave this queue')
          : null);
    });
    wrap.replaceChildren(h('ul', { class: 'queue-list' }, items));
  }

  function renderHistory() {
    const me = currentUser();
    const mine = state.requests.filter((r) => r.userId === me.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const wrap = $('#historyWrap');
    if (mine.length === 0) {
      wrap.replaceChildren(emptyInline('You have not made any requests yet.'));
      return;
    }
    const rows = mine.map((req) => {
      const book = findBook(req.bookId);
      return h('tr', null,
        td('Request', req.id),
        td('Book', book ? book.title : '(removed)'),
        td('Date', formatDate(req.createdAt)),
        td('Status', requestBadge(req.status), req.reason ? h('div', { class: 'muted small' }, 'Reason: ' + req.reason) : null),
        td('Action', req.status === 'pending'
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => doCancel(e.currentTarget, req) }, 'Cancel')
          : '–'));
    });
    wrap.replaceChildren(table('My requests', ['Request', 'Book', 'Date', 'Status', 'Action'], rows));
  }

  function renderRequestForm() {
    const me = currentUser();
    const select = $('#reqBook');
    const previous = select.value;
    const options = [h('option', { value: '' }, 'Choose a book')];
    state.books
      .filter((b) => b.borrowedBy !== me.id && b.reservedFor !== me.id && !b.queue.includes(me.id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .forEach((b) => {
        const label = b.status === 'available' ? 'available' : `${b.status} - join hold queue`;
        options.push(h('option', { value: b.id }, `${b.title} (${label})`));
      });
    select.replaceChildren(...options);
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  function renderProfile() {
    const me = currentUser();
    $('#whoName').textContent = me.name;
    if (state.role === 'student' && document.activeElement && !$('#profileForm').contains(document.activeElement)) {
      $('#profName').value = me.name;
      $('#profId').value = me.studentId;
      $('#profEmail').value = me.email;
    }
  }

  /* ---- Librarian panel ---- */
  let editingBookId = null;

  function renderLibrarian() {
    renderPending();
    renderProcessed();
    renderInventory();
  }

  function renderPending() {
    const pending = state.requests.filter((r) => r.status === 'pending').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    $('#pendingCount').textContent = pending.length;
    const wrap = $('#pendingWrap');
    if (pending.length === 0) {
      wrap.replaceChildren(emptyInline('No pending requests. Nice work!'));
      return;
    }
    const rows = pending.map((req) => {
      const book = findBook(req.bookId);
      const user = findUser(req.userId);
      return h('tr', null,
        td('Request', req.id),
        td('Book', h('strong', null, book ? book.title : '(removed)'), h('br'), h('span', { class: 'muted small' }, book ? book.id : '')),
        td('Student', user ? `${user.name}${user.studentId ? ' (' + user.studentId + ')' : ''}` : 'Unknown'),
        td('Requested', formatDate(req.createdAt)),
        td('Pick-up / note', (req.pickup ? 'Pick-up ' + formatDate(req.pickup) : 'No date') + (req.note ? ' – ' + req.note : '')),
        td('Actions', h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn-ok btn-sm', onclick: (e) => doApprove(e.currentTarget, req) }, 'Approve'),
          h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => openRejectDialog(req) }, 'Reject'))));
    });
    wrap.replaceChildren(table('Pending requests', ['Request', 'Book', 'Student', 'Requested', 'Pick-up / note', 'Actions'], rows));
  }

  function renderProcessed() {
    const done = state.requests
      .filter((r) => r.status !== 'pending' && r.resolvedAt)
      .sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt))
      .slice(0, 6);
    const wrap = $('#processedWrap');
    if (done.length === 0) {
      wrap.replaceChildren(emptyInline('Nothing processed yet in this session.'));
      return;
    }
    const rows = done.map((req) => {
      const book = findBook(req.bookId);
      const user = findUser(req.userId);
      return h('tr', null,
        td('Request', req.id),
        td('Book', book ? book.title : '(removed)'),
        td('Student', user ? user.name : 'Unknown'),
        td('Outcome', requestBadge(req.status), req.reason ? h('div', { class: 'muted small' }, req.reason) : null),
        td('Processed', formatDate(req.resolvedAt)));
    });
    wrap.replaceChildren(table('Recently processed requests', ['Request', 'Book', 'Student', 'Outcome', 'Processed'], rows));
  }

  function renderInventory() {
    const rows = [...state.books].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).map((book) =>
      h('tr', null,
        td('ID', book.id),
        td('Title', h('strong', null, book.title), h('br'), h('span', { class: 'muted small' }, book.author + ' · ' + book.category)),
        td('Status', statusBadge(book.status)),
        td('Actions', h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => startEdit(book) }, 'Edit'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => doDelete(e.currentTarget, book) }, 'Delete')))));
    $('#inventoryWrap').replaceChildren(table('Catalogue records', ['ID', 'Title', 'Status', 'Actions'], rows));
  }

  function startEdit(book) {
    editingBookId = book.id;
    $('#bookTitle').value = book.title;
    $('#bookAuthor').value = book.author;
    $('#bookCategory').value = book.category;
    $('#bookform-title').textContent = 'Edit book ' + book.id;
    $('#bookSubmit').textContent = 'Save changes';
    $('#bookCancel').hidden = false;
    $$('#bookForm .error').forEach((e) => { e.textContent = ''; });
    $$('#bookForm [aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
    $('#bookTitle').focus();
    $('#bookForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function stopEdit() {
    editingBookId = null;
    $('#bookForm').reset();
    $('#bookform-title').textContent = 'Add a book';
    $('#bookSubmit').textContent = 'Add book';
    $('#bookCancel').hidden = true;
    $$('#bookForm .error').forEach((e) => { e.textContent = ''; });
    $$('#bookForm [aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
  }

  /* ---- HTTP log ---- */
  function renderHttpLog() {
    const list = $('#httpLog');
    list.replaceChildren(...httpLog.map((entry) =>
      h('li', null,
        h('span', { class: 'm' }, entry.method),
        h('span', { class: 'p' }, entry.path),
        h('span', { class: entry.status < 400 ? 's-ok' : 's-err' }, String(entry.status)),
        h('span', { class: 't' }, entry.ms + ' ms'))));
    $('#httpLogEmpty').hidden = httpLog.length > 0;
  }

  /* ---- Master render ---- */
  function renderAll() {
    renderDashboard();
    if (state.role === 'student') {
      renderBorrowed();
      renderQueues();
      renderHistory();
      renderRequestForm();
      renderProfile();
    } else {
      renderLibrarian();
    }
  }

  /* ------------------------------------------------------------------
     8. ACTIONS (event handlers -> API calls)
  ------------------------------------------------------------------ */
  const doRequest = (btn, book) => act(btn, () => api.requestBook(book.id, {}),
    () => `Request sent for "${book.title}". A librarian will review it.`);
  const doJoinQueue = (btn, book) => act(btn, () => api.joinQueue(book.id),
    (r) => `You joined the queue for "${book.title}" at position #${r.position}.`);
  const doLeaveQueue = (btn, book) => act(btn, () => api.leaveQueue(book.id),
    () => `You left the queue for "${book.title}".`);
  const doRenew = (btn, book) => act(btn, () => api.renew(book.id),
    (r) => `Renewed. "${book.title}" is now due ${formatDate(r.dueDate)}.`);
  const doReturn = (btn, book) => act(btn, () => api.returnBook(book.id),
    () => `"${book.title}" returned. Thank you!`);
  const doCancel = (btn, req) => act(btn, () => api.cancelRequest(req.id),
    () => `Request ${req.id} cancelled.`);
  const doApprove = (btn, req) => act(btn, () => api.approve(req.id),
    (r) => `Approved. "${r.book.title}" is due ${formatDate(r.book.dueDate)}.`);
  const doDelete = (btn, book) => {
    if (!window.confirm(`Delete "${book.title}" (${book.id})? This cannot be undone.`)) return;
    if (editingBookId === book.id) stopEdit();
    act(btn, () => api.deleteBook(book.id), () => `"${book.title}" was deleted.`);
  };

  /* Reject dialog */
  let rejectTarget = null;
  function openRejectDialog(req) {
    const dialog = $('#rejectDialog');
    const book = findBook(req.bookId);
    const user = findUser(req.userId);
    rejectTarget = req;
    $('#rejectSummary').textContent = `${req.id}: "${book ? book.title : 'book'}" requested by ${user ? user.name : 'a student'}.`;
    $('#rejectReason').value = '';
    $('#rejectReason-error').textContent = '';
    $('#rejectReason').removeAttribute('aria-invalid');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    $('#rejectReason').focus();
  }
  function closeRejectDialog() {
    const dialog = $('#rejectDialog');
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    rejectTarget = null;
  }

  /* ------------------------------------------------------------------
     9. ROLES (simulated authorization) + ROUTING
  ------------------------------------------------------------------ */
  function applyRole() {
    $('#roleSelect').value = state.role;
    $$('[data-role-only]').forEach((el) => { el.hidden = el.dataset.roleOnly !== state.role; });
  }

  const ROUTES = ['home', 'browse', 'requests', 'librarian'];
  const ROUTE_ROLE = { requests: 'student', librarian: 'librarian' };
  let firstRoute = true;

  function route() {
    let name = (location.hash || '#home').slice(1);
    if (!ROUTES.includes(name)) name = 'home';
    const needed = ROUTE_ROLE[name];
    if (needed && needed !== state.role) {
      toast(`That page is only available to the ${needed} role.`, 'error');
      name = 'home';
      history.replaceState(null, '', '#home');
    }
    ROUTES.forEach((r) => { $('#view-' + r).hidden = r !== name; });
    $$('[data-route]').forEach((a) => {
      if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const titles = { home: 'Home', browse: 'Browse Books', requests: 'My Requests', librarian: 'Librarian' };
    document.title = `${titles[name]} - Library Request & Availability Board`;
    closeMenu();
    if (!firstRoute) { window.scrollTo(0, 0); $('#main').focus(); }
    firstRoute = false;
  }

  function closeMenu() {
    $('#primaryNav').classList.remove('open');
    $('#navToggle').setAttribute('aria-expanded', 'false');
  }

  /* ------------------------------------------------------------------
     10. INITIALISATION + EVENT WIRING
  ------------------------------------------------------------------ */
  function init() {
    // category dropdowns
    CATEGORIES.forEach((c) => {
      $('#categoryFilter').append(h('option', { value: c }, c));
      $('#bookCategory').append(h('option', { value: c }, c));
    });
    $('#reqPickup').min = toInputDate(new Date());
    $('#reqPickup').max = toInputDate(addDays(new Date().toISOString(), 7));
    $('#reqPickup').value = toInputDate(addDays(new Date().toISOString(), 1));

    // navigation
    $('#navToggle').addEventListener('click', () => {
      const open = $('#primaryNav').classList.toggle('open');
      $('#navToggle').setAttribute('aria-expanded', String(open));
    });
    window.addEventListener('hashchange', route);

    // role switch (simulated authorization)
    $('#roleSelect').addEventListener('change', (e) => {
      state.role = e.target.value === 'librarian' ? 'librarian' : 'student';
      saveState();
      applyRole();
      renderAll();
      runSearch({ quiet: true });
      toast(`Switched to the ${state.role} role (demo only - not real security).`, 'info');
      route();
    });

    // search
    const searchForm = $('#searchForm');
    searchForm.addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
    $('#searchInput').addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, SEARCH_DEBOUNCE);
    });
    $('#categoryFilter').addEventListener('change', () => runSearch());
    $('#availabilityFilter').addEventListener('change', () => runSearch());
    searchForm.addEventListener('reset', () => {
      // wait one tick so the browser has restored the default field values
      setTimeout(() => {
        $('#searchInput-error').textContent = '';
        $('#searchInput').removeAttribute('aria-invalid');
        runSearch();
      }, 0);
    });
    $('#emptyClear').addEventListener('click', clearFilters);

    // request form
    const requestForm = $('#requestForm');
    liveValidate(requestForm);
    $('#reqNote').addEventListener('input', (e) => { $('#reqNoteCount').textContent = e.target.value.length; });
    requestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(requestForm)) return;
      const book = findBook($('#reqBook').value);
      if (!book) { toast('Please choose a book.', 'error'); return; }
      const submit = $('button[type="submit"]', requestForm);
      const pickup = $('#reqPickup').value;
      const note = $('#reqNote').value.trim();
      const done = book.status === 'available'
        ? await act(submit, () => api.requestBook(book.id, { pickup, note }), () => `Request sent for "${book.title}".`)
        : await act(submit, () => api.joinQueue(book.id), (r) => `You joined the queue for "${book.title}" at position #${r.position}.`);
      if (done) {
        requestForm.reset();
        $('#reqPickup').value = toInputDate(addDays(new Date().toISOString(), 1));
        $('#reqNoteCount').textContent = '0';
      }
    });

    // profile form
    const profileForm = $('#profileForm');
    liveValidate(profileForm);
    profileForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validateForm(profileForm)) return;
      const data = { name: $('#profName').value, studentId: $('#profId').value, email: $('#profEmail').value };
      act($('button[type="submit"]', profileForm), () => api.saveProfile(data), 'Your details were saved.');
    });

    // book form (librarian create / update)
    const bookForm = $('#bookForm');
    liveValidate(bookForm);
    bookForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(bookForm)) return;
      const data = { title: $('#bookTitle').value, author: $('#bookAuthor').value, category: $('#bookCategory').value };
      const submit = $('#bookSubmit');
      const editing = editingBookId;
      const result = editing
        ? await act(submit, () => api.updateBook(editing, data), (b) => `Updated ${b.id}.`)
        : await act(submit, () => api.addBook(data), (b) => `Added "${b.title}" as ${b.id}.`);
      if (result) stopEdit();
    });
    $('#bookCancel').addEventListener('click', stopEdit);

    // reject dialog
    const rejectForm = $('#rejectForm');
    liveValidate(rejectForm);
    rejectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(rejectForm) || !rejectTarget) return;
      const req = rejectTarget;
      const reason = $('#rejectReason').value;
      const button = $('#rejectConfirm');
      const ok = await act(button, () => api.reject(req.id, reason), () => `Request ${req.id} rejected.`);
      if (ok) closeRejectDialog();
    });
    $('#rejectCancel').addEventListener('click', closeRejectDialog);

    // reset sample data
    $('#resetData').addEventListener('click', () => {
      if (!window.confirm('Reset all sample data and your changes?')) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
      state = createSeed();
      httpLog.length = 0;
      renderHttpLog();
      stopEdit();
      applyRole();
      renderAll();
      runSearch({ quiet: true });
      route();
      toast('Sample data was reset.', 'success');
    });

    // constants shown in text
    $$('[data-const="loan"]').forEach((el) => { el.textContent = LOAN_DAYS; });
    $$('[data-const="renew"]').forEach((el) => { el.textContent = MAX_RENEWALS; });

    applyRole();
    renderAll();
    renderHttpLog();
    route();
    runSearch();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
