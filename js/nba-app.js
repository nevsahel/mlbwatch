/*    Uses the ESPN NBA API
   ─────────────────────────────────────────────────────────────────────────── */

const favoriteTeams = new Set(loadPrefs().favoriteTeamsNBA || []);
const spoilerTeams = new Set(loadPrefs().spoilerTeamsNBA || []);
const revealedGames = new Set();
let activeGamePk = null;
let lastGames = null;
let teamRecords = {};
let polling = false;
let pollTimer = null;
let pollCount = 0;
let isFirstLoad = true;
let selectedDate = loadPrefs().selectedDateNBA || todayET();
let nbaStarTeams = new Set();
let liveTeams = new Set();
let todayTeams = new Set();

function getNBASeason(dateStr) {
  const date = new Date(dateStr + 'T12:00:00Z');
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed, 9 = October
  return month >= 9 ? year + 1 : year;
}

function parseStatValue(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  return parseFloat(String(val).replace(/,/g, '')) || 0;
}

// ─── RIVALRY PAIRS ─────────────────────────────────────────────────────────────

// BOLT OPTIMIZATION: Use a Set for O(1) rivalry lookups instead of linear search
const NBA_RIVALRY_SET = new Set(NBA_RIVALRY_PAIRS.map(([x, y]) => x < y ? x + '-' + y : y + '-' + x));

// ─── TEAM DATA HELPERS ────────────────────────────────────────────────────────

function teamLogo(abbr) {
  const safeAbbr = escapeHTML(abbr);
  return `<img class="team-logo" src="https://a.espncdn.com/i/teamlogos/nba/500/${safeAbbr.toLowerCase()}.png" alt="${safeAbbr} logo" onerror="this.style.display='none'">`;
}

function teamColor(abbr) {
  return NBA_TEAM_DATA[abbr]?.color || 'var(--text-dim)';
}

// ─── TABS ────────────────────────────────────────────────────────────────────

let cachedTabBtns;
let cachedTabContents;

function switchTab(tab) {
  if (!cachedTabBtns) cachedTabBtns = Array.from(document.querySelectorAll('.tab-btn'));
  if (!cachedTabContents) cachedTabContents = Array.from(document.querySelectorAll('.tab-content'));

  cachedTabBtns.forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  cachedTabContents.forEach(c => c.classList.remove('active'));
  const targetTab = document.getElementById('tab-' + tab);
  if (targetTab) targetTab.classList.add('active');
  const targetBtn = cachedTabBtns.find(b => b.getAttribute('onclick')?.includes(`'${tab}'`));
  if (targetBtn) {
    targetBtn.classList.add('active');
    targetBtn.setAttribute('aria-selected', 'true');
  }

  if (tab === 'standings') fetchNBAStandings();
  if (tab === 'games') fetchNBALeaders();
  if (tab === 'potd') fetchAndRenderNBAPOTD(lastGames);
  if (tab === 'shots') fetchAndRenderNBAShots(lastGames);
  if (tab === 'awards') fetchNBAAwardRaces();
  if (tab === 'duel') fetchAndRenderNBADuel(lastGames);
  if (tab === 'milestones') {
    const milestones = window.lastNBAMilestones;
    if (milestones) renderMilestoneBoard(milestones);
    else fetchNBAMilestones();
  }
}

// ─── DATA FETCHING ───────────────────────────────────────────────────────────

async function fetchNBAScoreboard() {
    const date = selectedDate || todayET();
    const title = document.getElementById('live-games-title');
    if (title) {
        title.textContent = date === todayET() ? 'Live Games' : `Games (as of ${date})`;
    }

    const dateStr = date.replace(/-/g, '');
    try {
        const url = `${NBA_API}?dates=${dateStr}`;
        const data = await requestPool.fetchDedup(url, { ttl: 15000 });

        if (isFirstLoad && data.events) {
            nbaStarTeams = fetchNBAStarPower(data.events);
            await fetchNBAStandings();
            isFirstLoad = false;
        }

        return processNBAScoreboard(data);
    } catch (e) {
        console.error('NBA Scoreboard fetch failed:', e);
        return [];
    }
}

function processNBAScoreboard(data) {
    if (!data || !data.events) return [];

    liveTeams.clear();
    todayTeams.clear();

    return data.events.map(e => {
      const game = e.competitions[0];
      const away = game.competitors.find(c => c.homeAway === 'away');
      const home = game.competitors.find(c => c.homeAway === 'home');
      const status = e.status.type;

      const tAway = away.team.abbreviation;
      const tHome = home.team.abbreviation;

      todayTeams.add(tAway);
      todayTeams.add(tHome);
      if (status.state === 'in') {
        liveTeams.add(tAway);
        liveTeams.add(tHome);
      }

      const obj = {
        gamePk: e.id,
        awayTeam: tAway,
        homeTeam: tHome,
        awayScore: parseInt(away.score) || 0,
        homeScore: parseInt(home.score) || 0,
        gameState: status.state, // 'pre', 'in', 'post'
        period: e.status.period,
        clock: e.status.displayClock,
        periodStatus: e.status.type.detail,
        startTime: new Date(e.date).getTime(),
        isFinal: status.completed,
        isLive: status.state === 'in',
        isPreview: status.state === 'pre',
        winProbSeries: []
      };

      // Extract records if available to populate teamRecords
      if (away.records && away.records[0]) {
          const parts = away.records[0].summary.split('-');
          const w = parseInt(parts[0]);
          const l = parseInt(parts[1]);
          teamRecords[obj.awayTeam] = { winPct: w / (w + l) || 0, record: away.records[0].summary };
      }
      if (home.records && home.records[0]) {
          const parts = home.records[0].summary.split('-');
          const w = parseInt(parts[0]);
          const l = parseInt(parts[1]);
          teamRecords[obj.homeTeam] = { winPct: w / (w + l) || 0, record: home.records[0].summary };
      }

      obj.watchabilityBreakdown = calculateNBAWatchability(obj);
      obj.watchabilityIndex = obj.watchabilityBreakdown.score;

      return obj;
    });
}

async function fetchNBAStandings() {
    const container = document.getElementById('standings-container');
    const title = document.getElementById('standings-title');
    const date = selectedDate || todayET();
    if (title) {
        title.textContent = date === todayET() ? 'Standings' : `Standings (as of ${date})`;
    }

    if (container && (isFirstLoad || container.querySelector('.empty-msg'))) {
        container.innerHTML = '<div class="empty-msg">Loading standings...</div>';
    }

    try {
        const season = getNBASeason(date);
        const dateParam = date.replace(/-/g, '');
        const url = `${NBA_STANDINGS_API}?season=${season}&date=${dateParam}`;
        const data = await requestPool.fetchDedup(url, { ttl: 600000 });
        if (!data || !data.children) {
            if (container) container.innerHTML = '<div class="empty-msg">Standings data currently unavailable.</div>';
            return;
        }

        const records = {};
        data.children.forEach(conf => {
            conf.standings.entries.forEach(entry => {
                const abbr = entry.team.abbreviation;
                const stats = entry.stats;
        const statMap = new Map(stats.map(s => [s.type, s]));
        const winPct = statMap.get('winpercent')?.value || 0;
        const record = statMap.get('total')?.summary || '0-0';

                records[abbr] = { winPct, record };
            });
        });

        teamRecords = { ...teamRecords, ...records };
        if (container) renderNBAStandings(data.children);
    } catch (e) {
        console.error('NBA Standings fetch failed:', e);
        if (container) container.innerHTML = '<div class="empty-msg">Failed to load standings</div>';
    }
}

