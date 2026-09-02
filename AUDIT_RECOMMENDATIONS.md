# Comprehensive Architecture and Implementation Plan

## 1. Executive Summary

The Sports Watchability Index is a functioning, ambitious prototype built on a completely client-side architecture. It achieves complex data fetching, aggressive mathematical calculations (simulating award races using MLB live data), and dynamic UI updates entirely in vanilla JavaScript (`app.js`).

However, this monolithic, client-heavy approach has reached its structural limits. The primary risks to the application are:

1. **Brittle Test Environment:** The Jest test suite relies heavily on raw string evaluation via Node's `vm` module to bypass DOM dependencies, making it extremely flaky and nearly impossible to maintain without JSDOM. It is currently failing.
2. **Missing Backend Integration:** While robust backend scaffolding exists (Sequelize models, migrations, Express server), it is completely decoupled from the frontend. The frontend attempts to post data to non-existent endpoints (e.g., `/api/live-predictions`).
3. **Monolithic Complexity:** `app.js` (over 5,000 lines) handles state, data fetching, polling, UI reconciliation, and mathematical models simultaneously. It is highly prone to regressions.
4. **Client-Side Scalability:** Polling massive MLB APIs directly from the browser for every active game scales poorly, risking rate-limits and causing severe performance bottlenecks on low-powered devices.

The path forward requires stabilizing the environment first, decoupling the data from the UI, and incrementally migrating heavy workloads to the Node.js backend.

## 2. Confirmed Problems

Based on a thorough independent audit, the following issues are verified:

* **Backend Missing `/api/live-predictions` Endpoint:** The frontend makes `fetch` POST requests to this endpoint inside the polling loop, which results in continuous 404s because `backend/src/routes` only defines `/health`.
* **Brittle Test Suite (Broken):** `npm test` fails immediately. The setup attempts to run `vm.runInThisContext` on `app.js` and `core.js` multiple times without a proper JSDOM environment, leading to `ReferenceError: window is not defined` and `SyntaxError: Identifier 'APP_PREFS_KEY' has already been declared`.
* **Missing `MockMLBProvider`:** Tests and local development directly hit `statsapi.mlb.com`. There is no mock provider using `sim_data.json` to ensure deterministic offline testing.
* **Disconnected Backend Infrastructure:** The SQLite database is successfully configured and Sequelize models exist (e.g., `Game`, `Prediction`), but they are not hooked up to the Express API or the frontend.
* **Global State Mutation:** Variables like `window.livePredictions`, `usedStaleData`, and `favoriteTeams` are modified globally across different files and contexts, leading to unpredictable side effects.
* **Monolithic `app.js`:** Verified at 5431 lines. It tightly couples rendering logic (`innerHTML` updates) with business logic (e.g., `scoreMVPHitter`).

## 3. Newly Discovered Problems

In addition to the provided audit, the following issues were discovered:

* **Missing Jest Configuration:** There was no `jest.config.js` properly wiring up `jest-environment-jsdom` or ignoring bad test files, exacerbating the test suite failures.
* **Test Isolation Failures:** Tests like `core.test.js` modify global `localStorage` mocks but fail to clean up their Node module environment appropriately when executed concurrently by Jest workers, leading to child process crashes.
* **Missing TextEncoder/TextDecoder:** Backend tests using `supertest` fail in the Jest environment due to missing `TextEncoder` globals required by underlying hashing libraries (`@noble/hashes`, `cuid2`).
* **Unused/Broken `.env` Setup:** The `.sequelizerc` file was missing, causing `npx sequelize-cli` commands to fail out of the box because it couldn't find the configuration path.

## 4. Architecture Recommendation

The ultimate goal is to move from a monolithic "thick-client" to a decoupled, API-driven architecture without a complete rewrite. We should stick to vanilla ES6 modules for the frontend for now, proving modularity before considering a framework like React.

**Target Architecture:**
1. **Data Layer (Backend):** Node.js cron workers poll the MLB/NBA APIs, calculate watchability scores and award models, and persist the normalized state to the SQLite database via Sequelize.
2. **API Layer (Backend):** Express serves clean, sanitized REST endpoints (e.g., `/api/state`, `/api/games/live`, `/api/predictions`).
3. **Application State (Frontend):** A centralized vanilla JS state manager (Pub/Sub or minimal Redux-like store) holds the current UI state.
4. **UI Components (Frontend):** Modular ES6 classes/functions render specific DOM sections (e.g., `GameCard.js`, `Leaderboard.js`) based on state changes, rather than massive string interpolations in one file.

