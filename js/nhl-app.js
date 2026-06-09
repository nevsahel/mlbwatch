/*    Uses the public NHL API (api-web.nhle.com)
   ─────────────────────────────────────────────────────────────────────────── */

const favoriteTeams = new Set(loadPrefs().favoriteTeams || []);
const spoilerTeams = new Set(loadPrefs().spoilerTeams || []);
const revealedGames = new Set();
let lastGames = null;
let teamRecords = {}; // abbrev -> { points, pct, divisionRank, leagueRank }
let activeGamePk = null;
let lastAlertedPk = null;
let polling = false;
let pollTimer = null;
let pollCount = 0;
let lastAuxRefresh = 0;
let isFirstLoad = true;
let nhlStarPlayers = new Set();
let nhlStarTeams = new Set();

// ─── TEAM DATA HELPERS ────────────────────────────────────────────────────────

function teamLogo(abbr) {
  const t = NHL_TEAM_DATA[abbr];
  if (!t) return '';
  return `<img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg" alt="${abbr} logo" onerror="this.style.display='none'">`;
}

function teamColor(abbr) {
  return NHL_TEAM_DATA[abbr]?.color || 'var(--text-dim)';
}

function isRivalry(a, b) {
  return NHL_RIVALRY_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

// ─── TABS ────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  renderWithErrorBoundary(() => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const targetTab = document.getElementById('tab-' + tab);
    if (targetTab) targetTab.classList.add('active');
    const targetBtn = document.querySelector(`.tab-btn[onclick*="'${tab}'"]`);
    if (targetBtn) {
      targetBtn.classList.add('active');
      targetBtn.setAttribute('aria-selected', 'true');
    }

    if (lastGames) {
      if (tab === 'standings') fetchNHLStandings();
      if (tab === 'leaders') fetchNHLLeaders();
      if (tab === 'milestones') fetchNHLMilestones();
    }
  }, 'tab-' + tab, 'Tab failed to load');
}

// ─── DATA FETCHING ───────────────────────────────────────────────────────────

async function fetchNHLScoreboard() {
  const date = selectedDate || todayET();
  try {
    const url = date === todayET()
      ? `${NHL_API}/scoreboard/now`
      : `${NHL_API}/scoreboard/${date}`;

    const data = await requestPool.fetchDedup(url, { ttl: 20000 });

    let games = data.games;
    let actualDate = date;

    // The NHL API structure might have changed: games might be in gamesByDate
    if ((!games || games.length === 0) && data.gamesByDate) {
      // If we're looking for a specific date, try to find it in gamesByDate
      const dateEntry = data.gamesByDate.find(d => d.date === actualDate);
      if (dateEntry && dateEntry.games && dateEntry.games.length > 0) {
        games = dateEntry.games;
      } else if (date === todayET()) {
        // Fallback logic: if no games today, find the most recent date with games
        const sortedDates = data.gamesByDate
          .filter(d => d.games && d.games.length > 0)
          .sort((a, b) => b.date.localeCompare(a.date));

        if (sortedDates.length > 0) {
          games = sortedDates[0].games;
          actualDate = sortedDates[0].date;
          console.log(`[NHL] No games today, falling back to ${actualDate}`);

          // Update the UI date picker if it matches today
          const dateInput = document.getElementById('game-date');
          if (dateInput && dateInput.value === todayET()) {
            dateInput.value = actualDate;
            selectedDate = actualDate;
          }
        }
      }
    }

    if (!games || games.length === 0) return [];

    return games.map(g => {
      const isFinal = g.gameState === 'OFF' || g.gameState === 'FINAL';
      const isLive = g.gameState === 'LIVE' || g.gameState === 'CRIT';
      const isPreview = g.gameState === 'FUT' || g.gameState === 'PRE';

      let periodStatus = '';
      if (isFinal) {
        periodStatus = g.periodDescriptor?.periodType === 'OT' ? 'FINAL/OT' :
                      g.periodDescriptor?.periodType === 'SO' ? 'FINAL/SO' : 'FINAL';
      } else if (isLive) {
        periodStatus = `P${g.periodDescriptor?.number} - ${g.clock?.timeRemaining || 'Live'}`;
      } else {
        periodStatus = formatGameTime(g.startTimeUTC);
      }

      const obj = {
        gamePk: g.id,
        awayTeam: g.awayTeam.abbrev,
        homeTeam: g.homeTeam.abbrev,
        awayScore: g.awayTeam.score ?? 0,
        homeScore: g.homeTeam.score ?? 0,
        gameState: g.gameState,
        period: g.periodDescriptor?.number || 0,
        periodType: g.periodDescriptor?.periodType || 'REG',
        timeRemaining: g.clock?.timeRemaining || '',
        inIntermission: g.clock?.inIntermission || false,
        periodStatus,
        startTime: new Date(g.startTimeUTC).getTime(),
        isPowerPlay: g.situationCode ? g.situationCode !== '1551' : false,
        homeGoaliePulled: false,
        awayGoaliePulled: false
      };

      obj.watchabilityBreakdown = calculateNHLWatchability(obj);
      obj.watchabilityIndex = obj.watchabilityBreakdown.score;
      return obj;
    });
  } catch (e) {
    console.error('NHL Scoreboard fetch failed:', e);
    return [];
  }
}

