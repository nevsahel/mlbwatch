# MLB Watchability Index

A live, data-driven dashboard for Major League Baseball that uses a custom **Watchability Index** to identify the most compelling action in real-time. Whether it's a tight divisional rivalry, a late-inning comeback, or a star pitcher on the mound, this tool ensures you never miss a high-stakes moment.

## 🚀 Key Features

- **🔥 Live Games**: Real-time scores and situation updates, ranked by our custom Watchability Index. Includes win probability sparklines and situational graphics (bases, outs, count).
- **📟 Live Ticker**: A scrolling feed of high-impact plays, lead changes, and major Win Probability Added (WPA) events across the league.
- **🏁 Playoff Races**: Dynamic standings for every division and wild card race, featuring magic numbers, elimination numbers, and Last 10 (L10) form.
- **☄️ Home Run Command Center**: Detailed tracking of every home run hit today, including exit velocity, distance, launch angle, and Savant-powered spray charts.
- **🎯 Milestone Watch**: Real-time tracking of active players approaching significant career and season milestones (hits, HRs, strikeouts, etc.).
- **🏆 Award Race Projections**: Simulated daily projections for MVP, Cy Young, ROTY, and Silver Slugger based on live season data and fWAR.

## 📐 The Watchability Index

The index is a **0–100 score** that blends situational drama, historical context, and a baseline game intensity:

### 1. Situation Component (Max 50 pts)
Measures the immediate drama of the game:
- **Score Closeness**: Tied games and 1-run leads receive the highest priority.
- **Inning Urgency**: Bonuses for late-inning and extra-inning action.
- **Base State**: Points for runners in scoring position and two-out pressure.
- **Special Events**: Significant boosts for active no-hitters or perfect games.

### 2. Context Component (Max 30 pts raw)
Measures the historical and seasonal importance:
- **Star Power**: Daily updated tiers based on Fangraphs fWAR (T1 = Top 20, T2 = Top 50, etc.).
- **Team Quality**: Rewards matchups between high-winning-percentage teams.
- **Playoff Stakes**: Elevated scores for bubble teams and divisional races.
- **Rivalries**: Built-in bonuses for historic rivalry matchups (e.g., NYY vs. BOS).

### 3. Final Calculation
The total score is a weighted blend of a **base intensity score** (e.g., 30 pts for live games), the Situation component, and a scaled version of the Context component, ensuring scores spread across the full 0–100 range.

## 🛠 Technology Stack

- **Frontend**: Vanilla HTML5, CSS3 (with custom animations and SVG field diagrams), and ES6+ JavaScript.
- **Architecture**: Progressive Web App (PWA) with Service Worker for offline support and manifest-based installation.
- **Utilities**: Custom request deduplication, batch fetching, and a persistent caching layer (`utils/performance.js`).
- **Data Sources**:
    - **MLB Stats API**: Real-time scores, standings, and player stats.
    - **Baseball Savant**: Advanced home run metrics and exit velocity data.
    - **Fangraphs**: Live API integration for daily WAR-based star tiers.

## ⚙️ User Settings

- **⭐ Favorites**: Mark your favorite teams to float them to the top of the grid, ignore spoiler masking, and receive browser notifications for score updates and "heating up" alerts.
- **🙈 Spoiler Mode**: Select specific teams to hide their scores and details, allowing you to watch the game later without knowing the outcome.

## 📁 Project Structure

- `index.html`: Main application entry point and layout.
- `app.js`: Core logic for data orchestration, scoring, and rendering.
- `styles.css`: Comprehensive design system and responsive layouts.
- `utils/performance.js`: Request management and performance monitoring.
- `service-worker.js`: PWA caching and offline reliability.
- `manifest.webmanifest`: App configuration for mobile and desktop install.

---

*Data provided by MLB Stats API, Baseball Savant, and Fangraphs.*
