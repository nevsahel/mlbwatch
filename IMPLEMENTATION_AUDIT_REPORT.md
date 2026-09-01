# Implementation Audit Report

This report provides a comprehensive audit of the Sports Watchability Index repository, evaluating it from the perspectives of software engineering, product design, and QA.

---

## 1. Bugs and Broken Functionality

### 1.1 Backend Missing `/api/live-predictions` Endpoint
* **Priority:** Critical
* **Category:** Bug / Broken Functionality
* **File(s) involved:** `app.js`, `backend/src/routes/`, `IMPLEMENTATION_AUDIT.md`
* **What is currently happening:** The frontend makes a POST request to `/api/live-predictions` inside the `fetchLiveGamesData()` polling loop (around line 1110 in `app.js`). This endpoint does not exist on the current Node.js backend, resulting in continuous 404 errors during live games.
* **Why it is a problem:** Fails to store or propagate live predictions to the backend, breaking the intended full-stack data flow and causing unnecessary network errors on the client.
* **Recommended solution:** Implement the `/api/live-predictions` POST endpoint on the Express server to receive and store prediction data in the SQLite database.
* **Estimated implementation difficulty:** Low
* **Address:** Now

### 1.2 Brittle Test Suite and Environment Setup
* **Priority:** High
* **Category:** Testing / Environment
* **File(s) involved:** `tests/*.test.js`, `package.json`
* **What is currently happening:** The Jest test suite fails out of the box because tests rely heavily on Node's `vm` module to execute vanilla browser scripts without a proper JSDOM environment. Global variables and context overlap cause syntax and reference errors (e.g., `APP_PREFS_KEY` already declared).
* **Why it is a problem:** Developers cannot confidently run `npm test`. The CI pipeline will fail, and new changes cannot be safely verified.
* **Recommended solution:** Configure Jest to use `jest-environment-jsdom`. Refactor the test suite to use standard ES modules or CommonJS exports instead of evaluating raw strings via `vm.runInThisContext`.
* **Estimated implementation difficulty:** Medium
* **Address:** Now

### 1.3 Missing Mock Provider for MLB Data
* **Priority:** Medium
* **Category:** Testing / Broken Functionality
* **File(s) involved:** `js/providers/mock-mlb-provider.js` (Missing)
* **What is currently happening:** The repository lacks a mock provider. Tests and local development are forced to hit the live MLB API, which may be unavailable, change structure, or have rate limits.
* **Why it is a problem:** Local development and testing are brittle and non-deterministic.
* **Recommended solution:** Create a `MockMLBProvider` that implements the same interface as `MLBProvider`, returning data from the existing `sim_data.json`.
* **Estimated implementation difficulty:** Medium
* **Address:** Soon

---

## 2. Incomplete or Abandoned Features

### 2.1 Backend Infrastructure and Database
* **Priority:** High
* **Category:** Architecture
* **File(s) involved:** `backend/src/db/models/*`, `backend/src/app.js`
* **What is currently happening:** Sequelize models exist for `Game`, `Player`, `Team`, `Venue`, etc. Migrations and seeders are present, but the backend application does not utilize them. Only a `/api/health` route is active.
* **Why it is a problem:** The application is architected as a pure client-side app, despite the presence of backend scaffolding. Data is not persisted globally.
* **Recommended solution:** Build out standard REST/GraphQL endpoints for the defined database models to migrate state management from the client to the backend.
* **Estimated implementation difficulty:** High
* **Address:** Soon

### 2.2 WebSocket Real-Time Integration
* **Priority:** Medium
* **Category:** Feature / Architecture
* **File(s) involved:** `app.js`, `backend/src/server.js`
* **What is currently happening:** Real-time updates are mentioned as a goal, but the client currently polls `statsapi.mlb.com` directly using `setTimeout`.
* **Why it is a problem:** Polling uses excessive bandwidth and battery for users, risks client-side rate-limiting, and has higher latency.
* **Recommended solution:** Implement `Socket.IO` or raw WebSockets on the Node.js backend. Have the backend poll the MLB API once and broadcast state deltas to connected clients.
* **Estimated implementation difficulty:** High
* **Address:** Later

---

## 3. New Feature Opportunities

### 3.1 Push Notifications for Milestone Chases
* **Priority:** Medium
* **Category:** New Feature
* **File(s) involved:** Service Worker, `app.js`
* **What is currently happening:** The app tracks milestones (e.g., Aaron Judge approaching 60 HRs) but only displays them in the UI when the user has the app open.
* **Why it is a problem:** Users miss high-leverage moments if they aren't actively watching the dashboard.
* **Recommended solution:** Integrate Web Push API via the existing service worker. Allow users to "subscribe" to specific players or milestones to receive device-level notifications when they are on deck.
* **Estimated implementation difficulty:** Medium
* **Address:** Later