function renderNBAStandings(conferences) {
    const container = document.getElementById('standings-container');
    if (!container) return;

    let html = '<div class="playoff-races">';

    conferences.forEach(conf => {
        html += `<div class="standings-division"><div class="standings-div-title">${conf.name}</div>`;
        html += '<table class="standings-table"><thead><tr><th>Seed</th><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>STRK</th><th>L10</th></tr></thead><tbody>';

        // BOLT: Accurate sorting by PCT, then Wins, then Point Differential
        // BOLT OPTIMIZATION: Use Map for O(1) stat lookup instead of multiple O(N) .find calls
        const sortedEntries = [...conf.standings.entries].map(entry => ({
            ...entry,
            statMap: new Map(entry.stats.map(s => [s.type, s]))
        })).sort((a, b) => {
            const pctA = a.statMap.get('winpercent')?.value || 0;
            const pctB = b.statMap.get('winpercent')?.value || 0;
            if (pctB !== pctA) return pctB - pctA;

            const winsA = a.statMap.get('wins')?.value || 0;
            const winsB = b.statMap.get('wins')?.value || 0;
            if (winsB !== winsA) return winsB - winsA;

            const diffA = a.statMap.get('pointdifferential')?.value || 0;
            const diffB = b.statMap.get('pointdifferential')?.value || 0;
            return diffB - diffA;
        });

        sortedEntries.forEach((entry, idx) => {
            const team = entry.team;
            const statMap = entry.statMap;

            const wins = statMap.get('wins')?.displayValue || '0';
            const losses = statMap.get('losses')?.displayValue || '0';
            const pct = statMap.get('winpercent')?.displayValue || '.000';
            const gb = statMap.get('gamesbehind')?.displayValue || '-';
            const streak = statMap.get('streak')?.displayValue || '-';
            const l10 = statMap.get('lasttengames')?.displayValue || '-';
            const seed = idx + 1;

            const isPlayoff = seed <= 10;
            const clinch = statMap.get('clincher')?.displayValue || '';

            html += `<tr class="${isPlayoff ? 'playoff' : ''}">
                <td style="text-align:center; color:var(--text-dim); font-size:0.85rem;">${seed}</td>
                <td class="team-name">${teamLogo(team.abbreviation)} ${team.abbreviation} ${clinch ? `<span class="clinch-tag">${clinch}</span>` : ''}</td>
                <td>${wins}</td>
                <td>${losses}</td>
                <td>${pct}</td>
                <td>${gb}</td>
                <td>${streak}</td>
                <td>${l10}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

// ─── WATCHABILITY INDEX ──────────────────────────────────────────────────────

function calculateNBAWatchability(g) {
  const cfg = NBA_WATCHABILITY_CONFIG;
  const rival = isRivalry(g.awayTeam, g.homeTeam, NBA_RIVALRY_SET);

  const teamQA = teamRecords[g.awayTeam]?.winPct || 0.5;
  const teamQH = teamRecords[g.homeTeam]?.winPct || 0.5;
  const teamQ = Math.min(Math.round(((teamQA + teamQH) / 2) * 20), cfg.caps.teamQuality);

  const rivalBonus = rival ? cfg.context.rivalry : 0;

  let starBonus = 0;
  if (nbaStarTeams.has(g.awayTeam)) starBonus += 5;
  if (nbaStarTeams.has(g.homeTeam)) starBonus += 5;

  const context = Math.min(teamQ + rivalBonus + starBonus + 10, cfg.caps.context); // +10 base context
  const contextParts = [
    { label: 'Teams', value: teamQ },
    { label: 'Rivalry', value: rivalBonus },
    { label: 'Stars', value: starBonus }
  ].filter(p => p.value > 0);

  if (g.isPreview) {
    const raw = cfg.bases.preview + Math.round(context * cfg.scaling.previewContext);
    return { score: clamp(raw), parts: contextParts };
  }

  const scoreDiff = Math.abs(g.awayScore - g.homeScore);
  let sit = 0;

  if (g.isFinal) {
    if (scoreDiff === 0) sit += cfg.final.diff.tied;
    else if (scoreDiff <= 3) sit += cfg.final.diff.oneToThree;
    else if (scoreDiff <= 6) sit += cfg.final.diff.fourToSix;
    if (g.period > 4) sit += cfg.final.overtime;

    sit = Math.min(sit, cfg.caps.finalSituation);
    const raw = cfg.bases.final + sit + Math.round(context * cfg.scaling.finalContext);
    return { score: clamp(raw), parts: [{ label: 'Drama', value: sit }, { label: 'Context', value: Math.round(context * cfg.scaling.finalContext) }] };
  }

  // Live scoring
  if (scoreDiff === 0) sit += cfg.live.diff.tied;
  else if (scoreDiff <= 3) sit += cfg.live.diff.oneToThree;
  else if (scoreDiff <= 6) sit += cfg.live.diff.fourToSix;
  else if (scoreDiff <= 10) sit += cfg.live.diff.sevenToTen;
  else sit += cfg.live.diff.elevenPlus;

  if (g.period > 4) sit += cfg.live.period.overtime;
  else if (g.period === 4) {
    sit += cfg.live.period.fourth;
    if (g.clock && parseInt(g.clock.split(':')[0]) < 2) {
      sit += cfg.live.period.lateFourth;
    }
  }

  sit = Math.min(sit, cfg.caps.liveSituation);
  const raw = cfg.bases.live + sit + Math.round(context * cfg.scaling.liveContext);
  return { score: clamp(raw), parts: [{ label: 'Situation', value: sit }, { label: 'Context', value: Math.round(context * cfg.scaling.liveContext) }] };
}

function clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

// ─── UI RENDERING ────────────────────────────────────────────────────────────

function renderGames(games) {
  const grid = document.getElementById('games-grid');
  if (!grid) return;

  const filtered = applySortFilter(games);
  const countEl = document.getElementById('games-count');
  if (countEl) countEl.textContent = `${filtered.length} game${filtered.length !== 1 ? 's' : ''}`;

  // BOLT OPTIMIZATION: DOM Reconciliation
  const existingCards = new Map();
  grid.querySelectorAll('.game-card').forEach(el => {
    const pk = el.getAttribute('data-gpk');
    if (pk) existingCards.set(pk, el);
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-msg">No games matching criteria</div>';
    return;
  }

  const emptyMsg = grid.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  const fragment = document.createDocumentFragment();
  const seenPks = new Set();

  filtered.forEach(game => {
    const pkStr = String(game.gamePk);
    seenPks.add(pkStr);
    let card = existingCards.get(pkStr);
    const wi = game.watchabilityIndex;
    const targetClass = `game-card${wi > 75 ? ' fire' : wi > 55 ? ' hot' : ''}${String(activeGamePk) === pkStr ? ' active-side' : ''}`;

    if (!card) {
      card = document.createElement('div');
      card.setAttribute('data-gpk', pkStr);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('click', (event) => {
        if (event.target.closest('button') || event.target.closest('.spoiler-mask')) return;
        openGameDrawer(game.gamePk);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if (event.target.closest('button') || event.target.closest('.spoiler-mask')) return;
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
        <div class="spoiler-mask" role="button" tabindex="0" aria-label="Reveal score" onclick="revealSpoiler(this, '${game.gamePk}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();revealSpoiler(this, '${game.gamePk}')}">🙈 Tap to reveal</div>
      `;
      if (card.innerHTML !== spoilerHtml) {
        card.innerHTML = spoilerHtml;
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

  existingCards.forEach((card, pk) => {
    if (!seenPks.has(pk)) card.remove();
  });

  grid.appendChild(fragment);
}

function renderSingleGameCard(card, game) {
  const wi = game.watchabilityIndex;
  const isSelected = String(activeGamePk) === String(game.gamePk);
  const stateKey = `${game.awayScore}-${game.homeScore}-${game.periodStatus}-${wi}-${isSelected}`;
  if (card._lastStateKey === stateKey) return;
  card._lastStateKey = stateKey;

  card.innerHTML = `
    <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
    <div class="score-line">${game.awayScore} - ${game.homeScore}</div>
    <div class="inning-line">${game.periodStatus}</div>
    ${renderWinProbSparkline(game)}
    <div class="watch-bar-wrap">
      <div class="watch-bar-label">
        <span>Watchability</span>
        <span class="score-num" style="color:${wi > 70 ? 'var(--success)' : 'var(--gold)'}">${wi}</span>
      </div>
      <div class="watch-bar-bg"><div class="watch-bar-fill" style="width:${wi}%;background:${wi > 70 ? 'var(--success)' : 'var(--gold)'}"></div></div>
    </div>
    <div class="score-breakdown">
      ${game.watchabilityBreakdown.parts.map(p => `<span class="score-chip">${p.label} +${p.value}</span>`).join('')}
    </div>
    <button class="card-expand-toggle" onclick="event.stopPropagation(); openGameDrawer('${game.gamePk}')">Details</button>
  `;
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
  document.querySelectorAll('.sidebar-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));
  document.getElementById('sb-' + tab).classList.add('active');
  const targetBtn = document.querySelector(`.sidebar-tab[onclick*="'${tab}'"]`);
  if (targetBtn) {
    targetBtn.classList.add('active');
    targetBtn.setAttribute('aria-selected', 'true');
  }
}

function toggleFavoriteTeam(abbr) {
  if (favoriteTeams.has(abbr)) favoriteTeams.delete(abbr);
  else favoriteTeams.add(abbr);
  savePrefs({ favoriteTeamsNBA: [...favoriteTeams] });
  renderFavoriteGrid();
  if (lastGames) renderGames(lastGames);
}

function clearAllFavorites() {
  favoriteTeams.clear();
  savePrefs({ favoriteTeamsNBA: [] });
  renderFavoriteGrid();
  if (lastGames) renderGames(lastGames);
}

function toggleSpoilerTeam(abbr) {
  if (spoilerTeams.has(abbr)) spoilerTeams.delete(abbr);
  else spoilerTeams.add(abbr);
  savePrefs({ spoilerTeamsNBA: [...spoilerTeams] });
  renderSpoilerGrid();
  if (lastGames) renderGames(lastGames);
}

function clearAllSpoilers() {
  spoilerTeams.clear();
  savePrefs({ spoilerTeamsNBA: [] });
  renderSpoilerGrid();
  if (lastGames) renderGames(lastGames);
}

function renderSpoilerGrid() {
  const grid = document.getElementById('spoiler-team-grid');
  if (!grid) return;
  grid.innerHTML = Object.keys(NBA_TEAM_DATA).sort().map(abbr => {
    const isSpoiled = spoilerTeams.has(abbr);
    return `<div class="team-toggle${isSpoiled ? ' spoilered' : ''}" role="button" tabindex="0" aria-pressed="${isSpoiled}" onclick="toggleSpoilerTeam('${abbr}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSpoilerTeam('${abbr}')}">
      ${teamLogo(abbr)} <span>${abbr}</span>
    </div>`;
  }).join('');
}

function renderFavoriteGrid() {
  const grid = document.getElementById('favorite-team-grid');
  if (!grid) return;
  grid.innerHTML = Object.keys(NBA_TEAM_DATA).sort().map(abbr => {
    const isFav = favoriteTeams.has(abbr);
    return `<div class="team-toggle${isFav ? ' favorite' : ''}" role="button" tabindex="0" aria-pressed="${isFav}" onclick="toggleFavoriteTeam('${abbr}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleFavoriteTeam('${abbr}')}">
      ${teamLogo(abbr)} <span>${abbr}</span>
    </div>`;
  }).join('');
}

// ─── APP CONTROL ─────────────────────────────────────────────────────────────

function fetchNBAStarPower(events) {
  const stars = new Set();
  if (!events) return stars;

  events.forEach(e => {
    const comp = e.competitions[0];
    comp.competitors.forEach(team => {
      if (team.leaders && team.leaders.length > 0) {
        stars.add(team.team.abbreviation);
      }
    });
  });
  return stars;
}

async function pollGames() {
  pollCount++;
  try {
    const games = await fetchNBAScoreboard();
    lastGames = games;
    renderGames(games);

    // Refresh open details panel (background refresh, skip loading state)
    if (activeGamePk) {
      if (window.innerWidth > 1000 && document.getElementById('side-panel')?.classList.contains('open')) {
        openSidePanel(activeGamePk, true);
      } else if (document.getElementById('game-drawer')?.classList.contains('open')) {
        openGameDrawer(activeGamePk, true);
      }
    }

    const activeTab = document.querySelector('.tab-btn.active')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (activeTab === 'games') fetchNBALeaders();
    if (activeTab === 'milestones') fetchNBAMilestones();
    if (activeTab === 'standings') fetchNBAStandings();
    if (activeTab === 'potd') fetchAndRenderNBAPOTD(games);
    if (activeTab === 'shots') fetchAndRenderNBAShots(games);
    if (activeTab === 'duel') fetchAndRenderNBADuel(games);

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

function setGameDate(date) {
  selectedDate = date || todayET();
  savePrefs({ selectedDateNBA: selectedDate });
  const input = document.getElementById('game-date');
  if (input) input.value = selectedDate;
  isFirstLoad = true;
  pollCount = 0;
  lastGames = null;
  document.getElementById('last-update').textContent = selectedDate === todayET() ? 'Date set to today' : `Date set to ${selectedDate}`;

  if (pollTimer) clearTimeout(pollTimer);

  const activeTab = document.querySelector('.tab-btn.active')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  if (activeTab === 'standings') fetchNBAStandings();
  if (activeTab === 'games') fetchNBALeaders();
  if (activeTab === 'milestones') fetchNBAMilestones();

  pollGames();
}

let currentSort = 'watchability';
function setSort(s) {
  currentSort = s;
  if (lastGames) renderGames(lastGames);
  document.querySelectorAll('.gc-btn[id^="sort-"]').forEach(b => {
      b.classList.toggle('active', b.id === `sort-${s}`);
      b.setAttribute('aria-pressed', b.id === `sort-${s}`);
  });
}

let currentFilter = null;
function setFilter(f) {
  currentFilter = currentFilter === f ? null : f;
  if (lastGames) renderGames(lastGames);
  document.querySelectorAll('.gc-btn[id^="filter-"]').forEach(b => {
      const type = b.id.replace('filter-', '');
      b.classList.toggle('active', currentFilter === type);
      b.setAttribute('aria-pressed', currentFilter === type);
  });
}

function applySortFilter(games) {
  let g = [...games];
  if (currentFilter === 'hot') g = g.filter(x => x.watchabilityIndex >= 60);
  if (currentFilter === 'fire') g = g.filter(x => x.watchabilityIndex >= 75);
  if (currentFilter === 'live') g = g.filter(x => x.isLive);

  g.sort((a, b) => {
    if (currentSort === 'watchability') return b.watchabilityIndex - a.watchabilityIndex;
    if (currentSort === 'score') return Math.abs(a.awayScore - a.homeScore) - Math.abs(b.awayScore - b.homeScore);
    return b.period - a.period;
  });
  return g;
}

function revealSpoiler(el, pk) {
  revealedGames.add(pk);
  if (lastGames) renderGames(lastGames);
}

async function openGameDrawer(pk, skipLoading = false) {
  activeGamePk = pk;
  const drawer = document.getElementById('game-drawer');
  const title = document.getElementById('drawer-title');
  const body = document.getElementById('drawer-body');
  const game = lastGames?.find(g => String(g.gamePk) === String(pk));

  if (!game) return;

  // Visual highlight
  document.querySelectorAll('.game-card').forEach(c => c.classList.toggle('active-side', c.getAttribute('data-gpk') === String(pk)));

  title.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
  if (!skipLoading) body.innerHTML = '<div class="expand-load-msg">Loading game details…</div>';
  drawer.classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');

  try {
    const url = `${NBA_SUMMARY_API}?event=${pk}`;
    const data = await requestPool.fetchDedup(url, { ttl: 30000 });
    renderNBAExpandPanel(body, data, game);
  } catch (e) {
    body.innerHTML = '<div class="expand-load-msg" style="color:var(--danger)">Failed to load details</div>';
  }
}

function closeGameDrawer() {
  activeGamePk = null;
  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('active-side'));
  document.getElementById('game-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

async function openSidePanel(pk, skipLoading = false) {
  activeGamePk = pk;
  const panel = document.getElementById('side-panel');
  const title = document.getElementById('side-panel-title');
  const body = document.getElementById('side-panel-body');
  const game = lastGames?.find(g => String(g.gamePk) === String(pk));

  if (!game || !panel || !title || !body) return;

  // Visual highlight
  document.querySelectorAll('.game-card').forEach(c => c.classList.toggle('active-side', c.getAttribute('data-gpk') === String(pk)));

  title.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
  if (!skipLoading) body.innerHTML = '<div class="expand-load-msg">Loading game details…</div>';
  panel.classList.add('open');

  try {
    const url = `${NBA_SUMMARY_API}?event=${pk}`;
    const data = await requestPool.fetchDedup(url, { ttl: 30000 });
    renderNBAExpandPanel(body, data, game);
  } catch (e) {
    body.innerHTML = '<div class="expand-load-msg" style="color:var(--danger)">Failed to load details</div>';
  }
}

function closeSidePanel() {
  activeGamePk = null;
  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('active-side'));
  document.getElementById('side-panel').classList.remove('open');
}

function renderNBAMomentumTimeline(wpData, plays, awayAbbr, homeAbbr) {
  if (!wpData || wpData.length < 2) return '';
  const w = 400, h = 100, pad = 10;
  const awayColor = teamColor(awayAbbr);
  const homeColor = teamColor(homeAbbr);

  // ESPN uses 0.0 to 1.0 for win probability
  const points = wpData.map((p, i) => {
    const x = pad + (i / (wpData.length - 1)) * (w - pad * 2);
    const y = pad + (p.homeWinPercentage) * (h - pad * 2);
    return { x, y, p };
  });

  const path = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');

  return `
    <div class="momentum-timeline-wrap">
      <div class="expand-section-label">Momentum Timeline (Win Prob)</div>
      <div class="momentum-svg-container">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <line x1="${pad}" y1="${h/2}" x2="${w-pad}" y2="${h/2}" stroke="var(--border-primary)" stroke-dasharray="4 4" />
          <path d="${path}" fill="none" stroke="var(--gold)" stroke-width="2" />
        </svg>
        <div class="momentum-labels">
          <span style="color:${awayColor}">${awayAbbr}</span>
          <span style="color:${homeColor}">${homeAbbr}</span>
        </div>
      </div>
    </div>
  `;
}

function renderNBATeamComparison(boxscoreTeams) {
  if (!boxscoreTeams || boxscoreTeams.length < 2) return '';
  const teamA = boxscoreTeams[0];
  const teamH = boxscoreTeams[1];

  const getStat = (team, name) => team.statistics.find(s => s.name === name)?.displayValue || '-';

  const stats = [
    { label: 'FG%', name: 'fieldGoalPct' },
    { label: '3P%', name: 'threePointFieldGoalPct' },
    { label: 'FT%', name: 'freeThrowPct' },
    { label: 'Rebounds', name: 'totalRebounds' },
    { label: 'Assists', name: 'assists' },
    { label: 'Steals', name: 'steals' },
    { label: 'Blocks', name: 'blocks' },
    { label: 'Turnovers', name: 'totalTurnovers' },
    { label: 'Pts in Paint', name: 'pointsInPaint' },
    { label: 'Fast Break Pts', name: 'fastBreakPoints' }
  ];

  let html = '<div class="expand-section-label">Team Comparison</div>';
  html += '<table class="comparison-table"><thead><tr><th>' + teamA.team.abbreviation + '</th><th>Metric</th><th>' + teamH.team.abbreviation + '</th></tr></thead><tbody>';
  stats.forEach(s => {
    const valA = getStat(teamA, s.name);
    const valH = getStat(teamH, s.name);
    html += `<tr><td>${valA}</td><td class="stat-label">${s.label}</td><td>${valH}</td></tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function renderNBABoxScore(boxscorePlayers) {
  if (!boxscorePlayers) return '';
  let html = '<div class="expand-section-label">Box Score</div>';

  boxscorePlayers.forEach(teamBox => {
    const team = teamBox.team;
    const statsData = teamBox.statistics[0];
    if (!statsData) return;

    html += `<div class="boxscore-team-header">${teamLogo(team.abbreviation)} ${team.displayName}</div>`;
    html += '<div class="boxscore-scroll-wrap"><table class="boxscore-table"><thead><tr>';
    html += '<th>PLAYER</th><th>MIN</th><th>FG</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PTS</th><th>+/-</th>';
    html += '</tr></thead><tbody>';

    statsData.athletes.forEach(player => {
      if (player.didNotPlay) {
        html += `<tr class="dnp"><td class="player-name">${player.athlete.shortName}</td><td colspan="11" class="dnp-reason">DNP - ${player.reason || 'Coach\'s Decision'}</td></tr>`;
        return;
      }
      const s = player.stats;
      // Indices based on labels: MIN(0), PTS(1), FG(2), 3PT(3), FT(4), REB(5), AST(6), TO(7), STL(8), BLK(9), OREB(10), DREB(11), PF(12), +/-(13)
      html += `<tr>
        <td class="player-name">${player.athlete.shortName}</td>
        <td>${s[0]}</td><td>${s[2]}</td><td>${s[3]}</td><td>${s[4]}</td><td>${s[5]}</td>
        <td>${s[6]}</td><td>${s[8]}</td><td>${s[9]}</td><td>${s[7]}</td><td>${s[1]}</td><td>${s[13]}</td>
      </tr>`;
    });

    // Totals
    const t = teamBox.totals;
    if (t) {
      html += `<tr class="totals-row">
        <td>TOTALS</td><td>-</td><td>${t[2]}</td><td>${t[3]}</td><td>${t[4]}</td><td>${t[5]}</td>
        <td>${t[6]}</td><td>${t[8]}</td><td>${t[9]}</td><td>${t[7]}</td><td>${t[1]}</td><td>-</td>
      </tr>`;
    }

    html += '</tbody></table></div>';
  });

  return html;
}

function renderNBAExpandPanel(container, data, game) {
  let html = '';

  // 1. Momentum Graph
  if (data.winprobability && data.winprobability.length > 0) {
    html += renderNBAMomentumTimeline(data.winprobability, data.plays, game.awayTeam, game.homeTeam);
  }

  // 2. Recent Shots (Last 5)
  const recentShots = (data.plays || [])
    .filter(p => {
      const type = p.type?.text?.toLowerCase() || '';
      return type.includes('shot') || type.includes('dunk') || type.includes('layup') || type.includes('free throw');
    })
    .slice(-5)
    .reverse();

  if (recentShots.length > 0) {
    html += '<div class="expand-section-label">Recent Shots</div>';
    html += '<div class="expand-plays">';
    recentShots.forEach(p => {
      html += `
        <div class="expand-play">
          <span class="expand-play-inn">${p.period?.displayValue || ''} ${p.clock?.displayValue || ''}</span>
          <span class="expand-play-desc">
            ${p.text}
            <span class="expand-play-score">${game.awayTeam} ${p.awayScore} · ${game.homeTeam} ${p.homeScore}</span>
          </span>
        </div>`;
    });
    html += '</div>';
  }

  // 3. Team Comparison
  if (data.boxscore && data.boxscore.teams) {
    html += renderNBATeamComparison(data.boxscore.teams);
  }

  // 4. Box Score
  if (data.boxscore && data.boxscore.players) {
    html += renderNBABoxScore(data.boxscore.players);
  }

  // 5. Leaders (Top Performers in this game)
  if (data.leaders) {
    html += '<div class="expand-section-label">Game Leaders</div>';
    html += '<div class="drawer-chip-list">';
    data.leaders.forEach(teamLeaders => {
        const teamAbbr = teamLeaders.team.abbreviation;
        teamLeaders.leaders.forEach(l => {
            const athlete = l.leaders[0]?.athlete;
            if (athlete) {
                html += `
                <div class="drawer-chip">
                  <strong>${teamLogo(teamAbbr)} ${athlete.displayName}</strong>
                  <span>${l.leaders[0].displayValue}</span>
                </div>`;
            }
        });
    });
    html += '</div>';
  }

  container.innerHTML = html || '<div class="empty-msg">No detailed data available yet.</div>';
}

// Global attachment
window.fetchNBALeaders = fetchNBALeaders;
async function fetchNBALeaders() {
  const container = document.getElementById('leaders-container');
  const title = document.getElementById('leaders-title');
  const date = selectedDate || todayET();
  if (title) {
    title.textContent = date === todayET() ? 'League Leaders' : `League Leaders (as of ${date})`;
  }

  if (!container) return;
  if (isFirstLoad || container.querySelector('.empty-msg')) {
    container.innerHTML = '<div class="empty-msg">Loading leaders...</div>';
  }

  try {
    const season = getNBASeason(date);
    // Replace the year segment in the URL (e.g., .../seasons/2024/...) with the current season
    const url = NBA_LEADERS_API.replace(/\/seasons\/\d+\//, `/seasons/${season}/`);
    const data = await requestPool.fetchDedup(url, { ttl: 3600000 });
    if (!data || !data.categories) {
      container.innerHTML = '<div class="empty-msg">Leaders data currently unavailable.</div>';
      return;
    }

    const targetNames = NBA_LEADER_DEFS.map(d => d.name);
    const filteredCats = data.categories.filter(c => targetNames.includes(c.name));

    // BOLT OPTIMIZATION: Batch-resolve all unique athlete and team references
    const refSet = new Set();
    filteredCats.forEach(cat => {
      const topLeader = cat.leaders[0];
      if (topLeader) {
        refSet.add(topLeader.athlete.$ref);
        refSet.add(topLeader.team.$ref);
      }
    });

    const refMap = new Map();
    await Promise.all(Array.from(refSet).map(async ref => {
      const resolved = ref.includes('/athletes/') ? await resolveAthleteRef(ref) : await resolveTeamRef(ref);
      refMap.set(ref, resolved);
    }));

    const results = filteredCats.map(cat => {
      const topLeader = cat.leaders[0];
      if (!topLeader) return null;

      const athlete = refMap.get(topLeader.athlete.$ref);
      const team = refMap.get(topLeader.team.$ref);
      if (!athlete || !team) return null;

      const def = NBA_LEADER_DEFS.find(d => d.name === cat.name);
      return {
        label: def ? def.label : cat.shortDisplayName,
        name: athlete.displayName,
        team: team.abbreviation,
        value: topLeader.displayValue
      };
    }).filter(Boolean);

    renderNBALeaders(results);
  } catch (e) {
    console.error('NBA Leaders fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load leaders</div>';
  }
}

async function resolveAthleteRef(ref) {
  return requestPool.fetchDedup(ref.replace('http:', 'https:'), { ttl: 86400000 });
}

async function resolveTeamRef(ref) {
  return requestPool.fetchDedup(ref.replace('http:', 'https:'), { ttl: 86400000 });
}

function renderNBALeaders(leaders) {
  const container = document.getElementById('leaders-container');
  if (!container) return;

  // BOLT: State-based reconciliation to skip redundant innerHTML writes
  const stateKey = leaders.map(l => `${l.name}-${l.team}-${l.value}`).join('|');
  if (container._lastStateKey === stateKey) return;
  container._lastStateKey = stateKey;

  container.innerHTML = '';

  const groups = [
    { title: 'Scoring & Efficiency', items: ['PPG', 'FG%', '3P%', '3PM/G'] },
    { title: 'Playmaking & Ball Handling', items: ['APG', 'TOV/G'] },
    { title: 'Defense & Rebounding', items: ['RPG', 'SPG', 'BPG'] },
    { title: 'All-Around Performance', items: ['Double-Double', 'Triple-Double'] }
  ];

  groups.forEach(group => {
    const groupLeaders = leaders.filter(l => group.items.includes(l.label));
    if (groupLeaders.length === 0) return;

    const section = document.createElement('div');
    section.className = 'leaders-section';
    section.style.marginBottom = '20px';
    section.innerHTML = `<div class="leaders-section-title" style="font-size: 0.85rem; font-weight: 700; color: var(--gold); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">${group.title}</div>`;

    const grid = document.createElement('div');
    grid.className = 'leaders-row';

    groupLeaders.forEach(l => {
      const card = document.createElement('div');
      card.className = 'leader-card';
      card.innerHTML = `
        <div class="leader-cat">${l.label}</div>
        <div class="leader-name">${l.name}</div>
        <div class="leader-team">${l.team}</div>
        <div class="leader-val">${l.value}</div>
      `;
      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });

  // Any remaining leaders not in groups
  const groupedLabels = groups.flatMap(g => g.items);
  const remaining = leaders.filter(l => !groupedLabels.includes(l.label));
  if (remaining.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'leaders-row';
    remaining.forEach(l => {
      const card = document.createElement('div');
      card.className = 'leader-card';
      card.innerHTML = `
        <div class="leader-cat">${l.label}</div>
        <div class="leader-name">${l.name}</div>
        <div class="leader-team">${l.team}</div>
        <div class="leader-val">${l.value}</div>
      `;
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }
}

let milestoneFilter = loadPrefs().milestoneFilter || 'all';
const followedChases = new Set(loadPrefs().followedChasesNBA || []);

function setMilestoneFilter(filter) {
  milestoneFilter = filter;
  savePrefs({ milestoneFilter: filter });
  const container = document.getElementById('milestones-container');
  if (container) container._lastStateKey = null; // Invalidate cache
  if (window.lastNBAMilestones) renderMilestoneBoard(window.lastNBAMilestones);
}

function toggleFollowChase(playerKey) {
  if (followedChases.has(playerKey)) followedChases.delete(playerKey);
  else followedChases.add(playerKey);
  savePrefs({ followedChasesNBA: [...followedChases] });
  const container = document.getElementById('milestones-container');
  if (container) container._lastStateKey = null; // Invalidate cache
  if (window.lastNBAMilestones) renderMilestoneBoard(window.lastNBAMilestones);
}

function milestoneImportance(m) {
  const meta = NBA_MILESTONE_META[m.stat] || {};
  if ((meta.historic || []).includes(Number(m.next))) return 'Historic';
  if ((meta.major || []).includes(Number(m.next))) return 'Major';
  return m.stat.startsWith('Career') ? 'Career' : 'Season';
}

function milestoneUrgency(m) {
  if (m.playingNow && m.diff <= 10) return 'Could happen today';
  if (m.playingToday && m.diff <= 15) return 'Could happen today';
  if (m.diff <= 30) return 'This week';
  return 'Longer watch';
}

function milestonePriority(m) {
  const importance = milestoneImportance(m);
  let score = 100 - Math.min(m.diff, 100);
  if (m.playingNow) score += 20;
  else if (m.playingToday) score += 10;
  if (favoriteTeams.has(m.team)) score += 15;
  if (importance === 'Historic') score += 25;
  else if (importance === 'Major') score += 12;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function milestoneProgress(m) {
  const current = parseStatValue(m.current);
  const next = parseFloat(m.next) || 1;
  return Math.round(Math.max(0, Math.min(100, (current / next) * 100)));
}

function milestonePaceText(m) {
  const diff = parseFloat(m.diff) || 0;
  if (m.playingNow && diff <= 5) return 'live watch';
  if (diff <= 10) return 'very close';
  if (diff <= 25) return 'week watch';
  return 'longer chase';
}

window.fetchNBAMilestones = fetchNBAMilestones;
async function fetchNBAMilestones() {
  const container = document.getElementById('milestones-container');
  if (!container) return;
  if (isFirstLoad || container.querySelector('.empty-msg')) {
    container.innerHTML = '<div class="empty-msg">Loading milestones...</div>';
  }

  try {
    const season = getNBASeason(selectedDate);
    const url = NBA_LEADERS_API.replace(/\/seasons\/\d+\//, `/seasons/${season}/`);
    const data = await requestPool.fetchDedup(url, { ttl: 3600000 });
    const allMilestones = [];

    const candidateRefs = new Set();
    const candidates = [];

    if (data && data.categories) {
      // BOLT: Index categories by name for O(1) lookup
      const categoryMap = new Map(data.categories.map(c => [c.name, c]));

      await Promise.all(NBA_MILESTONE_DEFS.map(async def => {
        const cat = categoryMap.get(def.api);
        if (!cat) return;

        // Take top 20 from each category to look for milestones
        const topLeaders = cat.leaders.slice(0, 20);
        topLeaders.forEach(leader => {
          const val = parseStatValue(leader.value);
          const next = def.milestones.find(m => m > val);
          if (!next) return;
          const diff = next - val;
          if (diff > (def.lookahead || 100)) return;

          candidateRefs.add(leader.athlete.$ref);
          candidateRefs.add(leader.team.$ref);
          candidates.push({ leader, def, next, diff, scope: 'season' });
        });
      }));

      // Career milestones for these top performers
      const athleteToTeamRef = new Map(candidates.map(c => [c.leader.athlete.$ref, c.leader.team.$ref]));
      const uniqueAthleteRefs = Array.from(athleteToTeamRef.keys());

      await Promise.all(uniqueAthleteRefs.map(async ref => {
        try {
          const athlete = await resolveAthleteRef(ref);
          const statsUrl = athlete.statistics?.$ref;
          if (!statsUrl) return;
          const statsData = await requestPool.fetchDedup(statsUrl, { ttl: 86400000 });
          if (!statsData || !statsData.splits) return;

          // Memory insight: splits can be array or object. Career is usually array.
          const careerSplit = Array.isArray(statsData.splits)
            ? statsData.splits.find(s => s.type?.name === 'All-Time' || s.id === '0')
            : (statsData.splits.id === '0' ? statsData.splits : null);

          if (!careerSplit || !careerSplit.stats) return;

          const statMap = new Map(careerSplit.stats.map(s => [s.name, s]));
          NBA_CAREER_MILESTONE_DEFS.forEach(def => {
            const s = statMap.get(def.api);
            if (!s) return;
            const val = parseStatValue(s.value);
            const next = def.milestones.find(m => m > val);
            if (next) {
              const diff = next - val;
              if (diff <= def.lookahead) {
                // BOLT OPTIMIZATION: Use Map for O(1) team resolution instead of O(N) Array.find
                const teamRef = athleteToTeamRef.get(ref);
                if (teamRef) {
                  candidates.push({
                    leader: { athlete: { $ref: ref }, team: { $ref: teamRef }, displayValue: s.displayValue },
                    def, next, diff, scope: 'career'
                  });
                }
              }
            }
          });
        } catch (e) {}
      }));
    }

      // 2. Batch-resolve all unique athlete and team references in parallel
      const refMap = new Map();
      const refPromises = Array.from(candidateRefs).map(async ref => {
        const resolved = ref.includes('/athletes/') ? await resolveAthleteRef(ref) : await resolveTeamRef(ref);
        refMap.set(ref, resolved);
      });
      await Promise.all(refPromises);

      // 3. Map candidates to milestone objects
      candidates.forEach(({ leader, def, next, diff, scope }) => {
        const athlete = refMap.get(leader.athlete.$ref);
        const team = refMap.get(leader.team.$ref);
        if (!athlete || !team) return;

        allMilestones.push({
          id: athlete.id,
          name: athlete.displayName,
          team: team.abbreviation,
          stat: (scope === 'career' ? 'Career ' : '') + def.label,
          current: leader.displayValue,
          next: next,
          diff: diff,
          icon: def.icon,
          playingNow: liveTeams.has(team.abbreviation),
          playingToday: todayTeams.has(team.abbreviation)
        });
      });

    allMilestones.forEach(m => {
      m.importance = milestoneImportance(m);
      m.urgency = milestoneUrgency(m);
      m.priority = milestonePriority(m);
      m.progress = milestoneProgress(m);
      m.paceText = milestonePaceText(m);
    });

    const CONCURRENCY_LIMIT = 5;
    let heatIndex = 0;
    const worker = async () => {
      while (heatIndex < allMilestones.length) {
        const m = allMilestones[heatIndex++];
        try {
          m.heat = await fetchPlayerHeatNBA(m.id, m.stat);
        } catch (e) {
          m.heat = [];
        }
      }
    };
    const workers = Array.from(
      { length: Math.min(CONCURRENCY_LIMIT, allMilestones.length) },
      worker
    );
    await Promise.all(workers);

    allMilestones.sort((a, b) => b.priority - a.priority || a.diff - b.diff);
    window.lastNBAMilestones = allMilestones;

    if (allMilestones.length === 0) {
      container.innerHTML = '<div class="empty-msg">No upcoming milestones to track</div>';
      return;
    }

    renderMilestoneBoard(allMilestones);
  } catch (e) {
    console.error('NBA Milestones fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load milestones</div>';
  }
}

function renderMilestoneBoard(allMilestones) {
  const container = document.getElementById('milestones-container');
  if (!container) return;

  // BOLT: State-based reconciliation to skip redundant innerHTML writes
  const stateKey = `${milestoneFilter}-${allMilestones.length}-${allMilestones.map(m => `${m.id}:${m.current}:${m.playingNow}`).join('|')}`;
  if (container._lastStateKey === stateKey) return;
  container._lastStateKey = stateKey;

  const filterFns = {
    all: () => true,
    live: m => m.playingNow,
    today: m => m.playingToday,
    favorites: m => favoriteTeams.has(m.team),
    historic: m => m.importance === 'Historic' || m.importance === 'Major'
  };

  const filtered = [];
  let liveCount = 0, todayCount = 0, historicCount = 0, favCount = 0;
  const groups = {};
  const filterFn = filterFns[milestoneFilter] || filterFns.all;

  allMilestones.forEach(m => {
    if (m.playingNow) liveCount++;
    if (m.playingToday) todayCount++;
    if (m.importance === 'Historic' || m.importance === 'Major') historicCount++;
    if (favoriteTeams.has(m.team)) favCount++;

    if (filterFn(m)) {
      filtered.push(m);
      if (!groups[m.urgency]) groups[m.urgency] = [];
      groups[m.urgency].push(m);
    }
  });

  const urgencyOrder = ['Could happen today', 'This week', 'Longer watch'];
  const date = selectedDate || todayET();

  container.innerHTML = `
    <div class="milestone-hero">
      <div class="milestone-hero-main">
        <div class="milestone-hero-kicker">NBA Chase Board${date === todayET() ? '' : ` (as of ${date})`}</div>
        <div class="milestone-hero-title">${filtered.length} active milestone${filtered.length !== 1 ? 's' : ''}</div>
        <div class="milestone-hero-sub">Sorted by watch priority: proximity, live context, favorites, and historical weight.</div>
      </div>
      <div class="milestone-summary-grid">
        <div><strong>${liveCount}</strong><span>live now</span></div>
        <div><strong>${todayCount}</strong><span>playing today</span></div>
        <div><strong>${historicCount}</strong><span>major/historic</span></div>
        <div><strong>${favCount}</strong><span>favorites</span></div>
      </div>
    </div>
    <div class="milestone-filters">
      ${[
        ['all','All'],
        ['live','Live'],
        ['today','Today'],
        ['favorites','Favorites'],
        ['historic','Major']
      ].map(([id,label]) => `<button class="milestone-filter${milestoneFilter === id ? ' active' : ''}" onclick="setMilestoneFilter('${id}')">${label}</button>`).join('')}
    </div>
    <div class="milestone-board">
      ${filtered.length ? urgencyOrder.map(groupName => {
        const items = (groups[groupName] || []).sort((a,b) => b.priority - a.priority || a.diff - b.diff);
        if (!items.length) return '';
        return `<section class="milestone-lane">
          <div class="milestone-lane-title">${groupName}<span>${items.length}</span></div>
          <div class="milestones-grid rich">${items.slice(0, 12).map(renderMilestoneCard).join('')}</div>
        </section>`;
      }).join('') : '<div class="empty-msg">No milestones match this filter</div>'}
    </div>`;
}

function renderMilestoneCard(m) {
  const statusClass = m.playingNow ? ' now' : m.playingToday ? ' today' : '';
  const importanceClass = m.importance.toLowerCase();
  const diffLabel = `${m.diff} ${m.stat} away`;
  const fav = favoriteTeams.has(m.team) ? '<span class="milestone-pill fav">Favorite</span>' : '';
  const live = m.playingNow ? '<span class="milestone-pill live">Live now</span>' : m.playingToday ? '<span class="milestone-pill today">Today</span>' : '';

  const heatHtml = m.heat && m.heat.length ? `
    <div class="milestone-heat">
      ${m.heat.map(val => `<div class="heat-bar ${val > 0 ? 'active' : ''}"></div>`).join('')}
    </div>` : '';

  const playerKey = `${m.id}-${m.stat}`;
  const isFollowed = followedChases.has(playerKey);
  const followBtn = `<button class="milestone-follow ${isFollowed ? 'active' : ''}"
    onclick="toggleFollowChase('${playerKey}')"
    aria-pressed="${isFollowed}"
    aria-label="${isFollowed ? 'Stop watching' : 'Watch'} ${escapeHTML(m.name)}'s chase for ${escapeHTML(m.next)} ${escapeHTML(m.stat)}">
    ${isFollowed ? '★ Following' : '☆ Watch Chase'}
  </button>`;

  return `
    <article class="milestone-card rich${statusClass}">
      <div class="milestone-topline">
        <span class="milestone-importance ${importanceClass}">${m.importance}</span>
        ${followBtn}
      </div>
      <div class="milestone-player">${teamLogo(m.team)} ${m.name}</div>
      <div class="milestone-team">${m.team} · ${m.stat} ${m.icon}</div>
      ${heatHtml}
      <div class="milestone-target">
        <strong>${m.current}</strong>
        <span>/ ${m.next}</span>
      </div>
      <div class="milestone-progress"><div style="width:${m.progress}%"></div></div>
      <div class="milestone-card-footer">
        <span>${diffLabel}</span>
        <em>${m.paceText}</em>
      </div>
      <div class="milestone-pills">${live}${fav}</div>
    </article>
  `;
}

window.switchTab = switchTab;
window.openGameDrawer = openGameDrawer;
window.closeGameDrawer = closeGameDrawer;
window.openSidePanel = openSidePanel;
window.closeSidePanel = closeSidePanel;
window.startPolling = startPolling;
window.stopPolling = stopPolling;
window.setGameDate = setGameDate;
window.setSort = setSort;
window.setFilter = setFilter;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.switchSidebarTab = switchSidebarTab;
window.toggleFavoriteTeam = toggleFavoriteTeam;
window.clearAllFavorites = clearAllFavorites;
window.toggleSpoilerTeam = toggleSpoilerTeam;
window.clearAllSpoilers = clearAllSpoilers;
window.revealSpoiler = revealSpoiler;
window.todayET = todayET;
window.setMilestoneFilter = setMilestoneFilter;
window.toggleFollowChase = toggleFollowChase;

// ─── NBA AWARD RACES ─────────────────────────────────────────────────────────

async function fetchNBAAwardRaces() {
  const container = document.getElementById('awards-container');
  if (!container) return;
  container.innerHTML = '<div class="empty-msg">Loading NBA award races...</div>';

  try {
    const date = selectedDate || todayET();
    const season = getNBASeason(date);
    const url = NBA_LEADERS_API.replace(/\/seasons\/\d+\//, `/seasons/${season}/`);
    const data = await requestPool.fetchDedup(url, { ttl: 3600000 });

    if (!data || !data.categories) {
      container.innerHTML = '<div class="empty-msg">Award data currently unavailable.</div>';
      return;
    }

    // NBA Awards don't have a direct "race" endpoint in the same way MLB Stats API does
    // We will simulate it using season leader data and a voter panel model.
    const candidates = await buildNBAAwardCandidates(data.categories);

    renderNBAAwardRaces(candidates);
  } catch (e) {
    console.error('NBA Award Races fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load award races</div>';
  }
}

async function buildNBAAwardCandidates(categories) {
  // Map categories for easier access
  const catMap = new Map(categories.map(c => [c.name, c]));

  // 1. MVP: Weighted blend of PPG, RPG, APG, and Team Success
  // 2. DPOY: RPG, SPG, BPG
  // 3. ROTY: PPG, RPG, APG (filtered by rookies - though core API doesn't make it easy to filter)
  // 4. 6th Man: (Hard to identify starters vs bench from this endpoint alone)

  // PPG, RPG, APG, SPG, BPG, FG%, 3P%, PER (if available)
  const importantCats = ['pointsPerGame', 'reboundsPerGame', 'assistsPerGame', 'stealsPerGame', 'blocksPerGame', 'fieldGoalPercentage'];

  // BOLT OPTIMIZATION: Batch-resolve all unique athlete and team references
  const refSet = new Set();
  importantCats.forEach(catName => {
    const cat = catMap.get(catName);
    if (cat) {
      cat.leaders.slice(0, 15).forEach(leader => {
        refSet.add(leader.athlete.$ref);
        refSet.add(leader.team.$ref);
      });
    }
  });

  const refMap = new Map();
  await Promise.all(Array.from(refSet).map(async ref => {
    const resolved = ref.includes('/athletes/') ? await resolveAthleteRef(ref) : await resolveTeamRef(ref);
    refMap.set(ref, resolved);
  }));

  const playerPool = new Map();
  importantCats.forEach(catName => {
    const cat = catMap.get(catName);
    if (cat) {
      cat.leaders.slice(0, 15).forEach(leader => {
        const aRef = leader.athlete.$ref;
        const tRef = leader.team.$ref;
        const athlete = refMap.get(aRef);
        const team = refMap.get(tRef);

        if (!athlete || !team) return;

        if (!playerPool.has(aRef)) {
          playerPool.set(aRef, {
            id: athlete.id,
            name: athlete.displayName,
            team: team.abbreviation,
            stats: {},
            ref: aRef
          });
        }
        const p = playerPool.get(aRef);
        p.stats[catName] = parseStatValue(leader.value);
      });
    }
  });

  const players = Array.from(playerPool.values());

  const scoreMVP = (p) => {
    const ppg = p.stats.pointsPerGame || 0;
    const rpg = p.stats.reboundsPerGame || 0;
    const apg = p.stats.assistsPerGame || 0;
    // Heuristic: PPG + 0.4*RPG + 0.5*APG + win bonus (simulated)
    return ppg + (rpg * 0.4) + (apg * 0.5);
  };

  const scoreDPOY = (p) => {
    const rpg = p.stats.reboundsPerGame || 0;
    const spg = p.stats.stealsPerGame || 0;
    const bpg = p.stats.blocksPerGame || 0;
    return (rpg * 0.2) + (spg * 2.0) + (bpg * 1.5);
  };

  const awards = [
    { name: 'Most Valuable Player', candidates: rankNBAAward(players, scoreMVP), icon: '🏆' },
    { name: 'Defensive Player of the Year', candidates: rankNBAAward(players, scoreDPOY), icon: '🛡️' }
  ];

  return awards;
}

function rankNBAAward(players, scoreFn) {
  const VOTE_PTS = [14, 9, 7, 4, 2];
  const candidates = players
    .map(p => ({ ...p, score: scoreFn(p) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const votes = {};
  candidates.forEach(p => { votes[p.id] = 0; });

  const voterProfiles = [
    { name: 'Traditionalist', weights: { stats: 1.2, noise: 0.3 } },
    { name: 'Advanced Analyst', weights: { stats: 1.0, noise: 0.1 } },
    { name: 'Narrative Driven', weights: { stats: 0.8, noise: 0.6 } }
  ];

  for (let i = 0; i < 5; i++) {
    const profile = voterProfiles[i % voterProfiles.length];
    const sorted = [...candidates].sort((a, b) => {
      const sa = (a.score * profile.weights.stats) + (Math.random() * profile.weights.noise * 10);
      const sb = (b.score * profile.weights.stats) + (Math.random() * profile.weights.noise * 10);
      return sb - sa;
    });
    sorted.slice(0, 5).forEach((p, idx) => {
      votes[p.id] = (votes[p.id] || 0) + VOTE_PTS[idx];
    });
  }

  return candidates
    .map(p => ({ ...p, voteTotal: votes[p.id] || 0 }))
    .sort((a, b) => b.voteTotal - a.voteTotal)
    .slice(0, 5);
}

function renderNBAAwardRaces(awards) {
  const container = document.getElementById('awards-container');
  if (!container) return;
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'awards-league-row';

  awards.forEach(award => {
    const block = document.createElement('div');
    block.className = 'award-block';

    let candidatesHtml = '';
    const maxVotes = Math.max(...award.candidates.map(c => c.voteTotal), 1);

    award.candidates.forEach((p, i) => {
      const voteBar = `
        <div style="display:flex;align-items:center;gap:6px;margin-top:5px">
          <div style="flex:1;height:3px;background:#1e1e2e;border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${Math.round((p.voteTotal / maxVotes) * 100)}%;background:${i === 0 ? 'var(--gold)' : i === 1 ? '#94a3b8' : '#78716c'};border-radius:2px;transition:width 0.4s"></div>
          </div>
          <span style="font-size:0.65rem;color:var(--text-dim);font-variant-numeric:tabular-nums;min-width:28px;text-align:right">${p.voteTotal} pts</span>
        </div>`;

      const statsLine = Object.entries(p.stats)
        .map(([k, v]) => `<strong>${Number(v).toFixed(1)}</strong> ${k.replace('PerGame', '').toUpperCase()}`)
        .join(' · ');

      candidatesHtml += `
        <div class="award-candidate">
          <div class="award-rank r${i + 1}">${['🥇', '🥈', '🥉', '4', '5'][i] || (i + 1)}</div>
          <div class="award-cand-info">
            <div class="award-cand-name">${teamLogo(p.team)} ${p.name}</div>
            <div class="award-cand-team">${p.team}</div>
            <div class="award-cand-stats">${statsLine}</div>
            ${voteBar}
          </div>
        </div>`;
    });

    block.innerHTML = `
      <div class="award-block-title">${award.icon} ${award.name}</div>
      ${candidatesHtml}`;
    grid.appendChild(block);
  });

  container.appendChild(grid);

  // Add All-NBA Court
  const courtSection = document.createElement('div');
  courtSection.className = 'ss-section';
  courtSection.style.marginTop = '40px';

  // For All-NBA, we'll just take the top MVP candidates
  const allNbaPlayers = awards[0].candidates;
  courtSection.innerHTML = `
    <div class="section-title">🏀 Projected All-NBA First Team</div>
    <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:14px">Based on current MVP simulation rankings.</div>
    ${renderNBACourt(allNbaPlayers)}`;
  container.appendChild(courtSection);
}

function renderNBACourt(players) {
  // NBA Court SVG
  const courtSvg = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="400" height="300" fill="#1a1008" stroke="#3a2f18" stroke-width="2"/>
    <!-- Lane -->
    <rect x="120" y="200" width="160" height="100" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
    <!-- Three point line -->
    <path d="M 40 300 L 40 230 A 160 160 0 0 1 360 230 L 360 300" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
    <!-- Hoop/Backboard -->
    <line x1="170" y1="285" x2="230" y2="285" stroke="rgba(255,255,255,0.5)" stroke-width="3"/>
    <circle cx="200" cy="275" r="10" fill="none" stroke="#f59e0b" stroke-width="2"/>
  </svg>`;

  // NBA Positions
  const posCoords = [
    { label: 'PG', x: 20, y: 30 },
    { label: 'SG', x: 80, y: 30 },
    { label: 'SF', x: 20, y: 65 },
    { label: 'PF', x: 80, y: 65 },
    { label: 'C', x: 50, y: 85 }
  ];

  let playersHtml = '';
  posCoords.forEach((pos, i) => {
    const p = players[i] || { name: '—', team: '?', stats: {} };
    const lastName = p.name.split(' ').pop();
    const logoSrc = `https://a.espncdn.com/i/teamlogos/nba/500/${p.team.toLowerCase()}.png`;

    playersHtml += `
      <div class="field-player" style="left:${pos.x}%; top:${pos.y}%">
        <img class="field-player-logo" src="${logoSrc}" onerror="this.style.display='none'">
        <div class="field-player-pos">${pos.label}</div>
        <div class="field-player-name">${lastName}</div>
        <div class="field-player-stat">${p.stats.pointsPerGame || '0.0'} PPG</div>
      </div>`;
  });

  return `
    <div class="ss-field-wrap">
      <div class="baseball-field" style="padding-bottom: 75%; background: #2a1f08;">
        ${courtSvg}
        ${playersHtml}
      </div>
    </div>`;
}

// ─── NBA PLAYERS OF THE DAY ──────────────────────────────────────────────────

function calculateNBAPerformanceScore(stats) {
  // stats is an array: MIN(0), PTS(1), FG(2), 3PT(3), FT(4), REB(5), AST(6), TO(7), STL(8), BLK(9), OREB(10), DREB(11), PF(12), +/-(13)
  const pts = parseStatValue(stats[1]);
  const reb = parseStatValue(stats[5]);
  const ast = parseStatValue(stats[6]);
  const stl = parseStatValue(stats[8]);
  const blk = parseStatValue(stats[9]);
  const tov = parseStatValue(stats[7]);
  const fg = stats[2].split('/'); // "M/A"
  const fgm = parseInt(fg[0]) || 0;
  const fga = parseInt(fg[1]) || 0;

  // Game Score formula: PTS + 0.4 * FG - 0.7 * FGA - 0.4 * FTA + 0.6 * ORB + 0.3 * DRB + STL + 0.7 * AST + 0.7 * BLK - 0.4 * PF - TOV
  // Simplified version:
  return pts + (reb * 1.2) + (ast * 1.5) + (stl * 2.0) + (blk * 2.0) - (tov * 1.5) + (fgm * 0.5) - (fga * 0.2);
}

async function fetchAndRenderNBAPOTD(games) {
  const container = document.getElementById('potd-container');
  if (!container) return;

  const activePks = (games || [])
    .filter(g => !g.isPreview)
    .map(g => g.gamePk);

  if (activePks.length === 0) {
    container.innerHTML = '<div class="empty-msg">No games in progress or completed yet today</div>';
    return;
  }

  container.innerHTML = '<div class="empty-msg">Analyzing NBA performances...</div>';

  try {
    const performances = [];
    const feeds = await Promise.all(activePks.map(pk =>
      requestPool.fetchDedup(`${NBA_SUMMARY_API}?event=${pk}`, { ttl: 30000 })
    ));

    // BOLT OPTIMIZATION: Index games by gamePk for O(1) lookup in loop
    const gamesMap = new Map(games.map(g => [String(g.gamePk), g]));

    feeds.forEach((data, idx) => {
      if (!data.boxscore || !data.boxscore.players) return;
      const game = gamesMap.get(String(activePks[idx]));

      data.boxscore.players.forEach(teamBox => {
        const teamAbbr = teamBox.team.abbreviation;
        const oppAbbr = (teamAbbr === game.awayTeam) ? game.homeTeam : game.awayTeam;

        teamBox.statistics[0].athletes.forEach(p => {
          if (p.didNotPlay || !p.stats || p.stats.length === 0) return;
          const score = calculateNBAPerformanceScore(p.stats);
          if (score > 5) { // Threshold for notable performance
            performances.push({
              id: p.athlete.id,
              name: p.athlete.displayName,
              team: teamAbbr,
              opp: oppAbbr,
              score: score,
              stats: p.stats,
              gamePk: game.gamePk,
              isLive: game.isLive
            });
          }
        });
      });
    });

    const topPerformers = performances
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (topPerformers.length === 0) {
      container.innerHTML = '<div class="empty-msg">No notable performances yet today</div>';
      return;
    }

    let html = '<div class="potd-grid">';
    topPerformers.forEach(p => {
      // stats indices: MIN(0), PTS(1), REB(5), AST(6)
      const statLine = `${escapeHTML(p.stats[1])} PTS, ${escapeHTML(p.stats[5])} REB, ${escapeHTML(p.stats[6])} AST`;
      html += `
        <div class="potd-card" onclick="openGameDrawer('${escapeHTML(p.gamePk)}')">
          <div class="potd-team-line">
            ${teamLogo(p.team)} <strong>${escapeHTML(p.team)}</strong>
            <span class="potd-vs">vs</span>
            ${teamLogo(p.opp)} ${escapeHTML(p.opp)}
            ${p.isLive ? '<span class="potd-live-tag">LIVE</span>' : ''}
          </div>
          <div class="potd-player-name">${escapeHTML(p.name)}</div>
          <div class="potd-stats">${statLine}</div>
          <div class="potd-score-pill">Performance Score: ${escapeHTML(p.score.toFixed(1))}</div>
        </div>`;
    });
    html += '</div>';

    container.innerHTML = html;
  } catch (e) {
    console.error('NBA POTD fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load performances</div>';
  }
}

// ─── NBA SHOT COMMAND CENTER ──────────────────────────────────────────────────

async function fetchAndRenderNBAShots(games) {
  const container = document.getElementById('shots-container');
  if (!container) return;

  const activePks = (games || [])
    .filter(g => !g.isPreview)
    .map(g => g.gamePk);

  if (activePks.length === 0) {
    container.innerHTML = '<div class="empty-msg">No games in progress or completed yet today</div>';
    return;
  }

  container.innerHTML = '<div class="empty-msg">Fetching impactful shots...</div>';

  try {
    const allImpactShots = [];
    const feedPromises = activePks.map(pk =>
      requestPool.fetchDedup(`${NBA_SUMMARY_API}?event=${pk}`, { ttl: 30000 })
        .catch(e => { console.warn(`Shots: Failed to fetch game ${pk}`, e); return null; })
    );
    const feeds = await Promise.all(feedPromises);
    const gamesMap = new Map(games.map(g => [String(g.gamePk), g]));

    feeds.forEach((data, idx) => {
      if (!data) return;
      const plays = data.plays || [];
      const wp = data.winprobability || [];
      const game = gamesMap.get(String(activePks[idx]));
      if (!game) return;

      const teamIdMap = new Map();
      if (data.boxscore?.teams) {
        data.boxscore.teams.forEach(t => teamIdMap.set(String(t.team.id), t.team.abbreviation));
      }

      // BOLT OPTIMIZATION: Index win probability by playId and track numeric index for O(1) prev lookup
      const wpByPlayId = new Map(wp.map((w, i) => [w.playId, { ...w, idx: i }]));

      plays.forEach((p, pIdx) => {
        const type = p.type?.text?.toLowerCase() || '';
        const isShot = type.includes('shot') || type.includes('dunk') || type.includes('layup') || type.includes('three point');
        if (!isShot || !p.scoringPlay) return;

        const period = p.period?.number || 0;
        const clock = p.clock?.displayValue || '0:00';

        // Definition of "Impactful":
        // 1. Clutch: 4th quarter or OT, score diff <= 10
        // 2. High WPA: Win probability change >= 5% (if WP data available)
        // 3. Any 3-pointer or Dunk in a close-ish game

        const scoreDiff = Math.abs(p.awayScore - p.homeScore);
        const isClutch = (period >= 4 && scoreDiff <= 10);

        let wpa = 0;
        const wpEntry = wpByPlayId.get(p.id);
        const wpIdx = wpEntry?.idx ?? -1;
        const currentWP = wpEntry?.homeWinPercentage;
        const prevWP = (wpIdx > 0) ? wp[wpIdx - 1]?.homeWinPercentage : null;

        if (currentWP !== null && prevWP !== null) {
          wpa = Math.abs(currentWP - prevWP);
        }

        const isNotableType = type.includes('three point') || type.includes('dunk');
        const isNotable = isNotableType && scoreDiff <= 15;

        if (isClutch || wpa >= 0.05 || isNotable) {
          const teamAbbr = p.team?.abbreviation || teamIdMap.get(String(p.team?.id));
          if (teamAbbr) {
            allImpactShots.push({
              text: p.text,
              awayScore: p.awayScore,
              homeScore: p.homeScore,
              period: p.period?.displayValue,
              clock: clock,
              team: teamAbbr,
              game: `${game.awayTeam} @ ${game.homeTeam}`,
              gamePk: game.gamePk,
              wpa: wpa * 100,
              isClutch: isClutch
            });
          }
        }
      });
    });

    if (allImpactShots.length === 0) {
      container.innerHTML = '<div class="empty-msg">No high-impact shots found yet today.</div>';
      return;
    }

    // Sort by WPA and recency
    allImpactShots.sort((a, b) => b.wpa - a.wpa);

    let html = `
      <div class="hr-hero">
        <div>
          <div class="hr-hero-kicker">Shot Command Center</div>
          <div class="hr-hero-title">${allImpactShots.length} Impactful Shots</div>
          <div class="hr-hero-sub">Visualizing clutch buckets and momentum-shifting plays across the league.</div>
        </div>
      </div>
      <div class="hr-grid">`;

    allImpactShots.slice(0, 12).forEach(s => {
      const teamColor = NBA_TEAM_DATA[s.team]?.color || 'var(--gold)';
      html += `
        <div class="hr-card ${s.isClutch ? 'nuke' : 'barrel'}" onclick="openGameDrawer('${s.gamePk}')">
          <div class="hr-matchup">
            ${teamLogo(s.team)} <span style="font-weight:700;color:var(--text-main)">${s.team}</span>
            <span style="margin-left:auto;color:var(--text-dim)">${s.period} ${s.clock}</span>
          </div>
          <div class="hr-hitter">${s.text}</div>
          <div class="hr-score-change">
            ${s.game} · ${s.awayScore}-${s.homeScore}
            <span>${s.wpa > 0 ? `+${s.wpa.toFixed(1)}% WPA` : 'Clutch Performance'}</span>
          </div>
          <div class="hr-bottom-row">
             <div style="font-size: 0.65rem; color: var(--text-dim);">${s.isClutch ? '🔥 CLUTCH TIME' : '⚡ MOMENTUM SHIFT'}</div>
             <div style="width: 40px; height: 40px; background: ${teamColor}33; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${teamColor}; font-weight: 900; font-size: 0.8rem;">🏀</div>
          </div>
        </div>`;
    });
    html += '</div>';

    container.innerHTML = html;
  } catch (e) {
    console.error('NBA Shot Center fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load shots</div>';
  }
}

// ─── NBA THE DUEL ────────────────────────────────────────────────────────────

async function fetchAndRenderNBADuel(games) {
  const container = document.getElementById('duel-container');
  if (!container) return;

  const selectorHtml = `
    <div class="duel-selector-wrap">
      <div class="duel-section-title">🏀 NBA Matchup Simulator</div>
      <div class="duel-selector">
         <input type="text" id="duel-player1-search" placeholder="Search Player 1 (e.g. LeBron James)">
         <div class="duel-vs-circle">VS</div>
         <input type="text" id="duel-player2-search" placeholder="Search Player 2 (e.g. Stephen Curry)">
         <button class="btn" onclick="runNBASimulatedDuel()">Simulate Duel 🎲</button>
      </div>
      <div id="duel-sim-result-container"></div>
    </div>`;

  container.innerHTML = selectorHtml;
}

async function runNBASimulatedDuel() {
  const p1Name = document.getElementById('duel-player1-search')?.value;
  const p2Name = document.getElementById('duel-player2-search')?.value;
  const container = document.getElementById('duel-sim-result-container');

  if (!p1Name || !p2Name) {
    showNotification('Please enter both player names.', 'info');
    return;
  }

  if (container) container.innerHTML = '<div class="expand-load-msg">Simulating matchup...</div>';

  try {
    // For NBA, we'll simulate a 1-on-1 possession
    // We need some stats for these players. Since we don't have a direct "search" that returns stats,
    // we'll try to find them in the current season leaders if they exist, or just use a generic model.

    const res1 = await searchNBAPlayer(p1Name);
    const res2 = await searchNBAPlayer(p2Name);

    if (!res1 || !res2) {
      if (container) container.innerHTML = '<div class="empty-msg">Player not found. Try a full name.</div>';
      return;
    }

    const p1 = res1;
    const p2 = res2;

    // Simulation logic:
    // P1 is on offense, P2 is on defense.
    // Based on their "ratings" (simulated from PPG, etc. if available, or just random for now)

    const scoreP1 = Math.random() * 100;
    const scoreP2 = Math.random() * 100;

    let result = "";
    if (scoreP1 > scoreP2 + 20) {
      result = `${p1.name} blows past ${p2.name} for a monster dunk! 💥`;
    } else if (scoreP1 > scoreP2) {
      result = `${p1.name} hits a tough contested jumper over ${p2.name}. 🏀`;
    } else if (scoreP2 > scoreP1 + 20) {
      result = `${p2.name} absolutely swats ${p1.name}'s shot! 🚫`;
    } else {
      result = `${p1.name} misses the shot under heavy pressure from ${p2.name}. 🛡️`;
    }

    container.innerHTML = `
      <div class="sim-result-wrap">
        <div class="sim-result" style="grid-column: span 2;">
          <div class="sim-label">SIMULATED POSSESSION</div>
          <div class="sim-val">${result}</div>
          <div class="sim-odds">
            Matchup: <strong>${p1.name}</strong> vs <strong>${p2.name}</strong>
          </div>
        </div>
      </div>`;

  } catch (e) {
    console.error('NBA Duel simulation failed:', e);
    if (container) container.innerHTML = 'Simulation failed';
  }
}

async function searchNBAPlayer(name) {
  // Try to find in cache first
  const cacheKey = `nbaPlayerSearch:${name}`;
  const cached = persistentCache.get(cacheKey);
  if (cached) return cached;

  // Since there's no easy player search in the ESPN API that returns stats directly,
  // we'll use the athletes endpoint if we can find an ID, or just mock it.
  // Real implementation would hit a search API.
  return { name: name, id: Math.random() };
}

function renderWinProbSparkline(game) {
  const series = game.winProbSeries || [];
  if (series.length < 2) return '';
  const w = 180, h = 34, pad = 3;
  const path = series.map((p, i) => {
    const x = pad + (i / Math.max(series.length - 1, 1)) * (w - pad * 2);
    const y = pad + (Math.max(0, Math.min(100, p.home)) / 100) * (h - pad * 2);
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = series[series.length - 1]?.home;
  const label = typeof last === 'number' ? `${game.homeTeam} ${Math.round(last)}%` : 'Win probability';
  return `<div class="wp-sparkline" title="Win probability">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" />
      <path d="${path}" />
    </svg>
    <span>${label}</span>
  </div>`;
}

async function fetchPlayerHeatNBA(playerId, statKey) {
  // Mocking last 10 games performance
  // In a real scenario, we'd fetch player game logs
  const heat = [];
  for (let i = 0; i < 10; i++) {
    heat.push(Math.random() > 0.5 ? 1 : 0);
  }
  return heat;
}

window.runNBASimulatedDuel = runNBASimulatedDuel;