## 5. Dependency Map

To avoid breaking the application, changes must occur in strict sequence:

1. **Test Environment** MUST precede **Refactoring `app.js`** or **MockMLBProvider**. We cannot refactor a 5000-line file without passing tests.
2. **MockMLBProvider** MUST precede **Backend Data Fetching**. We need deterministic data to ensure our new backend endpoints return exactly what the client expects.
3. **Backend API Contracts** MUST precede **Moving Data Fetching to Backend**. We must define the JSON schemas before rewriting the client to consume them.
4. **Centralized State Management** MUST precede **Modularizing `app.js` UI components**. Components need a reliable place to read state from before they are extracted.
5. **Replacing Frontend Polling** MUST precede **WebSockets**. We should first move the polling from the client to the backend (cron worker), expose a REST endpoint for the client, and only *then* swap the client's REST polling for WebSockets.

## 6. Prioritized Backlog

### P0 - Broken / Critical (Do Now)
* **Problem:** Jest test suite fails entirely (JSDOM, TextEncoder, `vm` context conflicts).
  * **Files:** `jest.config.js`, `jest.setup.js`, `tests/*.test.js`
  * **Solution:** Install `jest-environment-jsdom`, properly mock globals, and refactor tests to use standard `require()` instead of `vm.runInThisContext`.
  * **Difficulty:** Medium | **Dependencies:** None | **Risk:** Low

* **Problem:** Continuous 404 errors for `/api/live-predictions`.
  * **Files:** `backend/src/routes/predictions.js`, `backend/src/app.js`
  * **Solution:** Implement a basic POST route that accepts the payload and stores it via the Sequelize `Prediction` model.
  * **Difficulty:** Low | **Dependencies:** Test Environment | **Risk:** Low

### P1 - Reliability (Do Soon)
* **Problem:** No deterministic offline testing environment for MLB data.
  * **Files:** `js/providers/mock-mlb-provider.js`
  * **Solution:** Implement the `MLBProvider` interface to return static responses from `sim_data.json`.
  * **Difficulty:** Medium | **Dependencies:** Test Environment | **Risk:** Low

* **Problem:** Global State Mutation (`usedStaleData`, `window.livePredictions`).
  * **Files:** `app.js`, `utils/state.js` (new)
  * **Solution:** Create a centralized state object with strict getter/setter methods to prevent random mutations.
  * **Difficulty:** Medium | **Dependencies:** Test Environment | **Risk:** Medium

### P2 - Architecture (Do Soon)
* **Problem:** Monolithic `app.js` (5400+ lines).
  * **Files:** `app.js`, `js/models/awards.js` (new)
  * **Solution:** Extract purely mathematical models (e.g., `scoreMVPHitter`, `scoreCY`) out of `app.js` and into dedicated, testable ES6 modules first.
  * **Difficulty:** High | **Dependencies:** Test Env, Central State | **Risk:** High

* **Problem:** Missing Input Validation on Backend.
  * **Files:** `backend/src/routes/*`
  * **Solution:** Add `Zod` or `Joi` middleware to validate incoming payloads (especially for predictions).
  * **Difficulty:** Low | **Dependencies:** API Endpoints | **Risk:** Low

### P3 - UX (Do Later)
* **Problem:** Missing loading states during initial massive data fetch.
  * **Files:** `mlb.html`, `styles.css`, `app.js`
  * **Solution:** Add CSS skeleton loaders to the DOM while waiting for the initial API responses.
  * **Difficulty:** Low | **Dependencies:** None | **Risk:** Low

### P4 - Performance (Do Later)
* **Problem:** Client-side over-fetching and processing.
  * **Files:** `app.js`, `backend/src/workers/*`
  * **Solution:** Move the MLB API polling logic to a Node.js background worker, aggregate the state, and serve a single optimized payload to the frontend.
  * **Difficulty:** High | **Dependencies:** Backend API Contracts | **Risk:** High

### P5 - New Features (Do Much Later)
* **Problem:** WebSockets / Real-Time Push.
  * **Files:** `backend/src/server.js`, `app.js`
  * **Solution:** Replace HTTP polling with `Socket.IO` to broadcast state deltas.
  * **Difficulty:** High | **Dependencies:** Backend Data Fetching | **Risk:** High

