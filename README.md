# 🏟️ Sports Watchability Index

A sophisticated, data-driven live dashboard for both Major League Baseball (MLB) and the National Basketball Association (NBA) that uses a multi-factor **Watchability Index** to identify the most compelling action in real-time. From pennant races and high-stakes late-inning drama to clutch time and 4th quarter comebacks, this tool ensures you're always tuned into the game's most important moments.

---

## 🚀 Key Features

### 🔥 Real-Time Game Dashboard
- **Intelligent Ranking**: Games are dynamically sorted by watchability, ensuring high-leverage action is always at the top.
- **Situational Graphics**: Instant visual context with bases-occupied indicators, out counters, and pitch counts.
- **Win Probability Sparklines**: Live SVG-rendered sparklines visualizing the ebb and flow of every game.
- **Dynamic Theming**: UI elements automatically adapt to team brand colors for an immersive experience.

### 🏆 Award Race Projections
- **Simulated Voting**: Projections for MVP and Cy Young use a unique **5-voter panel simulation** (Traditionalist, Stat-head, etc.) based on fWAR and traditional metrics.
- **Silver Slugger Field**: Interactive SVG field diagrams showing the projected Silver Slugger at every position.
- **All-Star Roster Builder**: Real-time 34-man roster projections for both leagues, ensuring every MLB club is represented.

### 🎯 Milestone & Record Watch
- **Chase Board**: Tracks players approaching major career (3000 Hits, 500 HR) and season benchmarks.
- **Follow Chase**: Users can "follow" specific milestones to receive high-priority alerts when that player is at the plate.
- **Heat Maps**: Visualizes a player's recent performance (Last 10 games) relative to their milestone chase.

### 🕹️ Interactive Tools
- **The Duel**: A matchup simulator for both MLB and NBA. Compare batters and pitchers, or dive into matchup data.
- **Command Centers**: The **Home Run Command Center** tracks every HR today with spray charts and launch metrics, while the **Shot Center** tracks impactful basketball shots.
- **Players of the Day**: For NBA, tracks top performances across the league.
- **Live Ticker**: A scrolling feed of the league's most impactful plays, lead changes, and "clutch" events.

---

## 📐 The Watchability Index (0–100)

The index uses a tiered, bounded calculation system to ensure scores spread naturally across the full range, tailored to each sport.

### ⚾ MLB Logic
#### 1. Situation Component (Max 50 pts)
Measures immediate leverage and drama:
- **Score Closeness**: Massive boosts for tied games (+20) and 1-run leads (+15).
- **Urgency**: Bonuses for the 9th inning (+15) and extra innings (up to +18).
- **Pressure**: Points for runners in scoring position and two-out threats.
- **Special Events**: 10-point "No-Hitter/Perfect Game" override for games entering the 7th inning.

#### 2. Context Component (Max 30 pts raw)
Measures historical and seasonal gravity:
- **Star Power**: Daily tiers (T1/T2/T3) driven by live Fangraphs fWAR data.
- **Team Quality**: Rewards matchups between high-winning-percentage teams.
- **Playoff Stakes**: Elevated scores for divisional rivalries and bubble-team matchups.

#### 3. Final Calculation
- **Live**: `30 (Base) + Situation + (Context * 0.65)`
- **100 Score Requirements**: A game must be tied in extras, with bases loaded, featuring Tier 1 stars, in a playoff race, during a historic rivalry.

### 🏀 NBA Logic
#### 1. Situation Component (Max 55 pts)
Measures immediate leverage and late-game drama:
- **Score Closeness**: Boosts for tied games (+25) and one-possession games (1-3 pts, +20).
- **Urgency**: Bonuses for Overtime (+25), the 4th period (+15), and Clutch Time (<2m, +15).

#### 2. Context Component (Max 35 pts raw)
Measures matchup gravity:
- **Team Quality**: Rewards high-quality matchups (+10).
- **Star Power**: Based on superstars per team (+5/team).
- **Rivalry**: Elevated scores for rivalry games (+8).

