/*    Uses the ESPN NBA API
   ─────────────────────────────────────────────────────────────────────────── */

const favoriteTeams = new Set(loadPrefs().favoriteTeamsNBA || []);
const spoilerTeams = new Set(loadPrefs().spoilerTeamsNBA || []);
const revealedGames = new Set();
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
  return `<img class="team-logo" src="https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png" alt="${abbr} logo" onerror="this.style.display='none'">`;
}

function teamColor(abbr) {
  return NBA_TEAM_DATA[abbr]?.color || 'var(--text-dim)';
}

function isRivalry(a, b) {
  return NBA_RIVALRY_SET.has(a < b ? a + '-' + b : b + '-' + a);
}

// ─── TABS ────────────────────────────────────────────────────────────────────

function switchTab(tab) {
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

  if (tab === 'standings') fetchNBAStandings();
  if (tab === 'games') fetchNBALeaders();
  if (tab === 'milestones') {
    const milestones = window.lastNBAMilestones;
    if (milestones) renderMilestoneBoard(milestones);
    else fetchNBAMilestones();
  }
}

// ─── DATA FETCHING ───────────────────────────────────────────────────────────

async function fetchNBAScoreboard() {
    const dateStr = (selectedDate || todayET()).replace(/-/g, '');
    try {
        const url = `${NBA_API}?dates=${dateStr}`;
        const data = await requestPool.fetchDedup(url, { ttl: 15000 });

        if (isFirstLoad && data.events) {
            nbaStarTeams = fetchNBAStarPower(data.events);
            fetchNBAStandings();
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
        isPreview: status.state === 'pre'
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

      todayTeams.add(obj.awayTeam);
      todayTeams.add(obj.homeTeam);
      if (obj.isLive) {
        liveTeams.add(obj.awayTeam);
        liveTeams.add(obj.homeTeam);
      }

      obj.watchabilityBreakdown = calculateNBAWatchability(obj);
      obj.watchabilityIndex = obj.watchabilityBreakdown.score;

      todayTeams.add(obj.awayTeam);
      todayTeams.add(obj.homeTeam);
      if (obj.isLive) {
        liveTeams.add(obj.awayTeam);
        liveTeams.add(obj.homeTeam);
      }

      return obj;
    });
}

