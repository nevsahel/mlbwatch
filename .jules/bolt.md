## 2025-05-14 - Parallelization Anti-pattern in Promise.all
**Learning:** Found sequential fetch patterns inside `Promise.all` using `await` within the array literal (e.g., `await Promise.all([await fetch(a), await fetch(b)])`). This causes the first fetch to block the second, nullifying the benefits of parallelization.
**Action:** Always ensure functions passed to `Promise.all` are invoked without an immediate `await` if concurrent execution is desired.

## 2025-05-14 - Redundant Request Multiplication
**Learning:** The application was fetching full career hitting AND pitching stats for every player in the milestone loop regardless of their role. For ~60 players, this generated 120 requests where 60 would suffice.
**Action:** Conditionalize network requests based on player metadata (group/role) before adding to the batch fetcher.