#### 3. Final Calculation
- **Live**: `35 (Base) + Situation + (Context * 0.70)`

---

## 🏆 Award Simulation Model

Unlike static leaderboards, our Award tab simulates actual BBWAA voting patterns:
- **Voter Profiles**: Each projection aggregates five simulated ballots:
    - *Traditionalist*: Weights Wins, RBI, and ERA.
    - *Sabermetrician*: Heavily weights fWAR and park-adjusted metrics.
    - *Balanced*: A 50/50 blend of old and new school.
    - *Clutch/Narrative*: Favors players on winning teams in high-leverage roles.
    - *Dominance*: Focused on rate stats like K/9 and OPS.
- **Cy Young Criteria**: Requires a minimum qualification of 1.0 IP per team game played.

---

## 🛠️ Technology & Performance

Built with vanilla ES6+ JavaScript and a focus on high-concurrency data orchestration:

- **`RequestPool`**: A custom deduplication layer that prevents redundant simultaneous API calls and integrates persistent cross-session caching.
- **`BatchFetcher`**: Manages parallel network requests with intelligent queuing and concurrency limits (default: 5) to respect API rate limits.
- **`PersistentCache`**: A TTL-based storage wrapper for `localStorage`, ensuring data like Fangraphs tiers (24h) and Game Feeds (15s) stay fresh without over-fetching.
- **`PerfTimer`**: Built-in performance monitoring to track rendering and I/O latency.
- **A11y & UX**: Full keyboard navigation, `aria-live` regions for updates, and **Spoiler Mode** to hide scores for specific teams.

---

## 📁 Project Structure

```text
├── app.js               # Core orchestration, scoring logic, and UI rendering (MLB)
├── backend/             # Python FastAPI backend and SQLAlchemy models
│   ├── app/             # API, configuration, database, and models
│   └── tests/           # Python backend tests
├── index.html           # Sport selector landing page
├── mlb.html             # MLB dashboard main layout
├── nba.html             # NBA dashboard main layout
├── check_nba_api.js     # Utility for testing ESPN API responses
├── styles.css           # Comprehensive dark-themed design system
├── css/
│   └── variables.css    # CSS variables and theme configuration
├── js/
│   ├── constants.js     # Team metadata, rivalry pairs, and scoring config (MLB)
│   ├── landing.js       # Landing page logic and game peek functionality
│   ├── live-model-pipeline.js # MLB prediction analytics model integration
│   ├── nba-app.js       # Core orchestration, scoring logic, and UI rendering (NBA)
│   ├── nba-constants.js # Team metadata, rivalry pairs, and scoring config (NBA)
│   └── providers/
│       └── mlb-provider.js # External API requests and data normalization for MLB
├── tests/               # Test suite for unit and integration testing
├── utils/
│   ├── core.js          # Shared utilities (formatting, storage, notifications)
│   └── performance.js   # Request management, batching, and caching
└── service-worker.js    # PWA offline support and asset caching
```

---

*Data provided by MLB Stats API, Baseball Savant, Fangraphs, and the ESPN API.*

---

## 🚀 Running the Project

### Python backend

The API backend uses Python, FastAPI, and SQLAlchemy. From the repository root, install its dependencies and start it with:

```bash
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m backend
```

The API listens on port 3000 by default. Check `http://localhost:3000/api/health` and `http://localhost:3000/api/health/database`.
For development with automatic reload, run `python -m uvicorn backend.app.main:app --reload --port 3000`.

The database defaults to SQLite at `backend/database.sqlite`. The SQLAlchemy model schema is created when the API starts. Configure the database with these optional root `.env` values:

```env
DB_DIALECT=sqlite
DB_STORAGE=./backend/database.sqlite
PORT=3000
```

To use another SQLAlchemy-supported database, set `DATABASE_URL` to its connection URL. Run the preserved sample data seeder with `python -m backend.app.seed`.

The frontend remains the existing JavaScript browser app; only the API backend was migrated to Python.
