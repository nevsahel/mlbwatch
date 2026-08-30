# MLB Prediction/Analytics Model Integration

## Findings

1. **Where the MLB model is implemented**
   The MLB prediction/analytics model is implemented in `app.js`. Specifically, the primary modeling functions are `scoreMVPHitter`, `scoreMVPPitcher`, `mvpScore`, `scoreCY`, `rankAward`, and `simulateVotes`. These functions are part of the `fetchAwardRaces` flow.

2. **What inputs the model requires**
   The model requires the following inputs:
   - For hitters: fWAR, On-Base Plus Slugging (OPS), Home Runs (HR), Runs Batted In (RBI), Runs (R), and Batting Average (AVG).
   - For pitchers: fWAR, Wins (W), Earned Run Average (ERA), Strikeouts (SO), Walks and Hits Per Inning Pitched (WHIP), Innings Pitched (IP), and Shutouts (SHO).
   - The model expects these stats to be provided in an array of player objects containing a `stats` property, as well as `war`, `name`, `id`, `isPitcher`, and `isTwoWay` fields.

3. **What outputs the model produces**
   The model produces ranked lists of candidates for MLB awards, primarily MVP (AL and NL) and Cy Young (AL and NL). The outputs include the candidate's name, their stats, their fWAR, and their simulated vote totals.

4. **What format those inputs and outputs use**
   - Inputs are arrays of JavaScript objects representing players, merged from various API responses (MLB Stats API and Fangraphs).
   - Outputs are arrays of sorted candidate objects, enriched with a `score` and a `voteTotal`. These outputs are ultimately formatted into HTML strings to be displayed in the UI (e.g., using `fmtMVP` or `fmtCY`).

5. **Whether the model currently operates on historical, pregame, or live data**
   The model currently operates on historical/season-to-date data. It pulls data from Fangraphs and the MLB Stats API based on date ranges (`startDate=${season}-01-01&endDate=${date}`).

6. **What data would be required to run the model during a live MLB game**
   To run the model during a live MLB game, it would require real-time box score updates for players involved in the live games. This means getting live updates for hits, runs, walks, strikeouts, innings pitched, etc., and calculating the updated rate stats (OPS, ERA, WHIP) and cumulative stats (HR, RBI, W) dynamically.

7. **Any dependencies the model has**
   The model depends on:
   - MLB Stats API (`stats=byDateRange`) for traditional stats.
   - Fangraphs data (via `fetchFangraphsWAR`) for WAR calculations.
   - The `simulateVotes` function, which relies on a pre-defined set of 5 "voter profiles" with specific weights.

8. **Any assumptions the model makes about data**
   - The model assumes the availability of Fangraphs WAR.
   - The weights for the models are "calibrated to historical means" (e.g., .993 OPS, 34 HR for MVP hitters, and 2.46 ERA for Cy Young pitchers).
   - It assumes that `inningsPitched` can be parsed as a float.
   - It includes hardcoded manual adjustments for specific players (e.g., Yordan Alvarez, Cam Schlittler, Jacob Misiorowski).
   - Cy Young candidates are filtered by a `qualifiedIP` threshold (1.0 IP per team game played).

9. **Whether the model can currently process individual live game states**
   No, the model currently cannot process individual live game states. It expects aggregated, season-level statistics. It does not have logic to process a single play or a single game's box score to incrementally update award probabilities.

10. **What changes, if any, would be necessary to connect the model to a live data pipeline**
    To connect the model to a live data pipeline:
    - **Live Stat Aggregation:** A layer needs to be built that takes the season-to-date stats (from the current APIs) and merges them with live box score data from ongoing games (`liveData.boxscore`).
    - **Dynamic Calculation:** Rate stats (AVG, OBP, SLG, OPS, ERA, WHIP) would need to be recalculated dynamically combining the season totals and live game totals.
    - **Live WAR Updates:** WAR is notoriously difficult to calculate live, so an approximation or delta based on live events (or WPA) might be needed, or the model would need to fall back to the most recent daily WAR figure.
    - **Triggering Re-renders:** The UI would need to hook into the live feed WebSocket or polling mechanism (e.g., `updateGameFeed`) to trigger re-evaluations of the award races when a top candidate's stats change during a game.

## Recommendations

To connect the existing model to the live sports-data architecture while preserving the model itself:

1.  **Introduce a `LiveStatMerger` Module:** Create a utility that listens to live game updates. When a top candidate does something in a live game (e.g., hits a home run), this module should take their cached season-to-date stats object and create a new, temporary stats object with the live stats added on.
2.  **Abstract Data Injection:** Refactor `fetchAwardRaces` to accept a list of player stats objects rather than tightly coupling it to the `fetch` calls. This allows us to pass in the "merged" live stats to the existing `rankAward`, `mvpScore`, and `scoreCY` functions without changing their internal math.
3.  **Live Updates to the UI:** Add a listener in the live game polling loop. If a player currently in the top 10 for an award race is playing, re-run the ranking functions with their merged live stats and selectively re-render the award block in the UI.
4.  **Handle WAR Stale Data:** Accept that Fangraphs WAR will only update periodically. The model can use the last known WAR value while allowing the live traditional stats to fluctuate and influence the final score during a game.