async function fetchNBAStandings() {
    const container = document.getElementById('standings-container');
    if (container && (isFirstLoad || container.querySelector('.empty-msg'))) {
        container.innerHTML = '<div class="empty-msg">Loading standings...</div>';
    }

    try {
        const season = getNBASeason(selectedDate);
        const dateParam = selectedDate.replace(/-/g, '');
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
                const winPct = stats.find(s => s.type === 'winpercent')?.value || 0;
                const record = stats.find(s => s.type === 'total')?.summary || '0-0';

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
        const sortedEntries = [...conf.standings.entries].sort((a, b) => {
            const pctA = a.stats.find(s => s.type === 'winpercent')?.value || 0;
            const pctB = b.stats.find(s => s.type === 'winpercent')?.value || 0;
            if (pctB !== pctA) return pctB - pctA;

            const winsA = a.stats.find(s => s.type === 'wins')?.value || 0;
            const winsB = b.stats.find(s => s.type === 'wins')?.value || 0;
            if (winsB !== winsA) return winsB - winsA;

            const diffA = a.stats.find(s => s.type === 'pointdifferential')?.value || 0;
            const diffB = b.stats.find(s => s.type === 'pointdifferential')?.value || 0;
            return diffB - diffA;
        });

        sortedEntries.forEach((entry, idx) => {
            const team = entry.team;
            const stats = entry.stats;
            const wins = stats.find(s => s.type === 'wins')?.displayValue || '0';
            const losses = stats.find(s => s.type === 'losses')?.displayValue || '0';
            const pct = stats.find(s => s.type === 'winpercent')?.displayValue || '.000';
            const gb = stats.find(s => s.type === 'gamesbehind')?.displayValue || '-';
            const streak = stats.find(s => s.type === 'streak')?.displayValue || '-';
            const l10 = stats.find(s => s.type === 'lasttengames')?.displayValue || '-';
            const seed = idx + 1;

            const isPlayoff = seed <= 10;
            const clinch = stats.find(s => s.type === 'clincher')?.displayValue || '';

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
  const rival = isRivalry(g.awayTeam, g.homeTeam);

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
    const targetClass = `game-card${wi > 75 ? ' fire' : wi > 55 ? ' hot' : ''}`;

    if (!card) {
      card = document.createElement('div');
      card.setAttribute('data-gpk', pkStr);
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
  const stateKey = `${game.awayScore}-${game.homeScore}-${game.periodStatus}-${wi}`;
  if (card._lastStateKey === stateKey) return;
  card._lastStateKey = stateKey;

  card.innerHTML = `
    <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
    <div class="score-line">${game.awayScore} - ${game.homeScore}</div>
    <div class="inning-line">${game.periodStatus}</div>
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

    const activeTab = document.querySelector('.tab-btn.active')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (activeTab === 'games') fetchNBALeaders();
    if (activeTab === 'milestones') fetchNBAMilestones();

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

async function openGameDrawer(pk) {
  const drawer = document.getElementById('game-drawer');
  const title = document.getElementById('drawer-title');
  const body = document.getElementById('drawer-body');
  const game = lastGames?.find(g => String(g.gamePk) === String(pk));

  if (!game) return;

  title.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
  body.innerHTML = '<div class="expand-load-msg">Loading game summary (Stub)...</div>';
  drawer.classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');

  // Future: fetch real data from ESPN here
}

function closeGameDrawer() {
  document.getElementById('game-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

function openSidePanel(pk) {
    const panel = document.getElementById('side-panel');
    const title = document.getElementById('side-panel-title');
    const body = document.getElementById('side-panel-body');
    const game = lastGames?.find(g => String(g.gamePk) === String(pk));

    if (!game) return;

    title.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
    body.innerHTML = '<div class="expand-load-msg">Loading detailed metrics (Stub)...</div>';
    panel.classList.add('open');
}

function closeSidePanel() {
    document.getElementById('side-panel').classList.remove('open');
}

// Global attachment
window.fetchNBALeaders = fetchNBALeaders;
async function fetchNBALeaders() {
  const container = document.getElementById('leaders-container');
  const title = document.getElementById('tab-leaders')?.querySelector('.section-title');
  if (!container) return;
  if (isFirstLoad || container.querySelector('.empty-msg')) {
    container.innerHTML = '<div class="empty-msg">Loading leaders...</div>';
  }

  try {
    const season = getNBASeason(selectedDate);
    // Replace the year segment in the URL (e.g., .../seasons/2024/...) with the current season
    const url = NBA_LEADERS_API.replace(/\/seasons\/\d+\//, `/seasons/${season}/`);
    const data = await requestPool.fetchDedup(url, { ttl: 3600000 });
    if (!data || !data.categories) {
      container.innerHTML = '<div class="empty-msg">Leaders data currently unavailable.</div>';
      return;
    }

    const targetNames = NBA_LEADER_DEFS.map(d => d.name);
    const filteredCats = data.categories.filter(c => targetNames.includes(c.name));

    const results = await Promise.all(filteredCats.map(async cat => {
      const topLeader = cat.leaders[0];
      if (!topLeader) return null;

      const [athlete, team] = await Promise.all([
        resolveAthleteRef(topLeader.athlete.$ref),
        resolveTeamRef(topLeader.team.$ref)
      ]);

      const def = NBA_LEADER_DEFS.find(d => d.name === cat.name);
      return {
        label: def ? def.label : cat.shortDisplayName,
        name: athlete.displayName,
        team: team.abbreviation,
        value: topLeader.displayValue
      };
    }));

    renderNBALeaders(results.filter(Boolean));
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
  return 'Season';
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

    // Prominent Career Milestones (Static for now as ESPN API for career stats is complex)
    allMilestones.push({
      name: 'LeBron James',
      team: 'LAL',
      stat: 'Career Points',
      current: '40,474',
      next: '41,000',
      progress: 98,
      importance: 'Historic',
      urgency: 'This season',
      priority: 100
    });

    if (data && data.categories) {
      const candidateRefs = new Set();
      const candidates = [];
      // BOLT: Index categories by name for O(1) lookup
      const categoryMap = new Map(data.categories.map(c => [c.name, c]));

      await Promise.all(NBA_MILESTONE_DEFS.map(async def => {
        const cat = categoryMap.get(def.api);
        if (!cat) return;

        // Take top 10 from each category to look for milestones
        const topLeaders = cat.leaders.slice(0, 10);
        topLeaders.forEach(leader => {
          const val = parseStatValue(leader.value);
          const next = def.milestones.find(m => m > val);
          if (!next) return;
          const diff = next - val;
          if (diff > (def.lookahead || 100)) return;

          candidateRefs.add(leader.athlete.$ref);
          candidateRefs.add(leader.team.$ref);
          candidates.push({ leader, def, next, diff });
        });
      }));

      // 2. Batch-resolve all unique athlete and team references in parallel
      const refMap = new Map();
      const refPromises = Array.from(candidateRefs).map(async ref => {
        const resolved = ref.includes('/athletes/') ? await resolveAthleteRef(ref) : await resolveTeamRef(ref);
        refMap.set(ref, resolved);
      });
      await Promise.all(refPromises);

      // 3. Map candidates to milestone objects
      candidates.forEach(({ leader, def, next, diff }) => {
        const athlete = refMap.get(leader.athlete.$ref);
        const team = refMap.get(leader.team.$ref);
        if (!athlete || !team) return;

        allMilestones.push({
          id: athlete.id,
          name: athlete.displayName,
          team: team.abbreviation,
          stat: def.label,
          current: leader.displayValue,
          next: next,
          diff: diff,
          icon: def.icon,
          playingNow: liveTeams.has(team.abbreviation),
          playingToday: todayTeams.has(team.abbreviation)
        });
      });
    }

    allMilestones.forEach(m => {
      m.importance = milestoneImportance(m);
      m.urgency = milestoneUrgency(m);
      m.priority = milestonePriority(m);
      m.progress = milestoneProgress(m);
      m.paceText = milestonePaceText(m);
    });

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

  container.innerHTML = `
    <div class="milestone-hero">
      <div class="milestone-hero-main">
        <div class="milestone-hero-kicker">NBA Chase Board</div>
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
