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
    const games = data.games || (data.gamesByDate ? data.gamesByDate.find(d => d.date === date)?.games : null);
    if (!games) return [];

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

async function fetchNHLStandings() {
  const container = document.getElementById('standings-container');
  if (container && isFirstLoad) container.innerHTML = '<div class="empty-msg">Loading standings...</div>';

  try {
    const data = await requestPool.fetchDedup(`${NHL_API}/standings/now`, { ttl: 300000 });
    const records = {};

    data.standings.forEach(t => {
      const abbr = t.teamAbbrev.default;
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
        l10OtLosses: t.l10OtLosses
      };
    });

    teamRecords = records;
    if (container) renderNHLStandings(data.standings);
  } catch (e) {
    console.error('NHL Standings fetch failed:', e);
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

  let upsetBonus = 0;
  if (!isPreview) {
    const diff = teamQA - teamQH;
    if (diff > 0.15 && g.homeScore > g.awayScore) upsetBonus = cfg.context.upset;
    if (diff < -0.15 && g.awayScore > g.homeScore) upsetBonus = cfg.context.upset;
  }

  const context = Math.min(teamQ + playoffScore + rivalBonus + upsetBonus, cfg.caps.context);
  const parts = [
    { label: 'Teams', value: teamQ },
    { label: 'Playoff', value: playoffScore },
    { label: 'Rivalry', value: rivalBonus },
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

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-msg">No games matching criteria</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach(game => {
    let card = document.createElement('div');
    card.setAttribute('data-gpk', game.gamePk);
    card.className = `game-card${game.watchabilityIndex > 75 ? ' fire' : game.watchabilityIndex > 55 ? ' hot' : ''}`;

    const isSpoilered = (spoilerTeams.has(game.awayTeam) || spoilerTeams.has(game.homeTeam)) && !revealedGames.has(game.gamePk);

    if (isSpoilered) {
       card.innerHTML = `
        <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
        <div class="inning-line" style="color:var(--text-dim)">Spoiler Mode</div>
        <div class="spoiler-mask" onclick="revealSpoiler(this, ${game.gamePk})">🙈 Tap to reveal</div>
      `;
    } else {
      renderSingleGameCard(card, game);
    }

    const homeColor = teamColor(game.homeTeam);
    card.style.borderLeft = `6px solid ${homeColor}`;
    card.style.backgroundImage = `linear-gradient(to right, ${homeColor}11, transparent)`;

    fragment.appendChild(card);
  });

  grid.innerHTML = '';
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
    <button class="card-expand-toggle" onclick="openGameDrawer(${game.gamePk})">Details</button>
  `;
}

function renderNHLStandings(standings) {
  const container = document.getElementById('standings-container');
  if (!container) return;

  let html = '<table class="standings-table"><thead><tr><th>Team</th><th>W</th><th>L</th><th>OT</th><th>PTS</th><th>P%</th><th>STRK</th></tr></thead><tbody>';
  standings.forEach(t => {
    const abbr = t.teamAbbrev.default;
    html += `<tr>
      <td class="team-name">${teamLogo(abbr)} ${abbr}</td>
      <td>${t.wins}</td>
      <td>${t.losses}</td>
      <td>${t.otLosses}</td>
      <td><strong>${t.points}</strong></td>
      <td>${t.pointPctg.toFixed(3)}</td>
      <td>${t.streakCode}${t.streakCount}</td>
    </tr>`;
  });
  html += '</tbody></table>';
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
      await fetchNHLStandings();
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
  const game = lastGames.find(g => g.gamePk === pk);

  title.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
  body.innerHTML = '<div class="expand-load-msg">Loading PBP details...</div>';
  drawer.classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');

  try {
    const data = await requestPool.fetchDedup(`${NHL_API}/gamecenter/${pk}/play-by-play`);
    let pbp = '<div class="expand-plays">';
    data.plays.slice(-10).reverse().forEach(p => {
       pbp += `<div class="expand-play">
         <span class="expand-play-inn">${p.timeInPeriod}</span>
         <span class="expand-play-desc">${p.typeDescKey.toUpperCase()}: ${p.details?.desc || p.typeDescKey}</span>
       </div>`;
    });
    pbp += '</div>';
    body.innerHTML = pbp;
  } catch(e) {
    body.innerHTML = 'Failed to load play-by-play';
  }
}

function closeGameDrawer() {
  document.getElementById('game-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}
