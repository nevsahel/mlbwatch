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
