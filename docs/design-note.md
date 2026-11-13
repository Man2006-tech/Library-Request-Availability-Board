# Design Note - Library Request & Availability Board

**Assignment 1 - Client-side web application** | Assigned idea **#14** | Weeks 1-5 (HTML, CSS, JavaScript, DOM)

## 1. User and problem

| | |
|---|---|
| **Primary user** | A university **student** who wants a book and needs to know whether it is free, when it comes back, and how many people are already waiting. |
| **Secondary user** | A **librarian** who approves/rejects pending requests and maintains catalogue records. |
| **Problem** | Students do not know if a book is available, when it will be returned or how long the queue is, so they make wasted trips or request blindly. |
| **Solution** | A single-page portal that shows live availability, due dates and queue positions, and lets students request, queue and renew while librarians process requests. |

**Core workflow:** search -> see status -> request (available) *or* join hold queue (unavailable) -> librarian approves/rejects -> due date appears -> renew or return -> next student in queue is served.

**Assigned rule:** *Add catalog search, hold queue, due dates, renewals and librarian processing. Avoid claiming real library integration.* The app shows a "demonstration prototype" banner and uses only invented sample data.

## 2. Web Development Life Cycle (WDLC)

| Stage | What was done |
|---|---|
| **1. Planning** | Chose the user, problem, six features and the 12-item minimum checklist; defined user roles and the request/queue rules. |
| **2. Analysis & design** | Listed requirements, designed the data model (Book, User, Request), drew the wireframe (`docs/wireframe.svg`), picked a navy/gold "university library" visual style. |
| **3. Development** | HTML structure and forms -> CSS layout and responsive rules -> JavaScript logic (search, queue, renewals, librarian CRUD) built in that order. |
| **4. Testing** | Tested every feature, invalid/empty input, role restrictions, and mobile/tablet/desktop widths (see README checklist). |
| **5. Deployment & maintenance** | Source on GitHub; can be hosted on GitHub Pages. Later assignments add a server and database. |

## 3. Browser client vs. server

| Runs in the **browser** (this assignment) | Would run on a **server** (later) |
|---|---|
| HTML structure, CSS layout, responsive behaviour | Authentication (who is this user?) |
| Search filtering, queue (FIFO) and renewal logic | **Authorization** enforced for every request |
| Form validation and error messages | Database storing books, users, requests, loans |
| Sample data in a JS array (+ `localStorage`) | Business rules that cannot be bypassed |
| Simulated HTTP calls with Promises + `setTimeout` | Real library-system integration (**not claimed**) |

**HTTP explanation.** Each user action calls `callApi(method, path, handler)`, which waits 450 ms (simulated latency) and logs a request such as `GET /api/books?q=clean`, `POST /api/requests`, `PATCH /api/requests/R003`, with a status code (200, 201, 403, 409, 422...). A real version would replace the body of `callApi` with `fetch()`; the paths, methods and status codes were chosen to match a REST-style API. The live log on the Home page shows this.

| Action | Simulated request | Typical status |
|---|---|---|
| Search | `GET /api/books?q=&category=&status=` | 200 |
| Request book | `POST /api/requests` | 201 / 409 / 422 |
| Join / leave queue | `POST` / `DELETE /api/books/:id/queue` | 201 / 200 / 409 |
| Renew | `POST /api/loans/:id/renew` | 201 / 409 |
| Approve / reject | `PATCH /api/requests/:id` | 200 / 422 / 403 |
| Add / edit / delete book | `POST` / `PUT` / `DELETE /api/books` | 201 / 200 / 409 |

## 4. Data model

```js
Book    { id, title, author, category, status: 'available'|'borrowed'|'reserved',
          borrowedBy, reservedFor, dueDate, renewals, queue: [userId, ...] }
User    { id, name, studentId, email, role: 'student'|'librarian' }
Request { id, bookId, userId, status: 'pending'|'approved'|'rejected'|'cancelled',
          createdAt, resolvedAt, pickup, note, reason }
```

## 5. Key rules

- **Request:** only an *available* book can be requested; it becomes *reserved* for that student until a librarian decides.
- **Queue (FIFO):** `queue.push(userId)` to join, `queue.shift()` to serve the first student. When a book is returned or a request is rejected/cancelled, the first queued student automatically gets a pending request.
- **Due date:** approval sets `today + 14 days`. Displayed with a relative label ("3 days left", "2 days overdue").
- **Renewal:** +7 days, max 2 renewals; blocked if overdue or if anyone is waiting.
- **Limits:** max 3 active loans + pending requests per student.
- **Authorization (simulated):** the Role switch hides/shows UI and each API handler checks `requireRole()`, returning 403 if the role is wrong. **This is not real security** - a user can change JavaScript in the browser. Real authorization must be enforced on the server.
- **Privacy:** other students in a queue are shown anonymously.

## 6. Layout and responsive design

Single-page app with sections: Navbar, Dashboard, Book Catalogue, Hold Queue, My Borrowed Books, Librarian Panel.

| Breakpoint | Layout |
|---|---|
| **< 768px (mobile)** | Hamburger menu; one-column cards; tables turn into stacked "cards"; filters stacked. |
| **>= 768px (tablet)** | Horizontal nav; 2-column card grid; 3-column stats; side-by-side forms. |
| **>= 1024px (desktop)** | 3-column card grid; 6 stat tiles in one row; 4-step "How it works" row. |

CSS techniques: CSS variables, box-sizing/box model, Flexbox (header, actions, badges), Grid (cards, stats, forms), media queries (`min-width: 768px`, `1024px`, plus `max-width: 767px` and `480px` refinements).

## 7. Accessibility

Semantic landmarks (`header`, `nav`, `main`, `section`, `footer`), one `h1` per view, skip link, labelled form controls with `aria-describedby` hints/errors, correct input types (`search`, `date`, `email`), `aria-live` regions for results and toasts, `aria-current` on the active nav link, `aria-expanded` on the menu button, visible focus outlines, 44px touch targets, text labels on every status badge (colour is never the only cue), and a `prefers-reduced-motion` rule.

## 8. Sources, attribution and AI disclosure

- No frameworks, libraries, CSS frameworks, templates, fonts or images were used. Icons are hand-written inline SVG. Fonts are system fonts.
- Book titles and authors are real, well-known textbooks used only as sample records; no real library data or availability is claimed.
- **AI assistance:** *Claude (Anthropic) was used to help generate and review the code and documentation for this project.* The author reviewed, tested and is responsible for the submission and can explain and modify every part. (Edit this paragraph so it matches exactly how you used AI, as your course requires.)