async function fetchNHLStarPower() {
  try {
    const [skaters, goalies] = await Promise.all([
      requestPool.fetchDedup(`${NHL_API}/skater-stats-leaders/current`, { ttl: 3600000 }),
      requestPool.fetchDedup(`${NHL_API}/goalie-stats-leaders/current`, { ttl: 3600000 })
    ]);

    const stars = new Set();
    const teams = new Set();
    const addStarsFromList = (list) => {
      if (!list || !Array.isArray(list)) return;
      list.slice(0, 10).forEach(p => {
        const last = p.lastName?.default || p.lastName;
        if (last) stars.add(last);
        const team = p.teamAbbrev?.default || p.teamAbbrev;
        if (team) teams.add(team);
      });
    };

    addStarsFromList(skaters.points);
    addStarsFromList(skaters.goals);
    addStarsFromList(skaters.assists);
    addStarsFromList(goalies.savePctg);
    addStarsFromList(goalies.wins);

    nhlStarPlayers = stars;
    nhlStarTeams = teams;
    console.log(`[NHL StarPower] Loaded ${stars.size} star players across ${teams.size} teams`);
  } catch (e) {
    console.warn('NHL Star Power fetch failed:', e);
  }
}

async function fetchNHLLeaders() {
  const container = document.getElementById('leaders-container');
  if (!container) return;
  container.innerHTML = '<div class="empty-msg">Loading leaders...</div>';

  try {
    const [skaters, goalies] = await Promise.all([
      requestPool.fetchDedup(`${NHL_API}/skater-stats-leaders/current`, { ttl: 3600000 }).catch(() => ({})),
      requestPool.fetchDedup(`${NHL_API}/goalie-stats-leaders/current`, { ttl: 3600000 }).catch(() => ({}))
    ]);

    let html = '<div class="leaders-grid">';

    const renderLeaderBox = (title, list, unit) => {
      if (!list || !Array.isArray(list) || list.length === 0) return '';
      let box = `<div class="leader-box"><h3>${title}</h3>`;
      list.slice(0, 5).forEach((p, i) => {
        const first = p.firstName?.default || p.firstName || '';
        const last = p.lastName?.default || p.lastName || 'Unknown';
        const team = p.teamAbbrev?.default || p.teamAbbrev || '???';
        box += `
          <div class="leader-row ${i === 0 ? 'top' : ''}">
            <span class="rank">${i + 1}</span>
            <span class="name">${escapeHTML(first)} ${escapeHTML(last)} <small>${escapeHTML(team)}</small></span>
            <span class="value">${p.value ?? ''}${unit || ''}</span>
          </div>`;
      });
      box += '</div>';
      return box;
    };

    const hasData = skaters.points || skaters.goals || goalies.savePctg || goalies.wins;
    if (!hasData) {
      container.innerHTML = '<div class="empty-msg">No leader data available at the moment.</div>';
      return;
    }

    html += renderLeaderBox('Points', skaters.points);
    html += renderLeaderBox('Goals', skaters.goals);
    html += renderLeaderBox('Assists', skaters.assists);
    html += renderLeaderBox('Save %', goalies.savePctg);
    html += renderLeaderBox('GAA', goalies.goalsAgainstAverage);
    html += renderLeaderBox('Wins', goalies.wins);

    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    console.error('[NHL Leaders]', e);
    container.innerHTML = '<div class="empty-msg">Failed to load leaders</div>';
  }
}

