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
let selectedDate = todayET();

// ─── TEAM DATA HELPERS ────────────────────────────────────────────────────────

function teamLogo(abbr) {
  return `<img class="team-logo" src="https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png" alt="${abbr} logo" onerror="this.style.display='none'">`;
}

function teamColor(abbr) {
  return NBA_TEAM_DATA[abbr]?.color || 'var(--text-dim)';
}

function isRivalry(a, b) {
  return NBA_RIVALRY_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
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
}

// ─── DATA FETCHING ───────────────────────────────────────────────────────────

async function fetchNBAScoreboard() {
  const dateStr = (selectedDate || todayET()).replace(/-/g, '');
  try {
    const url = `${NBA_API}?dates=${dateStr}`;
    const data = await requestPool.fetchDedup(url, { ttl: 15000 });
    if (!data.events) return [];

    return data.events.map(e => {
      const game = e.competitions[0];
      const away = game.competitors.find(c => c.homeAway === 'away');
      const home = game.competitors.find(c => c.homeAway === 'home');
      const status = e.status.type;

      const obj = {
        gamePk: e.id,
        awayTeam: away.team.abbreviation,
        homeTeam: home.team.abbreviation,
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

      obj.watchabilityBreakdown = calculateNBAWatchability(obj);
      obj.watchabilityIndex = obj.watchabilityBreakdown.score;
      return obj;
    });
  } catch (e) {
    console.error('NBA Scoreboard fetch failed:', e);
    return [];
  }
}

async function fetchNBAStandings() {
    const container = document.getElementById('standings-container');
    if (!container) return;

    // ESPN doesn't have a simple standalone standings endpoint easily accessible like this,
    // but we can often find it or just show a message. For barebones, we'll use the records
    // we've collected from the scoreboard or show a placeholder.

    if (Object.keys(teamRecords).length === 0) {
        container.innerHTML = '<div class="empty-msg">Start polling to see team records from today\'s games.</div>';
        return;
    }

    let html = '<div class="playoff-races"><div class="standings-division"><div class="standings-div-title">League Records (from today\'s scoreboard)</div>';
    html += '<table class="standings-table"><thead><tr><th>Team</th><th>Record</th><th>Win %</th></tr></thead><tbody>';

    Object.entries(teamRecords)
        .sort(([,a], [,b]) => b.winPct - a.winPct)
        .forEach(([abbr, rec]) => {
            html += `<tr>
                <td class="team-name">${teamLogo(abbr)} ${abbr}</td>
                <td>${rec.record}</td>
                <td>${rec.winPct.toFixed(3)}</td>
            </tr>`;
        });
    html += '</tbody></table></div></div>';
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

  const context = Math.min(teamQ + rivalBonus + 10, cfg.caps.context); // +10 base context

  if (g.isPreview) {
    const raw = cfg.bases.preview + Math.round(context * cfg.scaling.previewContext);
    return { score: clamp(raw), parts: [{ label: 'Teams', value: teamQ }, { label: 'Rivalry', value: rivalBonus }] };
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

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-msg">No games matching criteria</div>';
    return;
  }

  grid.innerHTML = filtered.map(game => {
    const wi = game.watchabilityIndex;
    const isSpoilered = (spoilerTeams.has(game.awayTeam) || spoilerTeams.has(game.homeTeam)) && !revealedGames.has(game.gamePk);
    const homeColor = teamColor(game.homeTeam);
    const cardClass = `game-card${wi > 75 ? ' fire' : wi > 55 ? ' hot' : ''}`;

    if (isSpoilered) {
      return `
        <div class="${cardClass}" style="border-left: 6px solid ${homeColor}">
          <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
          <div class="inning-line" style="color:var(--text-dim)">Spoiler Mode</div>
          <div class="spoiler-mask" onclick="revealSpoiler(this, '${game.gamePk}')">🙈 Tap to reveal</div>
        </div>`;
    }

    return `
      <div class="${cardClass}" style="border-left: 6px solid ${homeColor}; background-image: linear-gradient(to right, ${homeColor}11, transparent)">
        <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
        <div class="score-line">${game.awayScore} - ${game.homeScore}</div>
        <div class="inning-line">${game.periodStatus}</div>
        <div class="watch-bar-wrap">
          <div class="watch-bar-label"><span>Watchability</span><span class="score-num">${wi}</span></div>
          <div class="watch-bar-bg"><div class="watch-bar-fill" style="width:${wi}%"></div></div>
        </div>
        <div class="score-breakdown">
          ${game.watchabilityBreakdown.parts.map(p => `<span class="score-chip">${p.label} +${p.value}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
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
    return `<div class="team-toggle${isSpoiled ? ' spoilered' : ''}" onclick="toggleSpoilerTeam('${abbr}')">
      ${teamLogo(abbr)} <span>${abbr}</span>
    </div>`;
  }).join('');
}

function renderFavoriteGrid() {
  const grid = document.getElementById('favorite-team-grid');
  if (!grid) return;
  grid.innerHTML = Object.keys(NBA_TEAM_DATA).sort().map(abbr => {
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
    const games = await fetchNBAScoreboard();
    lastGames = games;
    renderGames(games);
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

function setGameDate(d) {
  selectedDate = d;
  if (polling) pollGames();
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

// Global attachment
window.switchTab = switchTab;
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