### 3.2 User Accounts & Cross-Device Sync
* **Priority:** Low
* **Category:** New Feature
* **File(s) involved:** `backend/src/db/models/User.js` (New), Frontend Auth
* **What is currently happening:** Preferences (favorite teams, dark mode) are stored locally in `localStorage`.
* **Why it is a problem:** If a user switches from desktop to mobile, they lose their settings.
* **Recommended solution:** Add optional user authentication (e.g., OAuth/Magic Links) to store and sync user preferences on the backend.
* **Estimated implementation difficulty:** High
* **Address:** Later

---

## 4. Frontend and UX

### 4.1 Missing Loading Skeletons
* **Priority:** High
* **Category:** UX
* **File(s) involved:** `app.js`, `styles.css`
* **What is currently happening:** When the app first loads, it waits for heavy API responses before rendering the UI, potentially showing a blank or unstyled state.
* **Why it is a problem:** Poor perceived performance. Users might think the app is broken.
* **Recommended solution:** Implement CSS skeleton loaders for the game cards and award leaderboards to give immediate visual feedback during network requests.
* **Estimated implementation difficulty:** Low
* **Address:** Soon

### 4.2 Accessibility (a11y) Improvements
* **Priority:** Medium
* **Category:** UX
* **File(s) involved:** `mlb.html`, `nba.html`, `app.js`
* **What is currently happening:** While `aria-live` is used, keyboard navigation through dynamic game cards is clunky, and color contrast on some team-themed UI elements (e.g., Oakland A's dark green) falls below WCAG standards.
* **Why it is a problem:** Excludes users with disabilities and harms overall usability.
* **Recommended solution:** Run automated a11y audits (e.g., Lighthouse or axe-core), fix contrast ratios in `constants.js`, and ensure proper `tabindex` and focus trapping on modals/dialogs.
* **Estimated implementation difficulty:** Low
* **Address:** Soon

---

## 5. Architecture and Code Quality

### 5.1 Monolithic `app.js`
* **Priority:** Critical
* **Category:** Architecture
* **File(s) involved:** `app.js`
* **What is currently happening:** `app.js` is nearly 250KB and over 5000 lines long. It handles data fetching, DOM manipulation, complex mathematical scoring models, and state management.
* **Why it is a problem:** Extremely difficult to maintain, test, and extend. High risk of merge conflicts and regressions.
* **Recommended solution:** Refactor the frontend into modular ES6 components (e.g., `GameCard.js`, `AwardModel.js`, `DataService.js`) or transition to a lightweight framework like React, Vue, or Svelte.
* **Estimated implementation difficulty:** High
* **Address:** Soon

### 5.2 Global State Mutation
* **Priority:** High
* **Category:** Code Quality
* **File(s) involved:** `app.js`, `utils/core.js`
* **What is currently happening:** The code relies on mutable global variables like `window.livePredictions`, `usedStaleData`, and `favoriteTeams`.
* **Why it is a problem:** Causes unpredictable side effects, making debugging and unit testing incredibly difficult.
* **Recommended solution:** Implement a centralized state management pattern (e.g., a simple Pub/Sub event bus or Redux-like store) to manage state predictably.
* **Estimated implementation difficulty:** Medium
* **Address:** Soon

---

## 6. Performance

### 6.1 Client-Side Over-Fetching
* **Priority:** High
* **Category:** Performance
* **File(s) involved:** `app.js`
* **What is currently happening:** The client individually requests box scores and live feeds for every single active game, and calculates WAR and standings on the fly.
* **Why it is a problem:** Massive network overhead. Browsers limit concurrent connections, leading to UI stuttering and long load times.
* **Recommended solution:** Move the data aggregation to the backend. The backend should poll the MLB APIs, compile a single minimized payload representing the current state of the league, and send that to the client.
* **Estimated implementation difficulty:** High
* **Address:** Later

### 6.2 DOM Thrashing
* **Priority:** Medium
* **Category:** Performance
* **File(s) involved:** `app.js`
* **What is currently happening:** While `_lastStateKey` is used to skip some updates, much of the UI is updated via widespread `innerHTML` rewrites string-interpolated dynamically.
* **Why it is a problem:** Re-parsing HTML and destroying/recreating DOM nodes is CPU-intensive and causes layout thrashing, hurting scrolling performance on mobile.
* **Recommended solution:** Use precise DOM updates (e.g., `element.textContent = newScore`) rather than replacing entire blocks of HTML, or adopt a Virtual DOM framework.
* **Estimated implementation difficulty:** Medium
* **Address:** Later

---

## 7. Security and Reliability

### 7.1 Missing Rate Limiting and CORS Configuration
* **Priority:** Medium
* **Category:** Security
* **File(s) involved:** `backend/src/app.js`
* **What is currently happening:** The Express server uses default CORS settings and has no rate limiting middleware.
* **Why it is a problem:** Open to abuse, Denial of Service (DoS) attacks, and unauthorized cross-origin requests once deployed.
* **Recommended solution:** Implement `express-rate-limit` and configure `cors` to only accept requests from trusted frontend domains.
* **Estimated implementation difficulty:** Low
* **Address:** Soon

### 7.2 Lack of Input Sanitization on Backend
* **Priority:** High
* **Category:** Security
* **File(s) involved:** `backend/src/routes/*`
* **What is currently happening:** While the frontend uses `escapeHTML`, the backend does not appear to validate or sanitize incoming payloads (e.g., for `/api/live-predictions`).
* **Why it is a problem:** Susceptible to injection attacks or processing malformed data.
* **Recommended solution:** Implement a validation library like `Joi` or `Zod` on all backend routes to enforce strict payload schemas.
* **Estimated implementation difficulty:** Low
* **Address:** Soon

---

## 8. Data and API Integration

### 8.1 Brittle Provider Normalization
* **Priority:** Medium
* **Category:** Data Integration
* **File(s) involved:** `js/providers/mlb-provider.js`
* **What is currently happening:** The `_normalize*` functions use optional chaining (`?.`) heavily, but default values might not align with downstream expectations if the MLB API schema changes silently.
* **Why it is a problem:** Missing fields can cause NaN errors in the mathematical scoring models.
* **Recommended solution:** Use rigorous schema validation (like Zod) within the provider to explicitly catch and log upstream API changes, rather than silently passing `undefined` or `0` into the models.
* **Estimated implementation difficulty:** Medium
* **Address:** Later

---

## 9. Testing

### 9.1 Missing End-to-End (E2E) Tests
* **Priority:** High
* **Category:** Testing
* **File(s) involved:** N/A
* **What is currently happening:** There is no E2E testing framework in place.
* **Why it is a problem:** Unit tests cannot verify that the complex DOM manipulation, API polling, and UI rendering actually work together in a real browser.
* **Recommended solution:** Introduce Playwright or Cypress to script critical user journeys (e.g., loading the dashboard, selecting a sport, viewing a game card).
* **Estimated implementation difficulty:** Medium
* **Address:** Soon

### 9.2 Low Backend Test Coverage
* **Priority:** Medium
* **Category:** Testing
* **File(s) involved:** `backend/__tests__/*`
* **What is currently happening:** The backend tests mostly cover configuration and health checks. There is no business logic testing for controllers or database integrations.
* **Why it is a problem:** Prevents confident iteration on the backend infrastructure.
* **Recommended solution:** Add integration tests for all API routes using `supertest`, and unit tests for database interactions.
* **Estimated implementation difficulty:** Medium
* **Address:** Later

---

## 10. Product-Level Improvements

### 10.1 "Clutch" Video Highlights
* **Priority:** Low
* **Category:** Product
* **File(s) involved:** UI components
* **What is currently happening:** The dashboard tells you a game is highly watchable, but if you missed the play, you just see the box score.
* **Why it is a problem:** Users want to *see* the watchable moments, not just read about them.
* **Recommended solution:** Integrate the MLB Film Room API or Twitter API to pull in video highlights for high-leverage plays (e.g., game-tying home runs) directly into the game cards.
* **Estimated implementation difficulty:** High
* **Address:** Later

---

## Roadmap

### Fix Immediately
1. **Create the `/api/live-predictions` endpoint** on the backend to stop continuous 404 errors during client polling.
2. **Fix the Jest Test Suite Environment** by installing and configuring `jest-environment-jsdom` and removing the brittle `vm` module hacks.

### Fix Soon
3. **Refactor `app.js`** to modularize the 5000+ line monolith into manageable ES6 components.
4. **Implement UI Loading Skeletons** to improve the perceived load time and UX.
5. **Create a `MockMLBProvider`** using `sim_data.json` to allow offline development and stable testing.

### Quick Wins
6. **Add backend payload validation** (e.g., Zod) and rate-limiting to secure the API.
7. **Fix color contrast and keyboard navigation** to meet basic accessibility standards.

### New Features
8. **Build out Backend REST APIs** to utilize the existing Sequelize models and migrate state off the client.
9. **Implement Web Push Notifications** for milestone chases and high-watchability game alerts.

### Longer-Term Improvements
10. **Migrate to WebSockets** to stream live data from the backend to the client, replacing the inefficient HTTP polling mechanism.

### Recommended Next Steps (Top 10 Actions)
1. Add `jest-environment-jsdom` to `package.json` and update Jest configuration to use JSDOM for frontend tests.
2. Implement a basic `POST /api/live-predictions` route in Express to accept and acknowledge payloads.
3. Create `js/providers/mock-mlb-provider.js` that implements the `MLBProvider` interface using `sim_data.json`.
4. Refactor `app.js` by extracting the award scoring math (`scoreMVPHitter`, `scoreCY`, etc.) into a standalone `models.js` module.
5. Add CSS skeleton classes to `styles.css` and apply them to the initial HTML payload of `mlb.html`.
6. Implement `express-rate-limit` and basic CORS restrictions in `backend/src/app.js`.
7. Configure `eslint` and `prettier` to enforce code quality and formatting across the large codebase.
8. Set up Playwright and write one critical path E2E test verifying that `mlb.html` renders game cards correctly.
9. Implement a backend background worker (e.g., node-cron) to poll MLB APIs directly, seeding the database.
10. Update the frontend `fetchLiveGamesData` to fetch a consolidated payload from our new backend instead of `statsapi.mlb.com`.