async function fetchNHLMilestones() {
  const container = document.getElementById('milestones-container');
  if (!container) return;
  container.innerHTML = '<div class="empty-msg">Loading milestones...</div>';

  try {
    // Curated milestones for NHL
    const staticMilestones = [
      { name: "Alex Ovechkin", team: "WSH", stat: "Goals", current: "894", next: "895", desc: "Pursuit of Gretzky's All-Time Record (894)" },
      { name: "Sidney Crosby", team: "PIT", stat: "Points", current: "1596", next: "1600", desc: "Approaching 1600 Career Points" },
      { name: "Connor McDavid", team: "EDM", stat: "Points", current: "982", next: "1000", desc: "Race to 1000 Career Points" },
      { name: "Marc-Andre Fleury", team: "MIN", stat: "Wins", current: "561", next: "570", desc: "Climbing All-Time Wins List" }
    ];

    // In a real app, we might fetch these from an API or calculate them.
    // Here we'll just render the curated list for impact.

    let html = '<div class="milestone-board rich">';
    staticMilestones.forEach(m => {
      const progress = Math.min(99, Math.round((parseFloat(m.current) / parseFloat(m.next)) * 100));
      html += `
        <article class="milestone-card rich">
          <div class="milestone-topline">
            <span class="milestone-importance major">HISTORIC CHASE</span>
          </div>
          <div class="milestone-player">${teamLogo(m.team)} ${m.name}</div>
          <div class="milestone-team">${m.team} · ${m.stat}</div>
          <div class="milestone-chase">${m.desc}</div>
          <div class="milestone-target">
            <strong>${m.current}</strong>
            <span>/ ${m.next}</span>
          </div>
          <div class="milestone-progress"><div style="width:${progress}%"></div></div>
          <div class="milestone-card-footer">
            <span>${parseFloat(m.next) - parseFloat(m.current)} away</span>
          </div>
        </article>`;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="empty-msg">Failed to load milestones</div>';
  }
}

async function fetchNHLStandings() {
  const container = document.getElementById('standings-container');
  if (container && isFirstLoad) container.innerHTML = '<div class="empty-msg">Loading standings...</div>';

  try {
    const data = await requestPool.fetchDedup(`${NHL_API}/standings/now`, { ttl: 300000 });
    if (!data || !data.standings) {
      if (container) container.innerHTML = '<div class="empty-msg">Standings data currently unavailable.</div>';
      return;
    }

    const records = {};
    data.standings.forEach(t => {
      const abbr = typeof t.teamAbbrev === 'object' ? t.teamAbbrev.default : t.teamAbbrev;
      if (!abbr) return;
      records[abbr] = {
        wins: t.wins,
        losses: t.losses,
        otLosses: t.otLosses,
        points: t.points,
        pointPct: t.pointPctg,
        divisionRank: t.divisionSequence,
        leagueRank: t.leagueSequence,
        streakCode: t.streakCode,
        streakCount: t.streakCount,
        l10Wins: t.l10Wins,
        l10Losses: t.l10Losses,
        l10OtLosses: t.l10OtLosses,
        clinchIndicator: t.clinchIndicator
      };
    });

    teamRecords = records;
    if (container) renderNHLStandings(data.standings);
  } catch (e) {
    console.error('NHL Standings fetch failed:', e);
    if (container) container.innerHTML = '<div class="empty-msg">Failed to load standings</div>';
  }
}

// ─── WATCHABILITY INDEX ──────────────────────────────────────────────────────

function calculateNHLWatchability(g) {
  const cfg = NHL_WATCHABILITY_CONFIG;
  const isFinal = g.gameState === 'OFF' || g.gameState === 'FINAL';
  const isPreview = g.gameState === 'FUT' || g.gameState === 'PRE';

  const rival = isRivalry(g.awayTeam, g.homeTeam);
  const teamQA = teamRecords[g.awayTeam]?.pointPct || 0.5;
  const teamQH = teamRecords[g.homeTeam]?.pointPct || 0.5;
  const teamQ = Math.min(Math.round(((teamQA + teamQH) / 2) * 20), cfg.caps.teamQuality);

  const playoffScore = Math.min(
    (teamRecords[g.awayTeam]?.leagueRank <= 20 ? 8 : 0) +
    (teamRecords[g.homeTeam]?.leagueRank <= 20 ? 7 : 0),
    cfg.caps.playoff
  );

  const rivalBonus = rival ? cfg.context.rivalry : 0;

  // Star power detection
  let starBonus = 0;
  if (nhlStarTeams.has(g.awayTeam)) starBonus += 5;
  if (nhlStarTeams.has(g.homeTeam)) starBonus += 5;

  // Marquee matchup bonus
  if (teamQA > 0.6 && teamQH > 0.6) starBonus += 5;

  let upsetBonus = 0;
  if (!isPreview) {
    const diff = teamQA - teamQH;
    if (diff > 0.15 && g.homeScore > g.awayScore) upsetBonus = cfg.context.upset;
    if (diff < -0.15 && g.awayScore > g.homeScore) upsetBonus = cfg.context.upset;
  }

  const context = Math.min(teamQ + playoffScore + rivalBonus + upsetBonus + starBonus, cfg.caps.context);
  const parts = [
    { label: 'Teams', value: teamQ },
    { label: 'Playoff', value: playoffScore },
    { label: 'Rivalry', value: rivalBonus },
    { label: 'Stars', value: starBonus },
    { label: 'Upset', value: upsetBonus }
  ].filter(p => p.value);

  if (isPreview) {
    const raw = cfg.bases.preview + Math.round(context * cfg.scaling.previewContext);
    return { score: clamp(raw), situation: 0, context, parts };
  }

  const scoreDiff = Math.abs(g.awayScore - g.homeScore);
  let sit = 0;

  if (isFinal) {
    if (scoreDiff === 0) sit += cfg.final.diff.tied;
    else if (scoreDiff === 1) sit += cfg.final.diff.oneGoal;
    else if (scoreDiff === 2) sit += cfg.final.diff.twoGoal;
    if (g.periodType !== 'REG') sit += cfg.final.overtime;

    sit = Math.min(sit, cfg.caps.finalSituation);
    const raw = cfg.bases.final + sit + Math.round(context * cfg.scaling.finalContext);
    return { score: clamp(raw), situation: sit, context, parts: [{ label: 'Drama', value: sit }, ...parts] };
  }

  if (scoreDiff === 0) sit += cfg.live.diff.tied;
  else if (scoreDiff === 1) sit += cfg.live.diff.oneGoal;
  else if (scoreDiff === 2) sit += cfg.live.diff.twoGoal;
  else if (scoreDiff === 3) sit += cfg.live.diff.threeGoal;
  else sit += cfg.live.diff.fourPlus;

  if (g.periodType !== 'REG') sit += cfg.live.period.overtime;
  else if (g.period === 3) {
    sit += cfg.live.period.third;
    if (g.timeRemaining && parseInt(g.timeRemaining.split(':')[0]) < 5) {
      sit += cfg.live.period.lateThird;
    }
  }

  if (g.isPowerPlay) sit += cfg.live.strength.powerPlay;
  if (g.homeGoaliePulled || g.awayGoaliePulled) sit += cfg.live.strength.emptyNet;

  sit = Math.min(sit, cfg.caps.liveSituation);
  const raw = cfg.bases.live + sit + Math.round(context * cfg.scaling.liveContext);
  return { score: clamp(raw), situation: sit, context, parts: [{ label: 'Situation', value: sit }, ...parts] };
}

function clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

// ─── UI RENDERING ────────────────────────────────────────────────────────────

function renderGames(games) {
  const grid = document.getElementById('games-grid');
  const filtered = applySortFilter(games);

  const countEl = document.getElementById('games-count');
  if (countEl) {
    countEl.textContent = `${filtered.length} game${filtered.length !== 1 ? 's' : ''}`;
  }

  // BOLT OPTIMIZATION: DOM Reconciliation
  // Reuses existing card elements to avoid full grid teardown/rebuild
  const existingCards = new Map();
  grid.querySelectorAll('.game-card').forEach(el => {
    const pk = el.getAttribute('data-gpk');
    if (pk) existingCards.set(pk, el);
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-msg">No games matching criteria</div>';
    return;
  }

  // Ensure "No games" message or other non-card content is removed before rendering cards
  const emptyMsg = grid.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  const fragment = document.createDocumentFragment();
  const seenPks = new Set();

  filtered.forEach(game => {
    const pkStr = String(game.gamePk);
    seenPks.add(pkStr);
    let card = existingCards.get(pkStr);
    const wi = game.watchabilityIndex;
    const targetClass = `game-card${wi > 75 ? ' fire' : wi > 55 ? ' hot' : ''}`;

    if (!card) {
      card = document.createElement('div');
      card.setAttribute('data-gpk', pkStr);
      // Ensure card acts as a button for accessibility
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('click', () => openGameDrawer(game.gamePk));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openGameDrawer(game.gamePk);
        }
      });
    }
    card.className = targetClass;

    const isSpoilered = (spoilerTeams.has(game.awayTeam) || spoilerTeams.has(game.homeTeam)) && !revealedGames.has(game.gamePk);

    if (isSpoilered) {
       const spoilerHtml = `
        <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
        <div class="inning-line" style="color:var(--text-dim)">Spoiler Mode</div>
        <div class="spoiler-mask" onclick="revealSpoiler(this, ${game.gamePk})">🙈 Tap to reveal</div>
      `;
      if (card.innerHTML !== spoilerHtml) {
        card.innerHTML = spoilerHtml;
        // Invalidate state key so revealing always forces a re-render of details
        card._lastStateKey = null;
      }
    } else {
      renderSingleGameCard(card, game);
    }

    const homeColor = teamColor(game.homeTeam);
    card.style.borderLeft = `6px solid ${homeColor}`;
    card.style.backgroundImage = `linear-gradient(to right, ${homeColor}11, transparent)`;

    fragment.appendChild(card);
  });

  // Remove any cards that are no longer in the filtered list
  existingCards.forEach((card, pk) => {
    if (!seenPks.has(pk)) card.remove();
  });

  // Appending the fragment efficiently reorders existing nodes and adds new ones
  grid.appendChild(fragment);
}