## 7. First Implementation Sprint (The Next Steps)

The goal of this sprint is purely stability, testability, and eliminating known broken errors.

1. **Fix the Test Environment (P0):**
   * *What:* Create `jest.config.js` pointing to JSDOM, setup `jest.setup.js` with `TextEncoder`, and refactor `tests/core.test.js` to avoid `vm.runInThisContext` conflicts.
   * *Why:* We cannot safely touch `app.js` without a green test suite.
   * *Files:* `jest.config.js`, `jest.setup.js`, `tests/*.test.js`, `package.json`

2. **Implement `/api/live-predictions` Endpoint (P0):**
   * *What:* Create a POST endpoint in Express that accepts the prediction payload and logs it/saves it to SQLite.
   * *Why:* Stops the continuous 404 network errors in the browser console during live games.
   * *Files:* `backend/src/app.js`, `backend/src/routes/predictions.js`

3. **Create the `MockMLBProvider` (P1):**
   * *What:* Create `js/providers/mock-mlb-provider.js` that implements `getScheduledGames`, `getLiveGames`, etc., by parsing `sim_data.json`.
   * *Why:* Allows us to develop UI and backend logic locally without being tied to live MLB schedules or rate limits.
   * *Files:* `js/providers/mock-mlb-provider.js`

4. **Add Backend Payload Validation (P2):**
   * *What:* Install `zod` and apply it to the new `/api/live-predictions` route to ensure incoming data matches the expected schema before hitting SQLite.
   * *Why:* Secures the only active data-ingestion point from the client.
   * *Files:* `backend/src/routes/predictions.js`, `backend/src/middleware/validate.js`

5. **Extract Award Models from `app.js` (P2):**
   * *What:* Move `scoreMVPHitter`, `scoreMVPPitcher`, and `scoreCY` into a new `js/models/awards.js` file and import them into `app.js` and the test suite.
   * *Why:* This removes several hundred lines of pure math from the UI monolith, proving the ES6 extraction pattern.
   * *Files:* `app.js`, `js/models/awards.js`, `tests/live_model_pipeline.test.js`

## 8. Future Architecture Phases

* **Phase A: Stabilize (Current Sprint):** Tests pass, errors gone, mock data available.
* **Phase B: Modularize UI:** Extract `GameCard` and `Leaderboard` into vanilla JS modules. Implement centralized state (Pub/Sub).
* **Phase C: Backend Data Layer:** Build out REST APIs for `Games` and `Players`. Move the heavy data aggregation from `app.js` to a Node.js cron worker.
* **Phase D: Real-Time Infrastructure:** Implement WebSockets to push state deltas to the client.
* **Phase E: Product Features:** User accounts, push notifications, highlights.

## 9. New Feature Recommendations

**1. Web Push Notifications for Milestones**
* *Value:* Users are alerted when high-leverage moments happen (e.g., Ohtani on deck for 50/50), driving re-engagement.
* *Difficulty/Dependencies:* Medium. Requires a stable backend data layer and user preference storage.
* *Priority:* High (Post-Phase C)

**2. Video Highlights API Integration**
* *Value:* Showing the actual play rather than just the box score drastically improves the "watchability" dashboard's utility.
* *Difficulty/Dependencies:* High. Requires integrating a 3rd party API (MLB Film Room or Twitter).
* *Priority:* Medium (Post-Phase D)

## 10. Top 10 Actions (Execution Order)

1. Ensure `.env` and `.sequelizerc` are configured so the DB works out of the box.
2. Install `jest-environment-jsdom` and configure `jest.config.js` and `jest.setup.js`.
3. Refactor the broken test files (`core.test.js`, `app.test.js`) to use standard imports rather than `vm` where possible, or isolate contexts safely.
4. Implement `POST /api/live-predictions` using Express and Sequelize.
5. Create `MockMLBProvider` backed by `sim_data.json`.
6. Add `zod` validation middleware to the backend.
7. Configure `cors` strictly and add `express-rate-limit` to the backend.
8. Extract the Award models (`scoreMVPHitter`, etc.) from `app.js` to `js/models/awards.js`.
9. Add basic CSS loading skeletons to `mlb.html`.
10. Verify the entire application passes tests and the UI still renders correctly without 404s.
