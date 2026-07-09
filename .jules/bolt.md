## 2025-05-14 - Parallelization Anti-pattern in Promise.all
**Learning:** Found sequential fetch patterns inside `Promise.all` using `await` within the array literal (e.g., `await Promise.all([await fetch(a), await fetch(b)])`). This causes the first fetch to block the second, nullifying the benefits of parallelization.
**Action:** Always ensure functions passed to `Promise.all` are invoked without an immediate `await` if concurrent execution is desired.

## 2025-05-14 - Redundant Request Multiplication
**Learning:** The application was fetching full career hitting AND pitching stats for every player in the milestone loop regardless of their role. For ~60 players, this generated 120 requests where 60 would suffice.
**Action:** Conditionalize network requests based on player metadata (group/role) before adding to the batch fetcher.

## 2025-05-15 - Redundant Linear Search in Lookup Tables
**Learning:** Found O(N) linear search pattern using `Array.some()` for rivalry lookups in the NBA dashboard. While the list size was small, these functions are called frequently during polling and sorting.
**Action:** Use a `Set` of sorted-pair keys (e.g., 'TEAM1-TEAM2') to achieve O(1) lookup complexity, matching the optimization pattern used in the MLB dashboard.

## 2025-05-15 - Eager Cache Pre-loading Anti-pattern
**Learning:** Attempted to optimize `PersistentCache` by pre-loading all `localStorage` items into memory at startup. This was rejected because it breaks cross-tab data consistency (other tabs' writes aren't seen) and can significantly increase Time to Interactive (TTI) if the cache is large.
**Action:** Favor lazy-loading from `localStorage` and use a memory cache only for the current session's reads to maintain consistency and startup performance.

## 2025-05-16 - O(N) linear search in high-frequency rendering loop
**Learning:** Found a pattern in the MLB dashboard where every game card was performing an O(N) search through followed milestones using `Array.from(followedChases).some(...)`. This was executed on every poll/render cycle, leading to unnecessary CPU overhead as the number of followed milestones grows.
**Action:** Maintain a secondary Set of unique player IDs (`followedPlayerIds`) synchronized with the primary milestone Set to allow for O(1) lookups during the rendering phase.
## 2025-05-16 - Linear Search in Render Loop (MLB Followed Players)
**Learning:** Found an $O(N)$ linear search pattern in `app.js` using `Array.from(followedChases).some()` within the `renderSingleGameCard` function. This function is called for every game card on every polling update, leading to redundant work and array allocations as $N$ (number of followed milestones) increases.
**Action:** Implemented a secondary `Set` (`followedPlayerIds`) containing only unique player IDs for $O(1)$ lookups. This set is synchronized in `toggleFollowChase` to ensure rendering performance remains constant regardless of the number of followed milestones.
## 2025-05-16 - Costly String Iteration in Render Loop
**Learning:** In the MLB dashboard, `renderSingleGameCard` was performing an O(N) search on `followedChases` by converting the Set to an array and using `.some()` with string prefix matching on every game card during every poll refresh.
**Action:** Implement a companion Set (`followedPlayerIds`) containing only the numeric IDs to enable O(1) `.has()` lookups, drastically reducing CPU time in the main UI thread during live updates.

## 2025-05-17 - Reference Resolution Overhead in NBA Dashboard
**Learning:** In the NBA Milestone board, the application was resolving athlete and team metadata references sequentially for every item. This created significant promise overhead and redundant cache lookups for duplicate players/teams. Additionally, the dashboard was performing multiple filter/length passes over large arrays for summary statistics.
**Action:** Use a batch-resolution pattern: extract unique references into a `Set`, resolve them in parallel via `Promise.all`, and map them back to the dataset. For rendering, use a single-pass loop to calculate all counts and group items simultaneously.

## 2025-05-18 - Multiple Optimizations in NBA Dashboard
**Learning:** Found a syntax error in `js/nba-app.js` caused by duplicate variable declarations, which prevented the entire script from being parsed. Additionally, identified inefficient O(N) search patterns in both Leader metadata resolution and Standings rendering loops.
**Action:** Fixed the syntax error. Implemented a batch-resolution pattern in `fetchNBALeaders` to minimize asynchronous overhead. Refactored `renderNBAStandings` to use Map-based lookups, reducing row rendering complexity from O(N*M) to O(N+M). Removed redundant state updates in the game loop.

## 2026-07-09 - MLB Stats API Batching with Hydration
**Learning:** The application was making ~100 individual career stats requests when loading the Milestone tab. The MLB Stats API's `/people` endpoint supports batching multiple `personIds` and hydrating career stats for both hitting and pitching in a single call.
**Action:** Use the `/people?personIds=id1,id2&hydrate=stats(group=[hitting,pitching],type=[career])` pattern for large player sets. Pre-populate the individual cache keys from the batch response to maintain compatibility with legacy individual lookup logic and prevent redundant fetches in other parts of the UI.