function renderSituationGraphic(game) {
  if (game.gameState === 'FUT' || game.gameState === 'PRE' || game.gameState === 'OFF' || game.gameState === 'FINAL') return '';

  return `
    <div class="situation-graphic nhl">
      <div class="nhl-strength">
        <span class="strength-label">Strength</span>
        <div class="strength-indicator ${game.isPowerPlay ? 'active' : ''}">${game.isPowerPlay ? 'POWER PLAY' : 'EVEN'}</div>
      </div>
      <div class="nhl-goalie-status">
        <div class="goalie-dot ${game.awayGoaliePulled ? 'pulled' : 'active'}" title="${game.awayTeam} Goalie"></div>
        <div class="goalie-label">G</div>
        <div class="goalie-dot ${game.homeGoaliePulled ? 'pulled' : 'active'}" title="${game.homeTeam} Goalie"></div>
      </div>
    </div>
  `;
}

function renderSingleGameCard(card, game) {
  const wi = game.watchabilityIndex;
  const isFinal = game.gameState === 'OFF' || game.gameState === 'FINAL';

  // BOLT OPTIMIZATION: State-based change detection
  // Only update innerHTML if the core game state has changed
  const stateKey = `${game.awayScore}-${game.homeScore}-${game.periodStatus}-${game.isPowerPlay}-${game.homeGoaliePulled}-${game.awayGoaliePulled}-${wi}`;
  if (card._lastStateKey === stateKey) return;
  card._lastStateKey = stateKey;

  let badgeHtml = '';
  if (isRivalry(game.awayTeam, game.homeTeam)) badgeHtml += '<div class="badge rivalry">Rivalry</div>';
  if (game.periodType !== 'REG' && !isFinal) badgeHtml += '<div class="badge perfect">OVERTIME</div>';
  if (game.isPowerPlay) badgeHtml += '<div class="badge followed-badge">POWER PLAY</div>';
  if (game.homeGoaliePulled || game.awayGoaliePulled) badgeHtml += '<div class="badge nohitter">EMPTY NET</div>';

  const scoreLine = `<div class="score-line">${game.awayScore} - ${game.homeScore}</div>`;

  const watchBarHtml = !isFinal ? `
    <div class="watch-bar-wrap">
      <div class="watch-bar-label">
        <span>Watchability</span>
        <span class="score-num">${wi}</span>
      </div>
      <div class="watch-bar-bg">
        <div class="watch-bar-fill" style="width:${wi}%"></div>
      </div>
    </div>` : '';

  card.innerHTML = `
    ${badgeHtml}
    <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
    ${scoreLine}
    <div class="inning-line">${game.periodStatus}</div>
    ${watchBarHtml}
    <div class="score-breakdown">
      ${game.watchabilityBreakdown.parts.map(p => `<span class="score-chip">${p.label} +${p.value}</span>`).join('')}
    </div>
    ${renderSituationGraphic(game)}
    <button class="card-expand-toggle" onclick="event.stopPropagation(); openGameDrawer(${game.gamePk})">Details</button>
  `;
}

