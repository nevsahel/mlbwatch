# ⚾ MLB Watchability Index

A sophisticated, data-driven live dashboard for Major League Baseball that uses a multi-factor **Watchability Index** to identify the most compelling action in real-time. From pennant races and milestone chases to high-stakes late-inning drama, this tool ensures you're always tuned into the game's most important moments.

---

## 🚀 Key Features

### 🔥 Real-Time Game Dashboard
- **Intelligent Ranking**: Games are dynamically sorted by watchability, ensuring high-leverage action is always at the top.
- **Situational Graphics**: Instant visual context with bases-occupied indicators, out counters, and pitch counts.
- **Win Probability Sparklines**: Live SVG-rendered sparklines visualizing the ebb and flow of every game.
- **Dynamic Theming**: UI elements automatically adapt to team brand colors for an immersive experience.

### 🏆 Award Race Projections
- **Simulated Voting**: Projections for MVP, Cy Young, and ROTY use a unique **5-voter panel simulation** (Traditionalist, Stat-head, etc.) based on fWAR and traditional metrics.
- **Silver Slugger Field**: Interactive SVG field diagrams showing the projected Silver Slugger at every position.
- **All-Star Roster Builder**: Real-time 34-man roster projections for both leagues, ensuring every MLB club is represented.

### 🎯 Milestone & Record Watch
- **Chase Board**: Tracks players approaching major career (3000 Hits, 500 HR) and season benchmarks.
- **Follow Chase**: Users can "follow" specific milestones to receive high-priority alerts when that player is at the plate.
- **Heat Maps**: Visualizes a player's recent performance (Last 10 games) relative to their milestone chase.

### 🕹️ Interactive Tools
- **The Duel**: A head-to-head matchup simulator. Compare any batter and pitcher in MLB history (or active) using a weighted blend of season and career data to predict outcomes.
- **Home Run Command Center**: Detailed tracking of every HR today, featuring **Baseball Savant-powered spray charts**, launch metrics, and Win Probability Added (WPA).
- **Live Ticker**: A scrolling feed of the league's most impactful plays, lead changes, and "clutch" events.

---

## 📐 The Watchability Index (0–100)

The index uses a tiered, bounded calculation system to ensure scores spread naturally across the full range.

### 1. Situation Component (Max 50 pts)
Measures immediate leverage and drama:
- **Score Closeness**: Massive boosts for tied games (+20) and 1-run leads (+15).
- **Urgency**: Bonuses for the 9th inning (+15) and extra innings (up to +18).
- **Pressure**: Points for runners in scoring position and two-out threats.
- **Special Events**: 10-point "No-Hitter/Perfect Game" override for games entering the 7th inning.

### 2. Context Component (Max 30 pts raw)
Measures historical and seasonal gravity:
- **Star Power**: Daily tiers (T1/T2/T3) driven by live Fangraphs fWAR data.
- **Team Quality**: Rewards matchups between high-winning-percentage teams.
- **Playoff Stakes**: Elevated scores for divisional rivalries and bubble-team matchups.

### 3. Final Calculation
- **Live**: `30 (Base) + Situation + (Context * 0.65)`
- **100 Score Requirements**: A game must be tied in extras, with bases loaded, featuring Tier 1 stars, in a playoff race, during a historic rivalry.

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
├── app.js               # Core orchestration, scoring logic, and UI rendering
├── index.html           # Sport selector landing page
├── mlb.html             # MLB dashboard main layout
├── nhl.html             # NHL dashboard main layout
├── styles.css           # Comprehensive dark-themed design system
├── js/
│   ├── constants.js     # Team metadata, rivalry pairs, and scoring config
│   └── modules/
│       └── api.js       # Specialized API interaction layers
├── utils/
│   ├── core.js          # Shared utilities (formatting, storage, notifications)
│   └── performance.js   # Request management, batching, and caching
└── service-worker.js    # PWA offline support and asset caching
```

---

*Data provided by MLB Stats API, Baseball Savant, and Fangraphs.*