function renderNHLStandings(standings) {
  const container = document.getElementById('standings-container');
  if (!container) return;

  // Group by division
  const divisions = {};
  standings.forEach(t => {
    const div = t.divisionName || t.divisionAbbrev;
    if (!divisions[div]) divisions[div] = [];
    divisions[div].push(t);
  });

  let html = '<div class="playoff-races">';

  // Key Games Today (Placeholder for now, could be dynamic)
  const importantGames = (lastGames || []).filter(g => g.watchabilityIndex > 60).slice(0, 3);
  if (importantGames.length > 0) {
    html += `
      <div class="key-games-section">
        <div class="standings-div-title">🔑 Key Games Today</div>
        <div class="race-pulse-grid">
          ${importantGames.map(g => `
            <div class="race-pulse-card">
              <div class="race-pulse-label">Watchability ${g.watchabilityIndex}</div>
              <div class="race-pulse-title">${teamLogo(g.awayTeam)} ${g.awayTeam} @ ${teamLogo(g.homeTeam)} ${g.homeTeam}</div>
              <div class="race-pulse-note">${g.periodStatus}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  Object.keys(divisions).sort().forEach(divName => {
    html += `<div class="standings-division"><div class="standings-div-title">${divName} Division</div>`;
    html += '<table class="standings-table"><thead><tr><th>Team</th><th>W</th><th>L</th><th>OT</th><th>PTS</th><th>P%</th><th>L10</th><th>STRK</th></tr></thead><tbody>';

    // Sort division by points
    divisions[divName].sort((a, b) => b.points - a.points).forEach((t, i) => {
      const abbr = typeof t.teamAbbrev === 'object' ? t.teamAbbrev.default : t.teamAbbrev;
      const isPlayoff = i < 3 || (t.wildcardSequence > 0 && t.wildcardSequence <= 2);
      const clinch = t.clinchIndicator ? `<span class="clinch-tag" title="Clinched ${t.clinchIndicator}">${t.clinchIndicator.toUpperCase()}</span>` : '';

      html += `<tr class="${isPlayoff ? 'playoff' : ''}">
        <td class="team-name">${teamLogo(abbr)} ${abbr} ${clinch}</td>
        <td>${t.wins}</td>
        <td>${t.losses}</td>
        <td>${t.otLosses}</td>
        <td><strong>${t.points}</strong></td>
        <td>${t.pointPctg.toFixed(3)}</td>
        <td>${t.l10Wins}-${t.l10Losses}-${t.l10OtLosses}</td>
        <td>${t.streakCode}${t.streakCount}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

// ─── SETTINGS & SIDEBAR ───────────────────────────────────────────────────────

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
  renderSpoilerGrid();
  renderFavoriteGrid();
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function switchSidebarTab(tab) {
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));
  document.getElementById('sb-' + tab).classList.add('active');
  const targetBtn = document.querySelector(`.sidebar-tab[onclick*="'${tab}'"]`);
  if (targetBtn) targetBtn.classList.add('active');
}

function toggleFavoriteTeam(abbr) {
  if (favoriteTeams.has(abbr)) favoriteTeams.delete(abbr);
  else favoriteTeams.add(abbr);
  savePrefs({ favoriteTeams: [...favoriteTeams] });
  renderFavoriteGrid();
  if (lastGames) renderGames(lastGames);
}

function clearAllFavorites() {
  favoriteTeams.clear();
  savePrefs({ favoriteTeams: [] });
  renderFavoriteGrid();
  if (lastGames) renderGames(lastGames);
}

function toggleSpoilerTeam(abbr) {
  if (spoilerTeams.has(abbr)) spoilerTeams.delete(abbr);
  else spoilerTeams.add(abbr);
  savePrefs({ spoilerTeams: [...spoilerTeams] });
  renderSpoilerGrid();
  if (lastGames) renderGames(lastGames);
}

function clearAllSpoilers() {
  spoilerTeams.clear();
  savePrefs({ spoilerTeams: [] });
  renderSpoilerGrid();
  if (lastGames) renderGames(lastGames);
}

function renderSpoilerGrid() {
  const grid = document.getElementById('spoiler-team-grid');
  if (!grid) return;
  grid.innerHTML = Object.keys(NHL_TEAM_DATA).filter(a => a !== 'ATH').sort().map(abbr => {
    const isSpoiled = spoilerTeams.has(abbr);
    return `<div class="team-toggle${isSpoiled ? ' spoilered' : ''}" onclick="toggleSpoilerTeam('${abbr}')">
      ${teamLogo(abbr)} <span>${abbr}</span>
    </div>`;
  }).join('');
}

function renderFavoriteGrid() {
  const grid = document.getElementById('favorite-team-grid');
  if (!grid) return;
  grid.innerHTML = Object.keys(NHL_TEAM_DATA).filter(a => a !== 'ATH').sort().map(abbr => {
    const isFav = favoriteTeams.has(abbr);
    return `<div class="team-toggle${isFav ? ' favorite' : ''}" onclick="toggleFavoriteTeam('${abbr}')">
      ${teamLogo(abbr)} <span>${abbr}</span>
    </div>`;
  }).join('');
}

// ─── APP CONTROL ─────────────────────────────────────────────────────────────

async function pollGames() {
  pollCount++;
  try {
    const games = await fetchNHLScoreboard();
    lastGames = games;
    renderGames(games);

    if (isFirstLoad) {
      await Promise.all([
        fetchNHLStarPower(),
        fetchNHLStandings()
      ]);
      isFirstLoad = false;
    }

    if (pollCount % 10 === 0) fetchNHLStandings();

    document.getElementById('last-update').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error('Poll error:', e);
  } finally {
    if (polling) pollTimer = setTimeout(pollGames, 15000);
  }
}

function startPolling() {
  polling = true;
  document.getElementById('start-btn').disabled = true;
  document.getElementById('stop-btn').disabled = false;
  document.getElementById('status-dot').classList.add('live');
  pollGames();
}

function stopPolling() {
  polling = false;
  clearTimeout(pollTimer);
  document.getElementById('start-btn').disabled = false;
  document.getElementById('stop-btn').disabled = true;
  document.getElementById('status-dot').classList.remove('live');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

let selectedDate = todayET();
function setGameDate(d) {
  selectedDate = d;
  isFirstLoad = true;
  if (polling) pollGames();
}

let currentSort = 'watchability';
function setSort(s) {
  currentSort = s;
  if (lastGames) renderGames(lastGames);
}

let currentFilter = null;
function setFilter(f) {
  currentFilter = currentFilter === f ? null : f;
  if (lastGames) renderGames(lastGames);
}

function applySortFilter(games) {
  let g = [...games];
  if (currentFilter === 'hot') g = g.filter(x => x.watchabilityIndex >= 60);
  if (currentFilter === 'fire') g = g.filter(x => x.watchabilityIndex >= 75);
  if (currentFilter === 'live') g = g.filter(x => x.gameState === 'LIVE');

  g.sort((a, b) => {
    if (currentSort === 'watchability') return b.watchabilityIndex - a.watchabilityIndex;
    if (currentSort === 'score') return Math.abs(a.awayScore - a.homeScore) - Math.abs(b.awayScore - b.homeScore);
    return b.period - a.period;
  });
  return g;
}

function formatGameTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ET';
}

function revealSpoiler(el, pk) {
  revealedGames.add(pk);
  if (lastGames) renderGames(lastGames);
}

async function openGameDrawer(pk) {
  const drawer = document.getElementById('game-drawer');
  const title = document.getElementById('drawer-title');
  const body = document.getElementById('drawer-body');
  const game = lastGames?.find(g => g.gamePk === pk);

  if (!game) return;

  title.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
  body.innerHTML = '<div class="expand-load-msg">Loading game summary...</div>';
  drawer.classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');

  try {
    const data = await requestPool.fetchDedup(`${NHL_API}/gamecenter/${pk}/landing`, { ttl: 15000 });

    let html = '';

    // 1. Linescore
    if (data.linescore) {
      html += '<div class="expand-section-label">Linescore</div>';
      html += '<div class="expand-box nhl-box">';
      const maxPeriod = data.linescore.totals?.away > 0 || data.linescore.totals?.home > 0 ? (data.periodDescriptor?.number || 3) : 3;
      const periods = Array.from({length: Math.max(3, maxPeriod)}, (_, i) => i + 1);

      const cols = `grid-template-columns: 3.5rem repeat(${periods.length}, 1fr) 2rem`;
      html += `<div class="expand-box-row header" style="${cols}"><span>Team</span>`;
      periods.forEach(p => html += `<span>${p}</span>`);
      html += '<span>T</span></div>';

      [data.awayTeam, data.homeTeam].forEach(team => {
        const abbr = team.abbrev;
        const score = data.linescore.byPeriod?.filter(p => periods.includes(p.period)) || [];
        const total = team.score ?? 0;

        html += `<div class="expand-box-row" style="${cols}">`;
        html += `<span class="team">${teamLogo(abbr)} ${abbr}</span>`;
        periods.forEach(pNum => {
          const pScore = data.linescore.byPeriod?.find(bp => bp.periodDescriptor.number === pNum);
          const s = pScore ? (team === data.awayTeam ? pScore.away : pScore.home) : '0';
          html += `<span>${s}</span>`;
        });
        html += `<span class="total">${total}</span></div>`;
      });
      html += '</div>';
    }

    // 2. Scoring Summary
    if (data.summary?.scoring) {
      html += '<div class="expand-section-label">Scoring Summary</div>';
      html += '<div class="expand-plays">';
      data.summary.scoring.forEach(period => {
        period.goals.forEach(goal => {
          const assistText = goal.assists?.length
            ? `(Assists: ${goal.assists.map(a => a.name.default).join(', ')})`
            : '(Unassisted)';
          html += `
            <div class="expand-play">
              <span class="expand-play-inn">P${period.periodDescriptor.number} ${goal.timeInPeriod}</span>
              <span class="expand-play-desc">
                <strong>${goal.name.default} (${goal.goalsToDate})</strong> ${goal.strength !== 'ev' ? `[${goal.strength.toUpperCase()}]` : ''}
                <small>${assistText}</small>
                <span class="expand-play-score">${data.awayTeam.abbrev} ${goal.awayScore} · ${data.homeTeam.abbrev} ${goal.homeScore}</span>
              </span>
            </div>`;
        });
      });
      html += '</div>';
    }

    // 3. Penalty Summary
    if (data.summary?.penalties && data.summary.penalties.length > 0) {
      html += '<div class="expand-section-label">Penalties</div>';
      html += '<div class="expand-plays">';
      data.summary.penalties.forEach(period => {
        period.penalties.forEach(pen => {
          html += `
            <div class="expand-play penalty">
              <span class="expand-play-inn">P${period.periodDescriptor.number} ${pen.timeInPeriod}</span>
              <span class="expand-play-desc">
                ${pen.teamAbbrev.default}: ${pen.committedByPlayer?.lastName.default || 'Team'} - ${pen.desc} (${pen.duration} min)
              </span>
            </div>`;
        });
      });
      html += '</div>';
    }

    body.innerHTML = html || '<div class="empty-msg">No summary data available for this game yet.</div>';
  } catch(e) {
    console.error('Drawer load error:', e);
    body.innerHTML = '<div class="empty-msg">Failed to load game summary</div>';
  }
}

function closeGameDrawer() {
  document.getElementById('game-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}
// Ensure all functions are available globally for onclick handlers
window.switchTab = switchTab;
window.startPolling = startPolling;
window.stopPolling = stopPolling;
window.setGameDate = setGameDate;
window.setSort = setSort;
window.setFilter = setFilter;
window.openGameDrawer = openGameDrawer;
window.closeGameDrawer = closeGameDrawer;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.switchSidebarTab = switchSidebarTab;
window.toggleFavoriteTeam = toggleFavoriteTeam;
window.clearAllFavorites = clearAllFavorites;
window.toggleSpoilerTeam = toggleSpoilerTeam;
window.clearAllSpoilers = clearAllSpoilers;
window.revealSpoiler = revealSpoiler;
