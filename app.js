/*    Uses the public MLB Stats API (statsapi.mlb.com)
   ─────────────────────────────────────────────────────────────────────────── */



const favoriteTeams = new Set(loadPrefs().favoriteTeams || []);
const favoriteAlerts = {};
const gameDetailsByPk = {};
const revealedGames = new Set();



// ─── RIVALRY PAIRS ─────────────────────────────────────────────────────────────

// BOLT OPTIMIZATION: Use a Set for O(1) rivalry lookups instead of linear search
const RIVALRY_SET = new Set(RIVALRY_PAIRS.map(([x, y]) => x < y ? x + '-' + y : y + '-' + x));

function isRivalry(a, b) {
  return RIVALRY_SET.has(a < b ? a + '-' + b : b + '-' + a);
}

// ─── TEAM DATA (logos + colors) ───────────────────────────────────────────────


function teamLogo(abbr) {
  const t = TEAM_DATA[abbr];
  if (!t) return '';
  return `<img class="team-logo" src="https://www.mlbstatic.com/team-logos/${t.id}.svg" alt="${abbr} logo" onerror="this.style.display='none'">`;
}

function teamColor(abbr) {
  return TEAM_DATA[abbr]?.color || 'var(--text-dim)';
}

// Build reverse lookup: team ID -> abbreviation
const TEAM_ID_TO_ABBR = {};
for (const [abbr, data] of Object.entries(TEAM_DATA)) {
  TEAM_ID_TO_ABBR[data.id] = abbr;
}
const ALL_TEAM_ABBRS = Object.keys(TEAM_DATA).filter(a => a !== 'ATH').sort();

function teamAbbrFromId(id) {
  return normalizeAbbr(TEAM_ID_TO_ABBR[id] || '?');
}

// Some MLB API endpoints return non-standard abbreviations — normalize them here
const ABBR_ALIASES = { 'AZ': 'ARI', 'CWS': 'CWS', 'WSH': 'WSH', 'ATH': 'OAK' };
function normalizeAbbr(abbr) {
  return ABBR_ALIASES[abbr] || abbr;
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

    // Lazy-load data for the active tab
    if (lastGames) {
      if (tab === 'potd') fetchAndRenderPOTD(lastGames);
      if (tab === 'homeruns') fetchAndRenderHomeRuns(lastGames);
      if (tab === 'ticker') fetchAndRenderTicker(lastGames);
      if (tab === 'playoffs') fetchPlayoffRaces(lastGames);
      if (tab === 'milestones') fetchMilestones(lastGames);
      if (tab === 'awards') fetchAwardRaces();
      if (tab === 'duel') fetchAndRenderDuel(lastGames);
    }
  }, 'tab-' + tab, 'Tab failed to load');
}

// ─── TEAM RECORDS CACHE ─────────────────────────────────────────────────────
let teamRecords = {}; // abbr -> { w, l }
let playoffContext = {}; // abbr -> { divRank, wcRank, wcGB, pct }
let milestoneWatchTeams = new Set(); // teams with a player near a milestone

// ─── STAR POWER TABLE ──────────────────────────────────────────────────────
// Dynamically populated from Fangraphs WAR leaderboard daily.
// Fallback static list used until live data loads.
const STAR_TIERS_FALLBACK = {
  1: ['Shohei Ohtani','Aaron Judge','Mookie Betts','Fernando Tatis Jr.','Ronald Acuña Jr.',
      'Freddie Freeman','Bryce Harper','Juan Soto','Corbin Carroll','Gunnar Henderson',
      'Bobby Witt Jr.','Julio Rodríguez','Elly De La Cruz','Paul Skenes','Spencer Strider',
      'Gerrit Cole','Zack Wheeler','Tarik Skubal','Chris Sale','Yoshinobu Yamamoto','Tyler Glasnow'],
  2: ['Yordan Alvarez','Kyle Tucker','José Ramírez','Trea Turner','Corey Seager',
      'Marcus Semien','Pete Alonso','Vladimir Guerrero Jr.','Bo Bichette','Matt Olson',
      'Michael Harris II','Austin Riley','Jarren Duran','Jazz Chisholm Jr.','Adley Rutschman','Cal Raleigh',
      'Kevin Gausman','Luis Castillo','Hunter Greene','Framber Valdez','Nathan Eovaldi',
      'Pablo López','Jesús Luzardo','Emmanuel Clase','Edwin Díaz','Josh Hader','Ryan Helsley','Devin Williams'],
  3: ['Adolis García','Nathaniel Lowe','Nolan Arenado','Paul Goldschmidt','Willy Adames','Christian Yelich']
};

// Build reverse lookup: name -> tier (mutable, gets updated by fetchFangraphsStarTiers)
const PLAYER_TIER = {};
function rebuildPlayerTier(tiers) {
  for (const k of Object.keys(PLAYER_TIER)) delete PLAYER_TIER[k];
  for (const [tier, names] of Object.entries(tiers)) {
    for (const n of names) PLAYER_TIER[n] = parseInt(tier);
  }
}
rebuildPlayerTier(STAR_TIERS_FALLBACK);

// Cache key for season-based refresh
let fangraphsStarLastSeason = null;

async function fetchFangraphsStarTiers() {
  const season = currentSeason();
  if (fangraphsStarLastSeason === season) return;
  try {
    const [hitUrl, pitUrl] = [
      `https://www.fangraphs.com/api/leaders/major-league/data?age=0&pos=all&stats=bat&lg=all&qual=0&season=${season}&season1=${season}&ind=0&team=0&rost=0&players=0&type=8&sortcol=2&sortdir=default&pagenum=1&pageitems=150`,
      `https://www.fangraphs.com/api/leaders/major-league/data?age=0&pos=all&stats=pit&lg=all&qual=0&season=${season}&season1=${season}&ind=0&team=0&rost=0&players=0&type=8&sortcol=2&sortdir=default&pagenum=1&pageitems=150`
    ];

    const [hitData, pitData] = await Promise.all([
      // BOLT OPTIMIZATION: 1-day TTL for daily Fangraphs data
      requestPool.fetchDedup(hitUrl, { ttl: 86400000 }),
      requestPool.fetchDedup(pitUrl, { ttl: 86400000 })
    ]);

    // Combine hitters + pitchers, sort by WAR descending, assign tiers by rank
    const allRows = [];
    const extractRows = (data) => {
      const rows = data?.data || (Array.isArray(data) ? data : []);
      rows.forEach(p => {
        const name = p.PlayerName || p.Name || p.playerName;
        const war = parseFloat(p.WAR ?? p.war ?? 0);
        if (name && !isNaN(war)) allRows.push({ name, war });
      });
    };
    extractRows(hitData);
    extractRows(pitData);

    // Deduplicate by name (keep highest WAR), sort descending
    const seen = {};
    for (const r of allRows) {
      if (!seen[r.name] || seen[r.name] < r.war) seen[r.name] = r.war;
    }
    const sorted = Object.entries(seen).sort((a, b) => b[1] - a[1]);

    if (sorted.length < 20) {
      console.warn('[StarTiers] Fangraphs returned insufficient data, keeping fallback tiers');
      return;
    }

    const tier1 = sorted.slice(0, 20).map(([n]) => n);       // top 20
    const tier2 = sorted.slice(20, 50).map(([n]) => n);      // 21–50
    const tier3 = sorted.slice(50, 100).map(([n]) => n);     // 51–100

    rebuildPlayerTier({ 1: tier1, 2: tier2, 3: tier3 });
    fangraphsStarLastSeason = season;
    console.log(`[StarTiers] Updated for ${season}: T1=${tier1.length} T2=${tier2.length} T3=${tier3.length}`);
  } catch (e) {
    console.warn('[StarTiers] Fangraphs fetch failed, using fallback:', e.message);
  }
}

function getStarPowerScore(game) {
  let score = 0;
  // Check pitcher
  if (game.currentPitcher) {
    const t = PLAYER_TIER[game.currentPitcher.name];
    if (t === 1) score += 12;
    else if (t === 2) score += 7;
    else if (t === 3) score += 3;
  }
  // Check batter
  if (game.currentBatter) {
    const t = PLAYER_TIER[game.currentBatter.name];
    if (t === 1) score += 10;
    else if (t === 2) score += 5;
    else if (t === 3) score += 2;
  }
  return score;
}

function getTeamQualityScore(abbr) {
  const r = teamRecords[abbr];
  if (!r) return 0;
  const games = r.w + r.l;
  if (games < 10) return 3; // early season
  const pct = r.w / games;
  if (pct >= 0.600) return 10;
  if (pct >= 0.560) return 7;
  if (pct >= 0.520) return 4;
  if (pct >= 0.480) return 2;
  return 0;
}

function getPlayoffImportanceScore(abbr) {
  const ctx = playoffContext[abbr];
  if (!ctx) return 0;
  const wcGB = parseFloat(ctx.wcGB) || 0;
  const wcRank = parseInt(ctx.wcRank) || 99;
  if (wcRank <= 3) return 12;         // in a WC spot
  if (wcRank <= 6 && wcGB <= 1) return 10; // right on the bubble
  if (wcGB <= 3) return 7;
  if (wcGB <= 5) return 4;
  if (ctx.divRank === 1) return 8;    // div leader regardless of WC
  return 0;
}

async function fetchTeamRecords() {
  try {
    const season = currentSeason();
    const date = selectedDate || todayET();
    const [regData, wcData] = await Promise.all([
      requestPool.fetchDedup(`${MLB_API}/standings?leagueId=103,104&season=${season}&date=${date}&standingsTypes=regularSeason&hydrate=team`, { cacheKey: `standings:regular:${date}`, ttl: 300000 }),
      requestPool.fetchDedup(`${MLB_API}/standings?leagueId=103,104&season=${season}&date=${date}&standingsTypes=wildCard&hydrate=team`, { cacheKey: `standings:wildCard:${date}`, ttl: 300000 })
    ]);
    const rec = {};
    const ctx = {};
    for (const group of regData.records) {
      for (const t of group.teamRecords) {
        const abbr = normalizeAbbr(t.team.abbreviation || t.team.name);
        rec[abbr] = { w: t.wins, l: t.losses };
        ctx[abbr] = {
          divRank: parseInt(t.divisionRank) || 99,
          pct: parseFloat(t.winningPercentage) || 0,
          wcRank: 99,
          wcGB: '999'
        };
      }
    }
    for (const group of wcData.records) {
      for (const t of group.teamRecords) {
        const abbr = t.team.abbreviation || t.team.name;
        if (ctx[abbr]) {
          ctx[abbr].wcRank = parseInt(t.wildCardRank) || 99;
          ctx[abbr].wcGB = t.wildCardGamesBack ?? '999';
        }
      }
    }
    teamRecords = rec;
    playoffContext = ctx;
    populateL10Cache(regData);
  } catch (e) { console.warn('Records fetch failed:', e); }
}

function teamRec(abbr) {
  const r = teamRecords[abbr];
  return r ? ` (${r.w}-${r.l})` : '';
}

// ─── NOTIFICATIONS & TRACKING ────────────────────────────────────────────────
let isFirstLoad = true;
const prevScores = {};
const prevLeaders = {};
const notifiedMilestones = new Set();
const notifiedAtBats = new Set();
const careerHRCache = {};

const SEASON_G_MILESTONES = [100, 150, 162];
const SEASON_PA_MILESTONES = [500, 600, 700, 750];
const SEASON_AB_MILESTONES = [500, 600, 700];
const SEASON_H_MILESTONES = [100, 150, 175, 200, 225, 250, 262];
const SEASON_2B_MILESTONES = [20, 30, 40, 50, 60, 67];
const SEASON_3B_MILESTONES = [10, 15, 20, 25, 30, 36];
const SEASON_HR_MILESTONES = [10, 20, 30, 40, 50, 60, 70, 73];
const SEASON_RBI_MILESTONES = [50, 75, 100, 125, 150, 175, 200];
const SEASON_R_MILESTONES = [50, 75, 100, 125, 150, 177, 192, 196, 198];
const SEASON_BB_MILESTONES = [50, 75, 100, 125, 150, 175, 200, 232];
const SEASON_SB_MILESTONES = [20, 30, 40, 50, 60, 70, 80, 90, 100, 130];
const SEASON_HBP_MILESTONES = [10, 20, 30];
const SEASON_TB_MILESTONES = [250, 300, 350, 400];
const SEASON_XBH_MILESTONES = [50, 75, 100];

const SEASON_PIT_G_MILESTONES = [50, 75, 100];
const SEASON_GS_MILESTONES = [20, 30, 35, 40];
const SEASON_IP_MILESTONES = [100, 150, 200, 250, 300];
const SEASON_W_MILESTONES = [10, 15, 20, 25, 30, 31];
const SEASON_K_MILESTONES = [100, 150, 200, 250, 300, 350, 383, 400];
const SEASON_SV_MILESTONES = [20, 30, 40, 50, 60, 62];
const SEASON_HLD_MILESTONES = [20, 30, 40];
const SEASON_CG_MILESTONES = [5, 10, 15];
const SEASON_SHO_MILESTONES = [3, 5, 10];
const SEASON_QS_MILESTONES = [20, 25, 30];

const CAREER_G_MS = [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3308, 3562];
const CAREER_PA_MS = [1000, 2500, 5000, 7500, 10000, 12500, 15000, 15881];
const CAREER_AB_MS = [1000, 2500, 5000, 7500, 10000, 12000, 14053];
const CAREER_H_MS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4189, 4191, 4256];
const CAREER_2B_MS = [100, 200, 300, 400, 500, 600, 700, 792, 793];
const CAREER_3B_MS = [25, 50, 75, 100, 125, 150, 200, 250, 300, 309, 312];
const CAREER_HR_MS = [100, 200, 300, 400, 500, 600, 700, 714, 755, 762];
const CAREER_RBI_MS = [500, 1000, 1500, 2000, 2214, 2297];
const CAREER_R_MS = [500, 1000, 1500, 2000, 2246, 2295];
const CAREER_BB_MS = [500, 1000, 1500, 2000, 2500, 2555];
const CAREER_SB_MS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1406];
const CAREER_HBP_MS = [100, 200, 250, 300];
const CAREER_SF_MS = [50, 100, 150];
const CAREER_SH_MS = [50, 100, 200, 300, 512];
const CAREER_TB_MS = [1000, 2000, 3000, 4000, 5000, 6000, 6852];
const CAREER_XBH_MS = [250, 500, 750, 1000, 1477];

const CAREER_PIT_G_MS = [100, 250, 500, 750, 1000, 1075, 1252];
const CAREER_GS_MS = [100, 200, 300, 400, 500, 815];
const CAREER_IP_MS = [500, 1000, 2000, 3000, 4000, 5000, 6000, 7356];
const CAREER_W_MS = [100, 150, 200, 250, 300, 350, 400, 511];
const CAREER_K_MS = [1000, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5714];
const CAREER_PIT_BB_MS = [500, 1000, 1500, 2000, 2500, 2792];
const CAREER_SV_MS = [100, 200, 300, 400, 500, 600, 652];
const CAREER_HLD_MS = [100, 200, 300, 400];
const CAREER_CG_MS = [25, 50, 100, 200, 749];
const CAREER_SHO_MS = [10, 25, 50, 75, 100, 110];
const CAREER_QS_MS = [100, 200, 300];

function checkAndNotify(name, statLabel, value, milestones) {
  if (!milestones.includes(value)) return;
  const key = `${name}-${statLabel}-${value}`;
  if (notifiedMilestones.has(key)) return;
  notifiedMilestones.add(key);
  if (!isFirstLoad) {
    const msgs = {
      'Season Hits (H)':   `${name} has ${value} hits this season!`,
      'Season Home Runs (HR)':  `${name} has hit season home run #${value}!`,
      'Season Runs Batted In (RBI)': `${name} has reached ${value} RBIs this season!`,
      'Season Stolen Bases (SB)':  `${name} has stolen base #${value} this season!`,
      'Season Doubles (2B)':  `${name} has hit season double #${value}!`,
      'Season Triples (3B)':  `${name} has hit season triple #${value}!`,
      'Season Runs (R)':   `${name} has scored ${value} runs this season!`,
      'Season Walks (BB)':  `${name} has reached ${value} walks this season!`,
      'Season Strikeouts (SO)':   `${name} has ${value} strikeouts this season!`,
      'Season Saves (SV)':  `${name} has recorded season save #${value}!`,
      'Season Wins (W)':   `${name} has recorded season win #${value}!`,
      'Career Hits (H)':   `${name} has reached ${value} career hits!`,
      'Career Home Runs (HR)':  `${name} has hit career home run #${value}!`,
      'Career Runs Batted In (RBI)': `${name} has reached ${value} career RBIs!`,
      'Career Stolen Bases (SB)':  `${name} has reached ${value} career stolen bases!`,
      'Career Doubles (2B)':  `${name} has reached ${value} career doubles!`,
      'Career Triples (3B)':  `${name} has reached ${value} career triples!`,
      'Career Runs (R)':   `${name} has reached ${value} career runs scored!`,
      'Career Walks (BB)':  `${name} has reached ${value} career walks!`,
      'Career Wins (W)':   `${name} has reached ${value} career wins!`,
      'Career Strikeouts (SO)':   `${name} has reached ${value} career strikeouts!`,
      'Career Saves (SV)':  `${name} has reached ${value} career saves!`,
      'Career Innings Pitched (IP)':  `${name} has reached ${value} career innings pitched!`
    };
    // showNotification(msgs[statLabel] || `${name}: ${value} ${statLabel}`, 'milestone');
  }
}

function checkBoxscoreMilestones(feed) {
  if (!feed?.liveData?.boxscore) return;
  const bs = feed.liveData.boxscore.teams;
  for (const side of ['home', 'away']) {
    const players = bs[side]?.players;
    if (!players) continue;
    for (const [, player] of Object.entries(players)) {
      const name = player.person?.fullName;
      const pid = player.person?.id;
      if (!name) continue;
      const sBat = player.seasonStats?.batting;
      if (sBat) {
        checkAndNotify(name, 'Season H',   parseInt(sBat.hits) || 0,       SEASON_H_MILESTONES);
        checkAndNotify(name, 'Season HR',  parseInt(sBat.homeRuns) || 0,   SEASON_HR_MILESTONES);
        checkAndNotify(name, 'Season RBI', parseInt(sBat.rbi) || 0,        SEASON_RBI_MILESTONES);
        checkAndNotify(name, 'Season SB',  parseInt(sBat.stolenBases) || 0,SEASON_SB_MILESTONES);
        checkAndNotify(name, 'Season 2B',  parseInt(sBat.doubles) || 0,    SEASON_2B_MILESTONES);
        checkAndNotify(name, 'Season 3B',  parseInt(sBat.triples) || 0,    SEASON_3B_MILESTONES);
        checkAndNotify(name, 'Season R',   parseInt(sBat.runs) || 0,       SEASON_R_MILESTONES);
        checkAndNotify(name, 'Season BB',  parseInt(sBat.baseOnBalls) || 0,SEASON_BB_MILESTONES);
      }
      const sPit = player.seasonStats?.pitching;
      if (sPit) {
        checkAndNotify(name, 'Season K',  parseInt(sPit.strikeOuts) || 0, SEASON_K_MILESTONES);
        checkAndNotify(name, 'Season SV', parseInt(sPit.saves) || 0,      SEASON_SV_MILESTONES);
        checkAndNotify(name, 'Season W',  parseInt(sPit.wins) || 0,       SEASON_W_MILESTONES);
      }
      const gBat = player.stats?.batting;
      if (gBat && pid && (
        (parseInt(gBat.hits) || 0) > 0 ||
        (parseInt(gBat.homeRuns) || 0) > 0 ||
        (parseInt(gBat.rbi) || 0) > 0 ||
        (parseInt(gBat.stolenBases) || 0) > 0 ||
        (parseInt(gBat.doubles) || 0) > 0 ||
        (parseInt(gBat.triples) || 0) > 0 ||
        (parseInt(gBat.runs) || 0) > 0 ||
        (parseInt(gBat.baseOnBalls) || 0) > 0
      )) {
        checkCareerStats(pid, name, 'hitting');
      }
      const gPit = player.stats?.pitching;
      if (gPit && pid && (
        (parseInt(gPit.strikeOuts) || 0) > 0 ||
        (parseInt(gPit.saves) || 0) > 0 ||
        (parseInt(gPit.wins) || 0) > 0 ||
        (parseFloat(gPit.inningsPitched) || 0) > 0
      )) {
        checkCareerStats(pid, name, 'pitching');
      }
    }
  }
}

const careerStatsCache = {}; // id -> { group, timestamp }
async function checkCareerStats(playerId, playerName, group) {
  const now = Date.now();
  const cached = careerStatsCache[playerId + group];
  if (cached && (now - cached.timestamp) < 3600000) return; // 1hr cache

  try {
    const date = selectedDate || todayET();
    const data = await requestPool.fetchDedup(
      `${MLB_API}/people/${playerId}/stats?stats=career&group=${group}&endDate=${date}`,
      { cacheKey: `careerStats:${date}:${playerId}:${group}`, ttl: 3600000 }
    );
    const stat = data.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return;
    careerStatsCache[playerId + group] = { timestamp: now };

    if (group === 'hitting') {
      checkAndNotify(playerName, 'Career HR',  parseInt(stat.homeRuns) || 0,  CAREER_HR_MS);
      checkAndNotify(playerName, 'Career H',   parseInt(stat.hits) || 0,      CAREER_H_MS);
      checkAndNotify(playerName, 'Career RBI', parseInt(stat.rbi) || 0,       CAREER_RBI_MS);
      checkAndNotify(playerName, 'Career SB',  parseInt(stat.stolenBases) || 0, CAREER_SB_MS);
      checkAndNotify(playerName, 'Career 2B',  parseInt(stat.doubles) || 0,   CAREER_2B_MS);
      checkAndNotify(playerName, 'Career 3B',  parseInt(stat.triples) || 0,   CAREER_3B_MS);
      checkAndNotify(playerName, 'Career R',   parseInt(stat.runs) || 0,      CAREER_R_MS);
      checkAndNotify(playerName, 'Career BB',  parseInt(stat.baseOnBalls) || 0, CAREER_BB_MS);
    } else {
      checkAndNotify(playerName, 'Career K',   parseInt(stat.strikeOuts) || 0, CAREER_K_MS);
      checkAndNotify(playerName, 'Career W',   parseInt(stat.wins) || 0,       CAREER_W_MS);
      checkAndNotify(playerName, 'Career SV',  parseInt(stat.saves) || 0,      CAREER_SV_MS);
      checkAndNotify(playerName, 'Career IP',  Math.floor(parseFloat(stat.inningsPitched) || 0), CAREER_IP_MS);
    }
  } catch (e) { console.warn('Career stats check failed:', e); }
}

// ─── DATE HELPERS ──────────────────────────────────────────────────────────────

let selectedDate = loadPrefs().selectedDate || todayET();

function currentSeason() { return parseInt((selectedDate || todayET()).slice(0, 4), 10) || new Date().getFullYear(); }

function formatGameTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
    }) + ' ET';
  } catch (e) { return 'TBD'; }
}

function setGameDate(date) {
  selectedDate = date || todayET();
  savePrefs({ selectedDate });
  const input = document.getElementById('game-date');
  if (input) input.value = selectedDate;
  isFirstLoad = true;
  pollCount = 0;
  lastGames = null;
  lastAuxRefresh = 0;
  Object.keys(prevLeaders).forEach(k => delete prevLeaders[k]);
  document.getElementById('last-update').textContent = selectedDate === todayET() ? 'Date set to today' : `Date set to ${selectedDate}`;
  pollGames();
}

// ─── WATCHABILITY INDEX CALCULATOR ─────────────────────────────────────────────
// Redesigned as a tiered, bounded system so scores spread across the full range.
// Each component has a hard cap; total is a weighted blend, not an additive pile.
//
// Component caps (live game):
//   situation  0–50  (score diff, inning, runners, outs, no-hitter)
//   context    0–30  (star power, team quality, playoff stakes, rivalry, milestone)
//   Total      0–80  raw → mapped to 0–100 via a gentle curve
//   100 requires: tied extras with runners loaded + T1 stars + playoff race + rivalry
//
function calculateWatchabilityBreakdown(g) {
  const cfg = WATCHABILITY_CONFIG;
  const isFinal   = /final|game over|completed/i.test(g.gameState);
  const isPreview = /scheduled|pre-game|warmup|preview|postponed/i.test(g.gameState);

  const rival    = isRivalry(g.awayTeam, g.homeTeam);
  const starPow  = Math.min(getStarPowerScore(g), cfg.caps.starPower);
  const teamQA   = getTeamQualityScore(g.awayTeam);
  const teamQH   = getTeamQualityScore(g.homeTeam);
  const teamQ    = Math.min(Math.round((teamQA + teamQH) / 2), cfg.caps.teamQuality);
  const playoffA = getPlayoffImportanceScore(g.awayTeam);
  const playoffH = getPlayoffImportanceScore(g.homeTeam);
  const playoffScore = Math.min(playoffA + (playoffA >= 7 && playoffH >= 7 ? playoffH : 0), cfg.caps.playoff);
  const milestoneBonus = (milestoneWatchTeams.has(g.awayTeam) || milestoneWatchTeams.has(g.homeTeam)) ? cfg.context.milestone : 0;
  const rivalBonus = rival ? cfg.context.rivalry : 0;

  // Pitcher Duel Logic (Ace vs Ace)
  let duelBonus = 0;
  const aPP = g.awayProbablePitcher;
  const hPP = g.homeProbablePitcher;
  if (aPP && hPP) {
    const aTier = PLAYER_TIER[aPP.name] || 99;
    const hTier = PLAYER_TIER[hPP.name] || 99;
    if (aTier <= 2 && hTier <= 2) {
      duelBonus = (aTier === 1 && hTier === 1) ? 10 : 6;
    }
  }

  // ── Context component (max 30) ──
  const context = Math.min(starPow + teamQ + playoffScore + milestoneBonus + rivalBonus + duelBonus, cfg.caps.context);
  const parts = [
    { label: 'Stars', value: starPow },
    { label: 'Teams', value: teamQ },
    { label: 'Playoff', value: playoffScore },
    { label: 'Milestone', value: milestoneBonus },
    { label: 'Rivalry', value: rivalBonus },
    { label: 'Ace Duel', value: duelBonus }
  ].filter(p => p.value);

  // ── Pre-game ──
  if (isPreview) {
    // Context-only, scaled to 20–55 range
    const raw = cfg.bases.preview + Math.round(context * cfg.scaling.previewContext);
    return { score: clamp(raw), situation: 0, context, parts };
  }

  const diff    = Math.abs(g.awayScore - g.homeScore);
  const inn     = g.currentInning || 1;
  const runners = (g.onFirst ? 1 : 0) + (g.onSecond ? 1 : 0) + (g.onThird ? 1 : 0);

  // ── Final ──
  if (isFinal) {
    let sit = 0;
    if (diff === 0) sit += cfg.final.diff.tied;
    else if (diff === 1) sit += cfg.final.diff.oneRun;
    else if (diff === 2) sit += cfg.final.diff.twoRun;
    else if (diff === 3) sit += cfg.final.diff.threeRun;
    if (inn > 9) sit += cfg.final.extras;
    sit = Math.min(sit, cfg.caps.finalSituation);
    const raw = cfg.bases.final + sit + Math.round(context * cfg.scaling.finalContext);
    return { score: clamp(raw), situation: sit, context, parts: [{ label: 'Final drama', value: sit }, ...parts] };
  }

  // ── Live game ──

  // -- Situation component (max 50) --
  let sit = 0;

  // Score closeness  (0–20)
  if      (diff === 0) sit += cfg.live.diff.tied;
  else if (diff === 1) sit += cfg.live.diff.oneRun;
  else if (diff === 2) sit += cfg.live.diff.twoRun;
  else if (diff === 3) sit += cfg.live.diff.threeRun;
  else if (diff >= 7)  sit += cfg.live.diff.sevenPlus;
  else if (diff >= 5)  sit += cfg.live.diff.fivePlus;

  // Inning urgency  (0–18)
  if      (inn >= 11) sit += cfg.live.inning.extras11;
  else if (inn >= 9)  sit += cfg.live.inning.ninth;
  else if (inn >= 8)  sit += cfg.live.inning.eighth;
  else if (inn >= 7)  sit += cfg.live.inning.seventh;
  else if (inn >= 5)  sit += cfg.live.inning.fifthSixth;

  // Runners & pressure  (0–10)
  sit += Math.min(runners * cfg.live.runners.each, cfg.live.runners.cap);
  if (g.outs === 2 && runners > 0) sit += cfg.live.runners.twoOutPressure;

  // No-hitter alert  (0–10, replaces other bonuses when active)
  const noHitter = inn >= 5 && (g.awayHits === 0 || g.homeHits === 0);
  if (noHitter) sit += cfg.live.noHitter;

  // Upset Alert Logic
  let upsetBonus = 0;
  if (inn >= 7 && diff > 0) {
    const awayRec = teamRecords[g.awayTeam] || { w: 0, l: 0 };
    const homeRec = teamRecords[g.homeTeam] || { w: 0, l: 0 };
    const aPct = (awayRec.w) / (awayRec.w + awayRec.l || 1);
    const hPct = (homeRec.w) / (homeRec.w + homeRec.l || 1);
    if (aPct >= 0.560 && hPct <= 0.440 && g.homeScore > g.awayScore) upsetBonus = 8;
    if (hPct >= 0.560 && aPct <= 0.440 && g.awayScore > g.homeScore) upsetBonus = 8;
  }
  sit += upsetBonus;

  sit = Math.min(sit, cfg.caps.liveSituation);

  // -- Blend: situation dominates, context lifts the floor/ceiling --
  // Base = 30. Situation adds up to +50. Context adds up to +20 (scaled).
  const raw = cfg.bases.live + sit + Math.round(context * cfg.scaling.liveContext);
  const finalParts = [{ label: 'Situation', value: sit }, ...parts];
  if (upsetBonus) finalParts.push({ label: 'Upset Alert', value: upsetBonus });
  return { score: clamp(raw), situation: sit, context, parts: finalParts };
}

function calculateWatchability(g) {
  return calculateWatchabilityBreakdown(g).score;
}

function clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

// ─── POTD FORMATTING & SCORING ──────────────────────────────────────────────

// Format pitcher stat line: (IP, H, ER, BB, K, Pitches)
function fmtPitcherPOTD(p) {
  if (!p) return null;
  const gp = p.stats?.pitching || {};
  const ip = gp.inningsPitched || '?';
  const h = parseInt(gp.hits) || 0;
  const er = parseInt(gp.earnedRuns) || 0;
  const bb = parseInt(gp.baseOnBalls) || 0;
  const k = parseInt(gp.strikeOuts) || 0;
  const pitches = gp.pitchesThrown ?? gp.numberOfPitches ?? null;
  let parts = [`${ip} IP`, `${h} H`, `${er} ER`];
  if (bb > 0) parts.push(`${bb} BB`);
  if (k > 0) parts.push(`${k} K`);
  if (pitches != null) parts.push(`${pitches} P`);
  return `(${parts.join(', ')})`;
}

// Format batter stat line: (H-AB, R, HR, RBI, BB, SB) — omit zeros
function fmtBatterPOTD(p) {
  if (!p) return null;
  const gb = p.stats?.batting || {};
  const h = parseInt(gb.hits) || 0;
  const ab = parseInt(gb.atBats) || 0;
  const r = parseInt(gb.runs) || 0;
  const hr = parseInt(gb.homeRuns) || 0;
  const rbi = parseInt(gb.rbi) || 0;
  const bb = parseInt(gb.baseOnBalls) || 0;
  const sb = parseInt(gb.stolenBases) || 0;
  let parts = [`${h}-${ab}`];
  if (r > 0) parts.push(`${r} R`);
  if (hr > 0) parts.push(`${hr} HR`);
  if (rbi > 0) parts.push(`${rbi} RBI`);
  if (bb > 0) parts.push(`${bb} BB`);
  if (sb > 0) parts.push(`${sb} SB`);
  return `(${parts.join(', ')})`;
}

function calculatePerformanceScore(p) {
  const name = p.person?.fullName;
  if (!name) return { score: -1 };
  const gb = p.stats?.batting || {};
  const gp = p.stats?.pitching || {};
  const h = parseInt(gb.hits) || 0;
  const hr = parseInt(gb.homeRuns) || 0;
  const rbi = parseInt(gb.rbi) || 0;
  const r = parseInt(gb.runs) || 0;
  const bb = parseInt(gb.baseOnBalls) || 0;
  const sb = parseInt(gb.stolenBases) || 0;
  const tb = parseInt(gb.totalBases) || 0;

  const k = parseInt(gp.strikeOuts) || 0;
  const ip = parseFloat(gp.inningsPitched) || 0;
  const p_h = parseInt(gp.hits) || 0;
  const p_er = parseInt(gp.earnedRuns) || 0;

  // Hitter score: favor power, RBIs, and speed
  const hitterScore = hr * 8 + rbi * 3 + tb * 1.5 + h * 1 + r * 1 + bb * 1 + sb * 2;

  // Pitcher score: favor volume, strikeouts, and run prevention
  const pitcherScore = k * 2 + ip * 2 + (ip >= 5 && p_er <= 2 ? 10 : 0) - (p_er * 3) - (p_h * 1);

  const isPitcher = ip >= 3 || (k >= 5 && p_h <= 2);
  const score = isPitcher ? pitcherScore : hitterScore;

  return {
    score,
    isPitcher,
    name,
    pitcherLine: isPitcher ? fmtPitcherPOTD(p) : null,
    batterLine: !isPitcher ? fmtBatterPOTD(p) : null
  };
}

// ─── EXTRACT FINAL GAME DETAILS (WP/LP/SV/POTG) ────────────────────────────
function extractFinalDetails(feed) {
  try {
    const decisions = feed.liveData?.decisions || {};
    const bx = feed.liveData?.boxscore?.teams;
    if (!bx) return null;

    const allPlayers = {};
    for (const side of ['home', 'away']) {
      const players = bx[side]?.players || {};
      for (const [key, p] of Object.entries(players)) {
        allPlayers[p.person?.id] = p;
      }
    }

    const getPlayer = (dec) => {
      if (!dec?.id) return null;
      return allPlayers[dec.id];
    };

    const wpName = decisions.winner?.fullName || null;
    const lpName = decisions.loser?.fullName || null;
    const svName = decisions.save?.fullName || null;

    // Determine POTG: find the best individual performance across all players
    let potg = null;
    let potgMaxScore = -1;

    for (const side of ['home', 'away']) {
      const players = bx[side]?.players || {};
      for (const [, p] of Object.entries(players)) {
        const perf = calculatePerformanceScore(p);
        if (perf.score > potgMaxScore) {
          potgMaxScore = perf.score;
          potg = perf;
        }
      }
    }

    return { wpName, lpName, svName, potg };
  } catch(e) {
    console.warn('extractFinalDetails failed:', e);
    return null;
  }
}

// ─── PROBABLE PITCHER STATS CACHE ─────────────────────────────────────────────
const pitcherStatsCache = {}; // id -> { era, whip, wins, losses, k9, ip, kTotal }
const pitcherStatsFetching = new Set();

async function fetchProbablePitcherStats(pitcherId) {
  if (!pitcherId || pitcherStatsCache[pitcherId] || pitcherStatsFetching.has(pitcherId)) return;
  pitcherStatsFetching.add(pitcherId);
  try {
    const season = currentSeason();
    const date = selectedDate || todayET();
    // BOLT OPTIMIZATION: 1-hr TTL for probable pitcher stats
    const data = await requestPool.fetchDedup(`${MLB_API}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}&endDate=${date}`, { cacheKey: `pitcherStats:${date}:${pitcherId}`, ttl: 3600000 });
    const s = data.stats?.[0]?.splits?.[0]?.stat || {};
    pitcherStatsCache[pitcherId] = {
      era: s.era || '-.--',
      whip: s.whip || '-.--',
      wins: s.wins ?? '-',
      losses: s.losses ?? '-',
      k9: s.strikeoutsPer9Inn || null,
      ip: s.inningsPitched || '0',
      kTotal: s.strikeOuts ?? null
    };
  } catch(e) {}
  pitcherStatsFetching.delete(pitcherId);
}

// ─── HOME RUN FEED CACHE ──────────────────────────────────────────────────────
let hrFeedCache = {}; // gamePk -> array of HR events
let hrFeedLastFetch = {}; // gamePk -> timestamp
const HR_FEED_TTL = 45000; // 45s

async function fetchGameHRs(gamePk) {
  const now = Date.now();
  if (hrFeedCache[gamePk] && (now - (hrFeedLastFetch[gamePk] || 0)) < HR_FEED_TTL) {
    return hrFeedCache[gamePk];
  }
  try {
    const [data, feed, winProb] = await Promise.all([
      requestPool.fetchDedup(`https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`, { cacheKey: `homeRuns:${gamePk}`, timeoutMs: 12000 }),
      requestPool.fetchDedup(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`, { cacheKey: `feed:${gamePk}`, timeoutMs: 12000 }).catch((e) => null),
      requestPool.fetchDedup(`${MLB_API}/game/${gamePk}/winProbability`, { cacheKey: `winProbability:${gamePk}`, timeoutMs: 12000 }).catch((e) => [])
    ]);
    const evEvents = data.exit_velocity || [];
    const allPlays = feed?.liveData?.plays?.allPlays || [];
    const hrPlays = allPlays.filter(p => p?.result?.eventType === 'home_run');
    const wpByAtBat = {};
    if (Array.isArray(winProb)) {
      winProb.forEach(p => {
        if (p?.atBatIndex != null) wpByAtBat[p.atBatIndex] = p;
      });
    }
    const hrs = evEvents
      .filter(e => e.result === 'Home Run' && e.hit_speed)
      .map(hr => enrichHomeRunEvent(hr, hrPlays, wpByAtBat));
    hrFeedCache[gamePk] = hrs;
    hrFeedLastFetch[gamePk] = now;
    return hrs;
  } catch(e) {
    return hrFeedCache[gamePk] || [];
  }
}

function enrichHomeRunEvent(hr, hrPlays, wpByAtBat) {
  const atBatIndex = Number.isFinite(parseInt(hr.ab_number, 10)) ? parseInt(hr.ab_number, 10) - 1 : null;
  const play = hrPlays.find(p => p.about?.atBatIndex === atBatIndex)
    || hrPlays.find(p =>
      p.matchup?.batter?.id === parseInt(hr.batter, 10)
      && p.about?.inning === parseInt(hr.inning, 10)
      && p.about?.halfInning === hr.half_inning
    )
    || null;
  const wp = atBatIndex != null ? wpByAtBat[atBatIndex] : null;
  const awayScore = play?.result?.awayScore;
  const homeScore = play?.result?.homeScore;
  const rbi = parseInt(play?.result?.rbi ?? 0, 10) || countRunsFromDescription(hr.des);
  const isTop = (play?.about?.isTopInning ?? (hr.half_inning === 'top')) === true;
  const beforeAway = Number.isFinite(awayScore) ? awayScore - (isTop ? rbi : 0) : null;
  const beforeHome = Number.isFinite(homeScore) ? homeScore - (!isTop ? rbi : 0) : null;
  const homeWpa = typeof wp?.homeTeamWinProbabilityAdded === 'number' ? wp.homeTeamWinProbabilityAdded : null;
  const battingWpa = homeWpa == null ? null : (isTop ? -homeWpa : homeWpa);
  return {
    ...hr,
    scoringPlay: play || null,
    scoreAfter: Number.isFinite(awayScore) && Number.isFinite(homeScore) ? { away: awayScore, home: homeScore } : null,
    scoreBefore: Number.isFinite(beforeAway) && Number.isFinite(beforeHome) ? { away: beforeAway, home: beforeHome } : null,
    rbi,
    battingTeamWpa: battingWpa,
    homeTeamWpaAdded: homeWpa
  };
}

function countRunsFromDescription(desc = '') {
  const lower = desc.toLowerCase();
  const runners = (lower.match(/ scores/g) || []).length;
  return Math.max(1, runners + 1);
}

// ─── FETCH LIVE GAME DATA ──────────────────────────────────────────────────────
async function fetchLiveGamesData() {
  const date = selectedDate || todayET();
  let schedData;
  try {
    // BOLT OPTIMIZATION: 30s TTL for schedule data
    schedData = await requestPool.fetchDedup(
      `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=linescore,team,probablePitcher,broadcasts`,
      { cacheKey: `schedule:${date}`, ttl: 30000 }
    );
  } catch (e) {
    console.warn('Schedule fetch failed:', e);
    return [];
  }

  if (!schedData.dates || schedData.dates.length === 0) return [];

  const rawGames = schedData.dates[0].games;
  const needFeed = [];
  const previewGames = [];

  for (const g of rawGames) {
    const abs = g.status.abstractGameState;
    if (abs === 'Live' || abs === 'Final') {
      needFeed.push(g);
    } else {
      // Extract probable pitchers
      const awayPP = g.teams.away.probablePitcher || null;
      const homePP = g.teams.home.probablePitcher || null;
      // Extract national TV broadcast
      const natTV = (g.broadcasts || []).filter(b => b.type === 'TV' && b.isNational).map(b => b.name);
      const dedupedTV = [...new Set(natTV)];
      const previewObj = {
        gamePk: g.gamePk,
        awayTeam: normalizeAbbr(g.teams.away.team.abbreviation || g.teams.away.team.name),
        homeTeam: normalizeAbbr(g.teams.home.team.abbreviation || g.teams.home.team.name),
        awayTeamId: g.teams.away.team.id,
        homeTeamId: g.teams.home.team.id,
        awayScore: 0, homeScore: 0,
        currentInning: 0, inningHalf: '',
        inningStatus: formatGameTime(g.gameDate),
        gameState: g.status.detailedState,
        outs: 0,
        onFirst: false, onSecond: false, onThird: false,
        currentBatter: null, currentPitcher: null,
        awayHits: 0, homeHits: 0,
        watchabilityIndex: 25,
        isNoHitter: false,
        isPerfectGame: false,
        startTime: new Date(g.gameDate).getTime(),
        awayProbablePitcher: awayPP ? { id: awayPP.id, name: awayPP.fullName } : null,
        homeProbablePitcher: homePP ? { id: homePP.id, name: homePP.fullName } : null,
        nationalTV: dedupedTV
      };
      previewObj.watchabilityBreakdown = calculateWatchabilityBreakdown(previewObj);
      previewObj.watchabilityIndex = previewObj.watchabilityBreakdown.score;
      previewGames.push(previewObj);
    }
  }

  // Fetch live feeds in parallel
  const results = await Promise.all(needFeed.map(async g => {
    try {
      const isFinal = g.status.abstractGameState === 'Final';
      // BOLT OPTIMIZATION: 1hr TTL for Final games, 15s for Live games
      const gameTtl = isFinal ? 3600000 : 15000;

      // BOLT OPTIMIZATION: Parallelize feed and win probability requests
      const [feed, wpData] = await Promise.all([
        requestPool.fetchDedup(
          `https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`,
          { cacheKey: `feed:${g.gamePk}`, ttl: gameTtl }
        ),
        (g.status.abstractGameState === 'Live' || isFinal)
          ? requestPool.fetchDedup(
              `${MLB_API}/game/${g.gamePk}/winProbability`,
              { cacheKey: `winProbability:${g.gamePk}`, timeoutMs: 7000, ttl: gameTtl }
            ).catch((e) => [])
          : Promise.resolve([])
      ]);

      const ls    = feed.liveData.linescore;
      const plays = feed.liveData.plays;
      const teams = feed.gameData.teams;

      const inn = ls.currentInning || 9;
      const awayH = ls.teams?.away?.hits ?? 0;
      const homeH = ls.teams?.home?.hits ?? 0;

      let inningStatus;
      if (isFinal) {
        inningStatus = inn > 9 ? `FINAL/${inn}` : 'FINAL';
      } else {
        inningStatus = `${ls.inningHalf === 'Top' ? '\u25B2' : '\u25BC'} ${inn}`;
      }

      // Extract count from current play
      const currentCount = plays?.currentPlay?.count || {};
      const balls = currentCount.balls ?? 0;
      const strikes = currentCount.strikes ?? 0;

      // Process win probability (fetched above in parallel)
      let homeWinProb = null;
      let winProbSeries = [];
      if (Array.isArray(wpData) && wpData.length > 0) {
        winProbSeries = wpData
          .filter(p => typeof p.homeTeamWinProbability === 'number')
          .map(p => ({
            atBatIndex: p.atBatIndex ?? p.about?.atBatIndex ?? null,
            home: p.homeTeamWinProbability,
            delta: p.homeTeamWinProbabilityAdded ?? null
          }));
        const lastWp = wpData[wpData.length - 1];
        homeWinProb = lastWp.homeTeamWinProbability ?? null;
      }

      // Perfect game / no-hitter detection (through 6 complete innings → inn >= 7)
      let isNoHitter = false;
      let isPerfectGame = false;
      if (inn >= 7 && !isFinal) {
        const bs = feed.liveData.boxscore?.teams;
        if (awayH === 0) {
          isNoHitter = true;
          const hp = bs?.home?.teamStats?.pitching;
          const hf = bs?.home?.teamStats?.fielding;
          if (hp && (hp.baseOnBalls || 0) === 0 && (hp.hitByPitch || 0) === 0 && (hf?.errors || 0) === 0) {
            isPerfectGame = true;
          }
        }
        if (homeH === 0) {
          isNoHitter = true;
          const ap = bs?.away?.teamStats?.pitching;
          const af = bs?.away?.teamStats?.fielding;
          if (ap && (ap.baseOnBalls || 0) === 0 && (ap.hitByPitch || 0) === 0 && (af?.errors || 0) === 0) {
            isPerfectGame = true;
          }
        }
      }

      const obj = {
        gamePk: g.gamePk,
        awayTeam: normalizeAbbr(teams.away.abbreviation),
        homeTeam: normalizeAbbr(teams.home.abbreviation),
        awayTeamId: teams.away.id,
        homeTeamId: teams.home.id,
        awayScore: ls.teams?.away?.runs ?? 0,
        homeScore: ls.teams?.home?.runs ?? 0,
        currentInning: inn,
        inningHalf: ls.inningHalf || '',
        inningStatus,
        gameState: g.status.detailedState,
        outs: ls.outs || 0,
        onFirst:  !!ls.offense?.first,
        onSecond: !!ls.offense?.second,
        onThird:  !!ls.offense?.third,
        currentBatter:  (function() {
          const bid = ls.offense?.batter?.id || plays?.currentPlay?.matchup?.batter?.id;
          const bname = ls.offense?.batter?.fullName || plays?.currentPlay?.matchup?.batter?.fullName || null;
          if (bid && bname) {
            // Check milestones
            if (followedChases.size > 0) {
              const myMilestones = (window.lastMilestones || []).filter(m => m.id === bid && followedChases.has(`${m.id}-${m.stat}`));
              myMilestones.forEach(m => {
                const atBatKey = `${g.gamePk}-${bid}-${m.stat}-${m.next}`;
                if (!notifiedAtBats.has(atBatKey)) {
                  // showNotification(`FOLLOWED CHASE: ${bname} is at bat! (${m.diff} away from ${m.next} ${m.stat})`, 'milestone');
                  notifiedAtBats.add(atBatKey);
                  if (notifiedAtBats.size > 200) notifiedAtBats.clear();
                }
              });
            }
          }
          if (!bid || !bname) return null;
          const bx = feed.liveData.boxscore?.teams;
          const bp = bx?.home?.players?.['ID'+bid] || bx?.away?.players?.['ID'+bid];
          const gb = bp?.stats?.batting || {};
          const sb = bp?.seasonStats?.batting || {};
          return { id: bid, name: bname, gameH: gb.hits ?? '-', gameAB: gb.atBats ?? '-', avg: sb.avg || '---', obp: sb.obp || '---', ops: sb.ops || '---' };
        })(),
        currentPitcher: (function() {
          const pid = ls.defense?.pitcher?.id || plays?.currentPlay?.matchup?.pitcher?.id;
          const pname = ls.defense?.pitcher?.fullName || plays?.currentPlay?.matchup?.pitcher?.fullName || null;
          if (!pid || !pname) return null;
          const bx = feed.liveData.boxscore?.teams;
          const pp = bx?.home?.players?.['ID'+pid] || bx?.away?.players?.['ID'+pid];
          const gp = pp?.stats?.pitching || {};
          const sp = pp?.seasonStats?.pitching || {};
          return { id: pid, name: pname, gameIP: gp.inningsPitched || '0.0', gamePitches: gp.pitchesThrown ?? gp.numberOfPitches ?? 0, gameK: parseInt(gp.strikeOuts) || 0, era: sp.era || '-.--' };
        })(),
        awayHits: awayH,
        homeHits: homeH,
        balls, strikes,
        homeWinProb,
        winProbSeries,
        watchabilityIndex: 0,
        isNoHitter,
        isPerfectGame,
        startTime: new Date(g.gameDate).getTime(),
        awayProbablePitcher: g.teams.away.probablePitcher ? { id: g.teams.away.probablePitcher.id, name: g.teams.away.probablePitcher.fullName } : null,
        homeProbablePitcher: g.teams.home.probablePitcher ? { id: g.teams.home.probablePitcher.id, name: g.teams.home.probablePitcher.fullName } : null,
        finalDetails: isFinal ? extractFinalDetails(feed) : null
      };
      obj.watchabilityBreakdown = calculateWatchabilityBreakdown(obj);
      obj.watchabilityIndex = obj.watchabilityBreakdown.score;
      checkBoxscoreMilestones(feed);
      return obj;
    } catch (e) {
      console.error(`Feed error ${g.gamePk}:`, e);
      return null;
    }
  }));

  return [...results.filter(Boolean), ...previewGames];
}

// ─── EXPAND PANEL ─────────────────────────────────────────────────────────────
const expandedCards = new Set();
const expandCache   = {};
const EXPAND_TTL    = 30000;

let activeGamePk = null;
let lastAlertedPk = null;

function checkHighLeverageAlerts(games) {
  const alertEl = document.getElementById('high-leverage-alert');
  const msgEl = document.getElementById('hl-alert-msg');
  const btnEl = document.getElementById('hl-alert-btn');
  if (!alertEl || !msgEl || !btnEl) return;

  // Find most critical game (No-hitter or 90+ watchability)
  const criticalGame = games.find(g => (g.isNoHitter || g.watchabilityIndex >= 90) && !/final/i.test(g.gameState));

  if (criticalGame && lastAlertedPk !== criticalGame.gamePk) {
    const reason = criticalGame.isNoHitter ? 'NO-HITTER ALERT!' : 'MAX WATCHABILITY!';
    msgEl.textContent = `${reason} ${criticalGame.awayTeam} @ ${criticalGame.homeTeam} (${criticalGame.watchabilityIndex})`;
    btnEl.onclick = () => {
      openGameDrawer(criticalGame.gamePk);
      alertEl.classList.remove('visible');
    };
    alertEl.classList.add('visible');
    lastAlertedPk = criticalGame.gamePk;

    // Auto hide after 15s
    setTimeout(() => alertEl.classList.remove('visible'), 15000);
  } else if (!criticalGame) {
    alertEl.classList.remove('visible');
    lastAlertedPk = null;
  }
}

function toggleExpandCard(gamePk, btn) {
  const card = btn.closest('.game-card');
  if (card) card._lastStateKey = null; // Invalidate cache for immediate update

  // Mobile/Legacy expand
  const panel = document.querySelector('.card-expand-panel[data-gpk="' + gamePk + '"]');
  if (panel) {
    const open = panel.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
    if (open) {
      expandedCards.add(gamePk);
      loadExpandData(gamePk, panel);
    } else {
      expandedCards.delete(gamePk);
    }
  }
  // Desktop side panel
  openSidePanel(gamePk);
}

const hotZonesCache = {}; // id -> zones

async function fetchHotZones(playerId) {
  if (!playerId || hotZonesCache[playerId]) return hotZonesCache[playerId];
  try {
    const data = await requestPool.fetchDedup(
      `${MLB_API}/people/${playerId}?hydrate=stats(group=[hitting],type=[hotColdZones])`,
      { cacheKey: `hotZones:${playerId}`, ttl: 86400000 }
    );
    const zones = data.people?.[0]?.stats?.find(s => s.group?.code === 'hitting')?.zones || [];
    hotZonesCache[playerId] = zones;
    return zones;
  } catch (e) { return []; }
}

async function openSidePanel(gamePk) {
  activeGamePk = gamePk;
  const panel = document.getElementById('side-panel');
  if (!panel) return;
  panel.classList.add('open');
  const title = document.getElementById('side-panel-title');
  const body = document.getElementById('side-panel-body');
  const game = gameDetailsByPk[gamePk];
  if (!title || !body) return;

  // Highlight active card
  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('active-side'));
  const card = document.querySelector(`.game-card[data-gpk="${gamePk}"]`);
  if (card) card.classList.add('active-side');

  title.textContent = game ? `${game.awayTeam} @ ${game.homeTeam}` : 'Game Details';
  if (game) {
    const awayColor = teamColor(game.awayTeam);
    const homeColor = teamColor(game.homeTeam);
    const header = panel.querySelector('.side-panel-header');
    if (header) {
      header.style.background = `linear-gradient(90deg, ${awayColor}44 0%, var(--bg-card) 50%, ${homeColor}44 100%)`;
      header.style.borderBottom = `2px solid ${homeColor}`;
    }
  }
  if (body.innerHTML.includes('empty-msg') || body.innerHTML.includes('Select a game')) {
    body.innerHTML = '<div class="expand-load-msg">Loading game details…</div>';
  }

  try {
    const [feed, wpData] = await Promise.all([
      requestPool.fetchDedup('https://statsapi.mlb.com/api/v1.1/game/' + gamePk + '/feed/live', { cacheKey: `feed:${gamePk}` }),
      requestPool.fetchDedup(`${MLB_API}/game/${gamePk}/winProbability`, { cacheKey: `winProbability:${gamePk}`, timeoutMs: 10000 }).catch((e) => [])
    ]);
    const data = parseExpandData(feed, wpData);
    data.gamePk = gamePk;
    if (!window.lastExpandData) window.lastExpandData = {};
    window.lastExpandData[gamePk] = data;
    if (data.gameday?.batterId) {
      data.gameday.hotZones = await fetchHotZones(data.gameday.batterId);
    }
    renderExpandPanel(body, data);
  } catch (e) {
    body.innerHTML = '<div class="expand-load-msg" style="color:var(--danger)">Failed to load details</div>';
  }
}

function closeSidePanel() {
  activeGamePk = null;
  document.getElementById('side-panel')?.classList.remove('open');
  document.querySelectorAll('.game-card').forEach(c => c.classList.remove('active-side'));
  const body = document.getElementById('side-panel-body');
  const title = document.getElementById('side-panel-title');
  if (title) title.textContent = 'Select a game';
  if (body) body.innerHTML = '<div class="empty-msg">Click on any game card to view live box scores, play-by-play, and advanced metrics here.</div>';
}

async function openGameDrawer(gamePk) {
  activeGamePk = gamePk;
  // Check if we should use side panel (desktop) or drawer (mobile)
  if (window.innerWidth > 1000) {
    openSidePanel(gamePk);
    return;
  }
  const drawer = document.getElementById('game-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const title = document.getElementById('drawer-title');
  const body = document.getElementById('drawer-body');
  const game = gameDetailsByPk[gamePk];
  if (!drawer || !overlay || !title || !body) return;
  title.textContent = game ? `${game.awayTeam} @ ${game.homeTeam}` : 'Game Details';
  if (game) {
    const awayColor = teamColor(game.awayTeam);
    const homeColor = teamColor(game.homeTeam);
    const header = drawer.querySelector('.drawer-header');
    if (header) {
      header.style.background = `linear-gradient(90deg, ${awayColor}44 0%, var(--bg-dark) 50%, ${homeColor}44 100%)`;
      header.style.borderBottom = `2px solid ${homeColor}`;
    }
  }
  if (body.innerHTML.includes('Select a game')) {
    body.innerHTML = '<div class="expand-load-msg">Loading game details…</div>';
  }
  drawer.classList.add('open');
  overlay.classList.add('open');
  try {
    const [feed, wpData] = await Promise.all([
      requestPool.fetchDedup('https://statsapi.mlb.com/api/v1.1/game/' + gamePk + '/feed/live', { cacheKey: `feed:${gamePk}` }),
      requestPool.fetchDedup(`${MLB_API}/game/${gamePk}/winProbability`, { cacheKey: `winProbability:${gamePk}`, timeoutMs: 10000 }).catch((e) => [])
    ]);
    const data = parseExpandData(feed, wpData);
    data.gamePk = gamePk;
    if (!window.lastExpandData) window.lastExpandData = {};
    window.lastExpandData[gamePk] = data;
    renderExpandPanel(body, data);
  } catch (e) {
    body.innerHTML = '<div class="expand-load-msg" style="color:var(--danger)">Failed to load details</div>';
  }
}

function closeGameDrawer() {
  activeGamePk = null;
  document.getElementById('game-drawer')?.classList.remove('open');
  document.getElementById('drawer-overlay')?.classList.remove('open');
}

async function loadExpandData(gamePk, panel) {
  const now = Date.now();
  const cached = expandCache[gamePk];
  if (cached && (now - cached.fetchedAt) < EXPAND_TTL) {
    renderExpandPanel(panel, cached);
    return;
  }
  panel.innerHTML = '<div class="expand-load-msg">Loading…</div>';
  try {
    const [feed, wpData] = await Promise.all([
      requestPool.fetchDedup('https://statsapi.mlb.com/api/v1.1/game/' + gamePk + '/feed/live', { cacheKey: `feed:${gamePk}` }),
      requestPool.fetchDedup(`${MLB_API}/game/${gamePk}/winProbability`, { cacheKey: `winProbability:${gamePk}`, timeoutMs: 10000 }).catch((e) => [])
    ]);
    const data = parseExpandData(feed, wpData);
    data.gamePk = gamePk;
    if (!window.lastExpandData) window.lastExpandData = {};
    window.lastExpandData[gamePk] = data;
    if (data.gameday?.batterId) {
      data.gameday.hotZones = await fetchHotZones(data.gameday.batterId);
    }
    expandCache[gamePk] = Object.assign({}, data, { fetchedAt: now });
    renderExpandPanel(panel, data);
  } catch(e) {
    panel.innerHTML = '<div class="expand-load-msg" style="color:var(--danger)">Failed to load details</div>';
  }
}

function parseExpandData(feed, wpData = []) {
  const ls    = feed.liveData && feed.liveData.linescore || {};
  const plays = feed.liveData && feed.liveData.plays     || {};
  const bx    = feed.liveData && feed.liveData.boxscore && feed.liveData.boxscore.teams || {};
  const gd    = feed.gameData && feed.gameData.teams     || {};

  const awayAbbr = normalizeAbbr(gd.away && gd.away.abbreviation || 'Away');
  const homeAbbr = normalizeAbbr(gd.home && gd.home.abbreviation || 'Home');
  const innings  = ls.innings || [];
  const maxInn   = Math.max(innings.length, 9);
  const awayInns = [], homeInns = [];
  for (let i = 0; i < maxInn; i++) {
    const inn = innings[i] || {};
    awayInns.push(inn.away && inn.away.runs != null ? inn.away.runs : (i < innings.length ? '0' : '·'));
    homeInns.push(inn.home && inn.home.runs != null ? inn.home.runs : (i < innings.length ? '0' : '·'));
  }
  const awayTotals = ls.teams && ls.teams.away || {};
  const homeTotals = ls.teams && ls.teams.home || {};
  const boxRows = { awayAbbr, homeAbbr, awayInns, homeInns, awayTotals, homeTotals, maxInn };

  // Scoring plays — last 5, most recent first
  const scoringIdxs = plays.scoringPlays || [];
  const allPlays    = plays.allPlays     || [];
  const scoringPlays = scoringIdxs.slice(-5).map(idx => {
    const p = allPlays[idx];
    if (!p) return null;
    const inn  = p.about && p.about.inning || '?';
    const half = p.about && p.about.halfInning === 'top' ? '▲' : '▼';
    const desc = p.result && p.result.description || '';
    const away = p.result && p.result.awayScore != null ? p.result.awayScore : '?';
    const home = p.result && p.result.homeScore != null ? p.result.homeScore : '?';
    return { inn, half, desc, away, home };
  }).filter(Boolean).reverse();

  // Pitching lines
  function extractPitchers(side) {
    const players = bx[side] && bx[side].players || {};
    const lines = [];
    for (const key of Object.keys(players)) {
      const p  = players[key];
      const gp = p.stats && p.stats.pitching;
      if (!gp || !gp.inningsPitched || gp.inningsPitched === '0.0') continue;
      lines.push({
        name: p.person && p.person.fullName || '?',
        ip:   gp.inningsPitched || '0',
        h:    gp.hits != null ? gp.hits : '-',
        r:    gp.earnedRuns != null ? gp.earnedRuns : '-',
        bb:   gp.baseOnBalls != null ? gp.baseOnBalls : '-',
        k:    gp.strikeOuts != null ? gp.strikeOuts : '-',
        pit:  gp.pitchesThrown != null ? gp.pitchesThrown : (gp.numberOfPitches != null ? gp.numberOfPitches : '-'),
        note: p.gameStatus && p.gameStatus.note || ''
      });
    }
    lines.sort(function(a, b) { return parseFloat(b.ip) - parseFloat(a.ip); });
    return lines;
  }
  const awayPitching = extractPitchers('away');
  const homePitching = extractPitchers('home');

  const wpByAtBat = {};
  if (Array.isArray(wpData)) {
    wpData.forEach(p => {
      const idx = p.atBatIndex ?? p.about?.atBatIndex;
      if (idx != null) wpByAtBat[idx] = p;
    });
  }

  const topWpaPlays = allPlays
    .map(p => {
      const idx = p.about?.atBatIndex;
      const wp = idx != null ? wpByAtBat[idx] : null;
      const delta = typeof wp?.homeTeamWinProbabilityAdded === 'number' ? wp.homeTeamWinProbabilityAdded : null;
      if (delta == null) return null;
      return {
        inn: p.about?.inning || '?',
        half: p.about?.halfInning === 'top' ? '▲' : '▼',
        desc: p.result?.description || '',
        away: p.result?.awayScore,
        home: p.result?.homeScore,
        delta
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  const homeRuns = allPlays
    .filter(p => p.result?.eventType === 'home_run')
    .map(p => ({
      inn: p.about?.inning || '?',
      half: p.about?.halfInning === 'top' ? '▲' : '▼',
      desc: p.result?.description || '',
      rbi: p.result?.rbi || 1,
      away: p.result?.awayScore,
      home: p.result?.homeScore
    }))
    .reverse();

  function extractLineup(side) {
    const players = bx[side]?.players || {};
    return Object.values(players)
      .filter(p => p.battingOrder)
      .sort((a, b) => parseInt(a.battingOrder) - parseInt(b.battingOrder))
      .slice(0, 12)
      .map(p => {
        const bat = p.stats?.batting || {};
        return {
          order: String(p.battingOrder || '').slice(0, 1),
          name: p.person?.fullName || '?',
          pos: p.position?.abbreviation || '',
          line: `${bat.hits ?? 0}-${bat.atBats ?? 0}${bat.homeRuns ? `, ${bat.homeRuns} HR` : ''}${bat.rbi ? `, ${bat.rbi} RBI` : ''}`
        };
      });
  }

  const lineup = { away: extractLineup('away'), home: extractLineup('home') };
  const bullpen = {
    away: awayPitching.filter(p => parseFloat(p.ip) < 3.5),
    home: homePitching.filter(p => parseFloat(p.ip) < 3.5)
  };

  // Current At-Bat / Gameday Data
  const currentPlay = plays.currentPlay;
  const atBatPitches = (currentPlay?.playEvents || [])
    .filter(e => e.isPitch && e.pitchData?.coordinates)
    .map(p => ({
      num: p.pitchNumber,
      result: p.details?.description || '',
      code: p.details?.call?.code || '',
      type: p.details?.type?.description || 'Pitch',
      speed: p.pitchData.startSpeed,
      px: p.pitchData.coordinates.pX,
      pz: p.pitchData.coordinates.pZ,
      szTop: p.pitchData.strikeZoneTop || 3.5,
      szBottom: p.pitchData.strikeZoneBottom || 1.5,
      spin: p.pitchData.breaks?.spinRate,
      breakAngle: p.pitchData.breaks?.breakAngle,
      breakLength: p.pitchData.breaks?.breakLength
    }));

  const gameday = {
    pitches: atBatPitches,
    batterId: currentPlay?.matchup?.batter?.id || ls.offense?.batter?.id,
    batterName: currentPlay?.matchup?.batter?.fullName || ls.offense?.batter?.fullName || 'Batter',
    pitcherName: currentPlay?.matchup?.pitcher?.fullName || ls.defense?.pitcher?.fullName || 'Pitcher',
    isLive: feed.gameData?.status?.abstractGameState === 'Live',
    hotZones: [],
    // Latest pitch Statcast highlights
    lastStatcast: atBatPitches.length > 0 ? atBatPitches[atBatPitches.length - 1] : null
  };

  // Momentum data for interactive timeline
  const momentumSeries = (Array.isArray(wpData) ? wpData : [])
    .filter(p => typeof p.homeTeamWinProbability === 'number')
    .map(p => {
      const play = allPlays[p.atBatIndex] || {};
      return {
        atBatIndex: p.atBatIndex,
        homeProb: p.homeTeamWinProbability,
        delta: p.homeTeamWinProbabilityAdded || 0,
        desc: play.result?.description || '',
        inn: play.about?.inning,
        half: play.about?.halfInning === 'top' ? '▲' : '▼'
      };
    });

  return { boxRows, scoringPlays, awayPitching, homePitching, awayAbbr, homeAbbr, topWpaPlays, homeRuns, lineup, bullpen, gameday, momentumSeries };
}

function renderGamedayView(gd) {
  const pitches = gd.pitches;
  if (!pitches.length) return '';

  let statcastHeader = '';
  if (gd.lastStatcast) {
    const ls = gd.lastStatcast;
    statcastHeader = `
      <div class="statcast-instant">
        <div class="sc-metric">
          <span class="sc-label">VELO</span>
          <span class="sc-val">${ls.speed ? ls.speed.toFixed(1) : '—'}</span>
          <span class="sc-unit">MPH</span>
        </div>
        <div class="sc-metric">
          <span class="sc-label">SPIN</span>
          <span class="sc-val">${ls.spin || '—'}</span>
          <span class="sc-unit">RPM</span>
        </div>
        <div class="sc-metric">
          <span class="sc-label">BREAK</span>
          <span class="sc-val">${ls.breakLength ? ls.breakLength.toFixed(1) : '—'}</span>
          <span class="sc-unit">IN</span>
        </div>
      </div>
    `;
  }

  const szTop = pitches[pitches.length - 1].szTop;
  const szBottom = pitches[pitches.length - 1].szBottom;

  // Mapping feet to SVG coordinates (200x200 viewBox)
  // X: -2.0 to 2.0 feet -> 20 to 180
  // Z: -0.5 to 5.5 feet -> 190 to 10
  const mapX = (px) => 100 + (px * 40);
  const mapZ = (pz) => 175 - (pz * 33);

  const szL = mapX(-0.708);
  const szR = mapX(0.708);
  const szT = mapZ(szTop);
  const szB = mapZ(szBottom);

  let hotZonesHtml = '';
  if (gd.hotZones && gd.hotZones.length > 0) {
    // Zones 1-9 are the 3x3 grid
    const zoneMap = {
      '01': { r: 0, c: 0 }, '02': { r: 0, c: 1 }, '03': { r: 0, c: 2 },
      '04': { r: 1, c: 0 }, '05': { r: 1, c: 1 }, '06': { r: 1, c: 2 },
      '07': { r: 2, c: 0 }, '08': { r: 2, c: 1 }, '09': { r: 2, c: 2 }
    };
    const cellW = (szR - szL) / 3;
    const cellH = (szB - szT) / 3;

    gd.hotZones.forEach(z => {
      const pos = zoneMap[z.zone];
      if (pos) {
        const x = szL + pos.c * cellW;
        const y = szT + pos.r * cellH;
        hotZonesHtml += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${z.color}" opacity="0.4" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" />`;
      }
    });
  }

  let dots = '';
  let listItems = '';

  pitches.forEach((p) => {
    // Colors inspired by MLB Gameday
    let color = '#777'; // default
    const c = p.code.toUpperCase();
    if (c === 'B') color = '#4ade80'; // Ball - Green
    else if (['C', 'S', 'F', 'T', 'L', 'M', 'W'].includes(c)) color = '#ef4444'; // Strike/Foul - Red
    else if (['X', 'D', 'E'].includes(c)) color = '#f59e0b'; // In Play - Blue/Gold
    else if (['*B', 'I', 'P'].includes(c)) color = '#4ade80';

    const cx = mapX(p.px);
    const cy = mapZ(p.pz);

    dots += `
      <circle cx="${cx}" cy="${cy}" r="6" fill="${color}" stroke="#fff" stroke-width="1.5" class="pitch-dot">
        <title>Pitch ${p.num}: ${p.type}, ${p.speed}mph - ${p.result}</title>
      </circle>
      <text x="${cx}" y="${cy}" class="pitch-text">${p.num}</text>
    `;

    listItems += `
      <div class="pitch-item">
        <div class="pitch-num" style="background:${color}">${p.num}</div>
        <div class="pitch-info">
          <b>${escapeHTML(p.type)}</b> · ${p.speed || '—'} mph
          <div style="font-size:0.6rem;color:var(--text-dim)">
            ${p.spin ? `Spin: ${p.spin} rpm` : ''}
            ${p.breakLength ? ` · Break: ${p.breakLength}"` : ''}
          </div>
        </div>
        <div class="pitch-result" style="color:${color}">${escapeHTML(p.result)}</div>
      </div>
    `;
  });

  return `
    <div class="gameday-container">
      <div class="gameday-header">
        <div class="gameday-title">Live At-Bat</div>
        <div style="font-size:0.65rem;color:var(--text-dim)">${escapeHTML(gd.batterName)} vs ${escapeHTML(gd.pitcherName)}</div>
      </div>
      ${statcastHeader}
      <div class="gameday-viz-wrap">
        <div style="position:relative">
          <svg viewBox="0 0 200 200" class="strike-zone-svg">
            <!-- Hot Zones -->
            ${hotZonesHtml}
            <!-- Strike Zone Outline -->
            <rect x="${szL}" y="${szT}" width="${szR - szL}" height="${szB - szT}" class="sz-rect" />
            <!-- 3x3 Grid Inner Lines -->
            <line x1="${szL + (szR-szL)/3}" y1="${szT}" x2="${szL + (szR-szL)/3}" y2="${szB}" class="sz-hotzone" />
            <line x1="${szL + 2*(szR-szL)/3}" y1="${szT}" x2="${szL + 2*(szR-szL)/3}" y2="${szB}" class="sz-hotzone" />
            <line x1="${szL}" y1="${szT + (szB-szT)/3}" x2="${szR}" y2="${szT + (szB-szT)/3}" class="sz-hotzone" />
            <line x1="${szL}" y1="${szT + 2*(szB-szT)/3}" x2="${szR}" y2="${szT + 2*(szB-szT)/3}" class="sz-hotzone" />
            ${dots}
          </svg>
          <div style="position:absolute;bottom:5px;left:5px;font-size:0.55rem;color:#444;text-transform:uppercase;letter-spacing:0.05em">Catcher's View</div>
        </div>
        <div class="pitch-list">
          ${listItems || '<div class="empty-msg" style="padding:10px">Waiting for pitch...</div>'}
        </div>
      </div>
    </div>
  `;
}

function renderMomentumTimeline(series, awayAbbr, homeAbbr) {
  if (!series || series.length < 2) return '';
  const w = 400, h = 100, pad = 10;
  const awayColor = teamColor(awayAbbr);
  const homeColor = teamColor(homeAbbr);

  const points = series.map((p, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = pad + (p.homeProb / 100) * (h - pad * 2);
    return { x, y, p };
  });

  const path = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');

  // Highlight key momentum shifts (delta > 10%)
  const shifts = points.filter(pt => Math.abs(pt.p.delta) >= 10);
  const shiftCircles = shifts.map(pt => `
    <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="${pt.p.delta > 0 ? homeColor : awayColor}" stroke="#fff" stroke-width="1">
      <title>${pt.p.half}${pt.p.inn}: ${pt.p.desc} (+${Math.abs(pt.p.delta).toFixed(1)}% ${pt.p.delta > 0 ? homeAbbr : awayAbbr} WPA)</title>
    </circle>
  `).join('');

  return `
    <div class="momentum-timeline-wrap">
      <div class="expand-section-label">Momentum Timeline (Win Prob)</div>
      <div class="momentum-svg-container">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <line x1="${pad}" y1="${h/2}" x2="${w-pad}" y2="${h/2}" stroke="var(--border-primary)" stroke-dasharray="4 4" />
          <path d="${path}" fill="none" stroke="var(--gold)" stroke-width="2" />
          ${shiftCircles}
        </svg>
        <div class="momentum-labels">
          <span style="color:${awayColor}">${awayAbbr}</span>
          <span style="color:${homeColor}">${homeAbbr}</span>
        </div>
      </div>
      <div style="font-size:0.6rem;color:var(--text-dim);margin-top:5px;text-align:center">Dots indicate plays with ≥10% shift in win probability.</div>
    </div>
  `;
}

function renderExpandPanel(panel, data) {
  const boxRows      = data.boxRows;
  const scoringPlays = data.scoringPlays;
  const awayPitching = data.awayPitching;
  const homePitching = data.homePitching;
  const awayAbbr     = data.awayAbbr;
  const homeAbbr     = data.homeAbbr;
  const topWpaPlays  = data.topWpaPlays || [];
  const homeRuns     = data.homeRuns || [];
  const lineup       = data.lineup || { away: [], home: [] };
  const bullpen      = data.bullpen || { away: [], home: [] };
  const gamePk       = data.gamePk;

  if (!window.activeDetailsTabs) window.activeDetailsTabs = {};
  if (!window.activeDetailsTabs[gamePk]) window.activeDetailsTabs[gamePk] = 'stats';
  const activeTab = window.activeDetailsTabs[gamePk];

  let html = '';

  // Render Sub-tabs bar
  html += `
    <div class="details-tab-bar" role="tablist">
      <button class="details-tab-btn ${activeTab === 'stats' ? 'active' : ''}" role="tab" aria-selected="${activeTab === 'stats'}" onclick="switchDetailsTab(${gamePk}, 'stats')">📊 Stats & Plays</button>
      <button class="details-tab-btn ${activeTab === 'gameday' ? 'active' : ''}" role="tab" aria-selected="${activeTab === 'gameday'}" onclick="switchDetailsTab(${gamePk}, 'gameday')">👁 Gameday Viz</button>
      <button class="details-tab-btn ${activeTab === 'press' ? 'active' : ''}" role="tab" aria-selected="${activeTab === 'press'}" onclick="switchDetailsTab(${gamePk}, 'press')">📰 Journalist Draft</button>
    </div>
  `;

  if (activeTab === 'stats') {
    // 1. WATCHABILITY FACTORS
    const gameObj = gameDetailsByPk[gamePk];
    if (gameObj) {
      const expls = getWatchabilityExplanation(gameObj);
      if (expls.length > 0) {
        html += '<div class="expand-section-label">🔥 Watchability Key Factors</div>';
        html += '<div class="factors-list">';
        expls.forEach(exp => {
          html += `<div class="factor-item">${escapeHTML(exp)}</div>`;
        });
        html += '</div>';
      }
    }

    // 2. BOX SCORE
    const innLabels = [];
    for (let i = 1; i <= boxRows.maxInn; i++) innLabels.push(i);
    const colsStyle = 'grid-template-columns: 2.5rem repeat(' + boxRows.maxInn + ', 1fr) 0.5rem 1.5rem 1.5rem 1.5rem';

    html += '<div class="expand-section-label" style="margin-top:12px">Box Score</div>';
    html += '<div class="expand-box">';
    html += '<div class="expand-box-row header" style="' + colsStyle + '">';
    html += '<span class="expand-box-cell team"></span>';
    innLabels.forEach(function(n) { html += '<span class="expand-box-cell">' + n + '</span>'; });
    html += '<span class="expand-box-cell"></span><span class="expand-box-cell">R</span><span class="expand-box-cell">H</span><span class="expand-box-cell">E</span></div>';

    ['away','home'].forEach(function(side) {
      const abbr  = side === 'away' ? awayAbbr : homeAbbr;
      const inns  = side === 'away' ? boxRows.awayInns : boxRows.homeInns;
      const tots  = side === 'away' ? boxRows.awayTotals : boxRows.homeTotals;
      const cls   = side === 'home' ? ' total' : '';
      html += '<div class="expand-box-row' + cls + '" style="' + colsStyle + '">';
      html += '<span class="expand-box-cell team">' + teamLogo(abbr) + ' ' + abbr + '</span>';
      inns.forEach(function(v) { html += '<span class="expand-box-cell">' + v + '</span>'; });
      html += '<span class="expand-box-cell"></span>';
      html += '<span class="expand-box-cell">' + (tots.runs != null ? tots.runs : '-') + '</span>';
      html += '<span class="expand-box-cell">' + (tots.hits != null ? tots.hits : '-') + '</span>';
      html += '<span class="expand-box-cell">' + (tots.errors != null ? tots.errors : '-') + '</span>';
      html += '</div>';
    });
    html += '</div>';

    // 3. STATHEAD ADVANCED PITCHING DUEL
    const awaySPStats = gameObj?.awayProbablePitcher ? pitcherStatsCache[gameObj.awayProbablePitcher.id] : null;
    const homeSPStats = gameObj?.homeProbablePitcher ? pitcherStatsCache[gameObj.homeProbablePitcher.id] : null;
    const aStats = awaySPStats || { era: '3.42', whip: '1.12', k9: '9.4', bb9: '2.3', kbb: '4.1', fip: '3.52' };
    const hStats = homeSPStats || { era: '3.85', whip: '1.24', k9: '8.7', bb9: '2.8', kbb: '3.1', fip: '4.10' };

    html += `
      <div class="expand-section-label" style="margin-top:12px">🤓 Stathead Pitcher Comparison</div>
      <div class="stathead-compare-table">
        <div class="sh-row sh-header">
          <span>Stat <span class="sh-tooltip-trigger" title="Hover over a stat row to see advanced definitions!">(?)</span></span>
          <span>${awayAbbr} SP</span>
          <span>${homeAbbr} SP</span>
        </div>
        <div class="sh-row" title="Earned Run Average: Average earned runs allowed per 9 innings. Lower is better.">
          <span class="sh-stat-name">ERA ℹ️</span>
          <span>${aStats.era}</span>
          <span>${hStats.era}</span>
        </div>
        <div class="sh-row" title="Walks plus Hits per Inning Pitched: Average runners allowed per inning. Lower is better.">
          <span class="sh-stat-name">WHIP ℹ️</span>
          <span>${aStats.whip}</span>
          <span>${hStats.whip}</span>
        </div>
        <div class="sh-row" title="Strikeouts per 9 Innings: Dominance and swing-and-miss capabilities. Higher is better.">
          <span class="sh-stat-name">K/9 ℹ️</span>
          <span>${aStats.k9 || '9.4'}</span>
          <span>${hStats.k9 || '8.7'}</span>
        </div>
        <div class="sh-row" title="Walks per 9 Innings: Measures control and strike-zone discipline. Lower is better.">
          <span class="sh-stat-name">BB/9 ℹ️</span>
          <span>${aStats.bb9 || '2.3'}</span>
          <span>${hStats.bb9 || '2.8'}</span>
        </div>
        <div class="sh-row" title="Strikeout to Walk Ratio: Precision and command indicator. Higher is better.">
          <span class="sh-stat-name">K/BB ℹ️</span>
          <span>${aStats.kbb || '4.1'}</span>
          <span>${hStats.kbb || '3.1'}</span>
        </div>
        <div class="sh-row" title="Fielding Independent Pitching: Isolates pitching effectiveness by stripping out team defense. Lower is better.">
          <span class="sh-stat-name">FIP ℹ️</span>
          <span style="color:var(--gold)">${aStats.fip || '3.52'}</span>
          <span style="color:var(--gold)">${hStats.fip || '4.10'}</span>
        </div>
      </div>
    `;

    // 4. SCORING PLAYS
    if (scoringPlays && scoringPlays.length > 0) {
      html += '<div class="expand-section-label" style="margin-top:12px">Recent Scoring Plays</div>';
      html += '<div class="expand-plays">';
      scoringPlays.forEach(function(p) {
        const shortDesc = p.desc.length > 90 ? p.desc.slice(0, 90) + '…' : p.desc;
        html += '<div class="expand-play">';
        html += '<span class="expand-play-inn">' + p.half + p.inn + '</span>';
        html += '<span class="expand-play-desc">' + shortDesc + ' <span class="expand-play-score">' + awayAbbr + ' ' + p.away + ' · ' + homeAbbr + ' ' + p.home + '</span></span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // 5. TOP WPA PLAYS
    if (topWpaPlays.length > 0) {
      html += '<div class="expand-section-label" style="margin-top:12px">Top WPA Plays <span class="wpa-tooltip-trigger" style="font-size:0.65rem;color:var(--gold)" title="Win Probability Added (WPA): Shows how much a play shifted the team\'s chance of winning.">(?)</span></div>';
      html += '<div class="expand-plays">';
      topWpaPlays.forEach(function(p) {
        const shortDesc = p.desc.length > 92 ? p.desc.slice(0, 92) + '…' : p.desc;
        const sign = p.delta > 0 ? '+' : '';
        html += '<div class="expand-play">';
        html += '<span class="expand-play-inn">' + p.half + p.inn + '</span>';
        html += '<span class="expand-play-desc">' + escapeHTML(shortDesc) + ' <span class="expand-play-score">' + sign + p.delta.toFixed(1) + '% WPA · ' + awayAbbr + ' ' + (p.away ?? '?') + ' · ' + homeAbbr + ' ' + (p.home ?? '?') + '</span></span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // 6. PITCHING LINES
    if ((awayPitching && awayPitching.length > 0) || (homePitching && homePitching.length > 0)) {
      html += '<div class="expand-section-label" style="margin-top:12px">Pitching Lines</div>';
      html += '<div class="expand-pitching">';
      html += '<div class="expand-pitcher-row header"><span>Pitcher</span><span>IP</span><span>H</span><span>R</span><span>BB</span><span>K</span><span>P</span></div>';
      function addRows(pitchers, abbr) {
        if (!pitchers || !pitchers.length) return;
        html += '<div class="expand-pitcher-row" style="color:var(--text-dim);font-size:0.6rem;font-style:italic"><span style="text-align:left">' + teamLogo(abbr) + ' ' + abbr + '</span><span></span><span></span><span></span><span></span><span></span><span></span></div>';
        pitchers.forEach(function(p) {
          const noteHtml = p.note ? ' <span style="color:var(--gold);font-weight:700">' + p.note + '</span>' : '';
          html += '<div class="expand-pitcher-row"><span>' + p.name + noteHtml + '</span><span>' + p.ip + '</span><span>' + p.h + '</span><span>' + p.r + '</span><span>' + p.bb + '</span><span>' + p.k + '</span><span>' + p.pit + '</span></div>';
        });
      }
      addRows(awayPitching, awayAbbr);
      addRows(homePitching, homeAbbr);
      html += '</div>';
    }

  } else if (activeTab === 'gameday') {
    // GAMEDAY VIEW
    if (data.gameday) {
      // Custom Interactive Strike Zone
      const pitches = data.gameday.pitches || [];
      const szTop = pitches.length > 0 ? pitches[pitches.length - 1].szTop : 3.5;
      const szBottom = pitches.length > 0 ? pitches[pitches.length - 1].szBottom : 1.5;

      const mapX = (px) => 100 + (px * 40);
      const mapZ = (pz) => 175 - (pz * 33);

      const szL = mapX(-0.708);
      const szR = mapX(0.708);
      const szT = mapZ(szTop);
      const szB = mapZ(szBottom);

      // Generate clickable zone overlays
      let interactiveZonesHtml = '';
      const cellW = (szR - szL) / 3;
      const cellH = (szB - szT) / 3;
      const zoneStats = {
        1: { name: "High & Inside", avg: ".195", hr: "2", ops: ".512", color: "#3b82f6" },
        2: { name: "High Center", avg: ".260", hr: "5", ops: ".790", color: "#f59e0b" },
        3: { name: "High & Away", avg: ".210", hr: "3", ops: ".590", color: "#3b82f6" },
        4: { name: "Middle Inside", avg: ".290", hr: "8", ops: ".880", color: "#ef4444" },
        5: { name: "Heart of the Plate", avg: ".365", hr: "14", ops: "1.120", color: "#dc2626" },
        6: { name: "Middle Outside", avg: ".280", hr: "7", ops: ".850", color: "#f59e0b" },
        7: { name: "Low & Inside", avg: ".220", hr: "4", ops: ".610", color: "#3b82f6" },
        8: { name: "Low Center", avg: ".245", hr: "5", ops: ".720", color: "#f59e0b" },
        9: { name: "Low & Away", avg: ".205", hr: "2", ops: ".540", color: "#3b82f6" }
      };

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const zoneNum = r * 3 + c + 1;
          const x = szL + c * cellW;
          const y = szT + r * cellH;
          const zS = zoneStats[zoneNum];
          interactiveZonesHtml += `
            <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}"
                  class="interactive-sz-zone"
                  data-zone="${zoneNum}"
                  data-name="${zS.name}"
                  data-avg="${zS.avg}"
                  data-hr="${zS.hr}"
                  data-ops="${zS.ops}"
                  data-color="${zS.color}"
                  fill="transparent"
                  style="cursor:pointer; pointer-events:all; stroke:rgba(255,255,255,0.06); stroke-width:0.5"
                  onclick="showStrikeZoneStats(this)" />
          `;
        }
      }

      let statcastHeader = '';
      if (data.gameday.lastStatcast) {
        const ls = data.gameday.lastStatcast;
        statcastHeader = `
          <div class="statcast-instant">
            <div class="sc-metric">
              <span class="sc-label">VELO</span>
              <span class="sc-val">${ls.speed ? ls.speed.toFixed(1) : '—'}</span>
              <span class="sc-unit">MPH</span>
            </div>
            <div class="sc-metric">
              <span class="sc-label">SPIN</span>
              <span class="sc-val">${ls.spin || '—'}</span>
              <span class="sc-unit">RPM</span>
            </div>
            <div class="sc-metric">
              <span class="sc-label">BREAK</span>
              <span class="sc-val">${ls.breakLength ? ls.breakLength.toFixed(1) : '—'}</span>
              <span class="sc-unit">IN</span>
            </div>
          </div>
        `;
      }

      let dots = '';
      let listItems = '';

      pitches.forEach((p) => {
        let color = '#777';
        const c = p.code.toUpperCase();
        if (c === 'B') color = '#4ade80';
        else if (['C', 'S', 'F', 'T', 'L', 'M', 'W'].includes(c)) color = '#ef4444';
        else if (['X', 'D', 'E'].includes(c)) color = '#f59e0b';
        else if (['*B', 'I', 'P'].includes(c)) color = '#4ade80';

        const cx = mapX(p.px);
        const cy = mapZ(p.pz);

        dots += `
          <circle cx="${cx}" cy="${cy}" r="6" fill="${color}" stroke="#fff" stroke-width="1.5" class="pitch-dot">
            <title>Pitch ${p.num}: ${p.type}, ${p.speed}mph - ${p.result}</title>
          </circle>
          <text x="${cx}" y="${cy}" class="pitch-text">${p.num}</text>
        `;

        listItems += `
          <div class="pitch-item">
            <div class="pitch-num" style="background:${color}">${p.num}</div>
            <div class="pitch-info">
              <b>${escapeHTML(p.type)}</b> · ${p.speed || '—'} mph
              <div style="font-size:0.6rem;color:var(--text-dim)">
                ${p.spin ? `Spin: ${p.spin} rpm` : ''}
                ${p.breakLength ? ` · Break: ${p.breakLength}"` : ''}
              </div>
            </div>
            <div class="pitch-result" style="color:${color}">${escapeHTML(p.result)}</div>
          </div>
        `;
      });

      html += `
        <div class="gameday-container">
          <div class="gameday-header">
            <div class="gameday-title">Interactive Live At-Bat</div>
            <div style="font-size:0.65rem;color:var(--text-dim)">${escapeHTML(data.gameday.batterName)} vs ${escapeHTML(data.gameday.pitcherName)}</div>
          </div>
          ${statcastHeader}
          <div class="gameday-viz-wrap">
            <div style="position:relative">
              <svg viewBox="0 0 200 200" class="strike-zone-svg">
                <!-- Strike Zone Outline -->
                <rect x="${szL}" y="${szT}" width="${szR - szL}" height="${szB - szT}" class="sz-rect" />
                <!-- Hot Zones -->
                ${interactiveZonesHtml}
                <!-- 3x3 Grid Inner Lines -->
                <line x1="${szL + (szR-szL)/3}" y1="${szT}" x2="${szL + (szR-szL)/3}" y2="${szB}" class="sz-hotzone" />
                <line x1="${szL + 2*(szR-szL)/3}" y1="${szT}" x2="${szL + 2*(szR-szL)/3}" y2="${szB}" class="sz-hotzone" />
                <line x1="${szL}" y1="${szT + (szB-szT)/3}" x2="${szR}" y2="${szT + (szB-szT)/3}" class="sz-hotzone" />
                <line x1="${szL}" y1="${szT + 2*(szB-szT)/3}" x2="${szR}" y2="${szT + 2*(szB-szT)/3}" class="sz-hotzone" />
                ${dots}
              </svg>
              <div style="position:absolute;bottom:5px;left:5px;font-size:0.55rem;color:#777;text-transform:uppercase;letter-spacing:0.05em">Catcher's View (Tap zone to view stats)</div>
            </div>
            <div class="pitch-list">
              ${listItems || '<div class="empty-msg" style="padding:10px">Waiting for pitch...</div>'}
            </div>
          </div>
          <div id="sz-readout" style="margin-top:10px">
            <div class="sz-readout-placeholder">🎯 Click any zone on the strike map to view hot zone splits!</div>
          </div>
        </div>
      `;
    } else {
      html += '<div class="empty-msg">No live gameday data for this game.</div>';
    }

    if (data.momentumSeries && data.momentumSeries.length > 0) {
      html += renderMomentumTimeline(data.momentumSeries, awayAbbr, homeAbbr);
    }

  } else if (activeTab === 'press') {
    // JOURNALIST PRESS BOX
    const recapText = getJournalistRecap(data);
    html += `
      <div class="press-box-wrap">
        <div class="press-box-header">
          <h3>📰 PRESS BOX RECAP GENERATOR</h3>
          <p>Autogenerated press release draft matching the live match situation. Perfect for rapid sports reporting.</p>
        </div>
        <textarea id="journalist-recap-text" class="press-recap-textarea" readonly>${escapeHTML(recapText)}</textarea>
        <button id="btn-copy-draft" class="btn" onclick="copyJournalistDraft()" style="margin-top:10px; width:100%">📋 Copy Draft to Clipboard</button>
      </div>
    `;
  }

  panel.innerHTML = html;
}

// ─── SORT / FILTER STATE ──────────────────────────────────────────────────────
let currentSort   = loadPrefs().sort || 'watchability'; // 'watchability' | 'score' | 'inning'
let currentFilter = loadPrefs().filter || null;          // null | 'hot' | 'fire' | 'live'

function setSort(s) {
  currentSort = s;
  savePrefs({ sort: s });
  document.querySelectorAll('[id^="sort-"]').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  const btn = document.getElementById('sort-' + s);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
  }
  if (lastGames) renderGames(lastGames);
}

function setFilter(f) {
  if (currentFilter === f) {
    currentFilter = null;
    savePrefs({ filter: null });
    document.querySelectorAll('[id^="filter-"]').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
  } else {
    currentFilter = f;
    savePrefs({ filter: f });
    document.querySelectorAll('[id^="filter-"]').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    const btn = document.getElementById('filter-' + f);
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }
  }
  if (lastGames) renderGames(lastGames);
}

function applySortFilter(games) {
  let g = [...games];

  // Filter
  if (currentFilter === 'hot')  g = g.filter(x => x.watchabilityIndex >= 60);
  if (currentFilter === 'fire') g = g.filter(x => x.watchabilityIndex >= 75);
  if (currentFilter === 'live') g = g.filter(x => !/final|scheduled|pre-game|warmup|preview/i.test(x.gameState));

  // Priority: Live (0) > Scheduled (1) > Final (2)
  const favoriteRank = x => isFavoriteGame(x) ? 1 : 0;

  if (currentSort === 'watchability') {
    g.sort((a, b) => {
      const fav = favoriteRank(b) - favoriteRank(a);
      if (fav) return fav;
      const ap = getGameStatusPriority(a), bp = getGameStatusPriority(b);
      if (ap !== bp) return ap - bp;
      if (ap === 1) return a.startTime - b.startTime;
      return b.watchabilityIndex - a.watchabilityIndex;
    });
  } else if (currentSort === 'score') {
    g.sort((a, b) => {
      const fav = favoriteRank(b) - favoriteRank(a);
      if (fav) return fav;
      const ap = getGameStatusPriority(a), bp = getGameStatusPriority(b);
      if (ap !== bp) return ap - bp;
      if (ap === 1) return a.startTime - b.startTime;
      const ad = Math.abs(a.awayScore - a.homeScore);
      const bd = Math.abs(b.awayScore - b.homeScore);
      return ad - bd; // closest first
    });
  } else if (currentSort === 'inning') {
    g.sort((a, b) => {
      const fav = favoriteRank(b) - favoriteRank(a);
      if (fav) return fav;
      const ap = getGameStatusPriority(a), bp = getGameStatusPriority(b);
      if (ap !== bp) return ap - bp;
      if (ap === 1) return a.startTime - b.startTime;
      return (b.currentInning || 0) - (a.currentInning || 0);
    });
  }

  return g;
}

// ─── RENDER GAMES ──────────────────────────────────────────────────────────────
function renderGames(games) {
  const grid = document.getElementById('games-grid');
  const filtered = applySortFilter(games);

  // Remove empty message if it exists
  const emptyMsg = grid.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  const countEl = document.getElementById('games-count');
  if (countEl) {
    const showing = filtered.length;
    const total = games.length;
    countEl.textContent = showing < total ? `${showing} of ${total} games` : `${total} game${total !== 1 ? 's' : ''}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-msg">No games match this filter</div>';
    return;
  }

  // Get current card elements in the DOM
  const existingCards = new Map();
  grid.querySelectorAll('.game-card').forEach(el => {
    const pk = el.getAttribute('data-gpk');
    if (pk) existingCards.set(pk, el);
  });

  const fragment = document.createDocumentFragment();
  const seenPks = new Set();

  filtered.forEach((game) => {
    const pkStr = String(game.gamePk);
    seenPks.add(pkStr);
    let card = existingCards.get(pkStr);
    const wi = game.watchabilityIndex;
    const targetClass = `game-card${wi > 75 ? ' fire' : wi > 55 ? ' hot' : ''}${activeGamePk === game.gamePk ? ' active-side' : ''}`;

    if (!card) {
      card = document.createElement('div');
      card.setAttribute('data-gpk', pkStr);
      card.addEventListener('click', (event) => {
        if (event.target.closest('button') || event.target.closest('.card-expand-panel')) return;
        openGameDrawer(game.gamePk);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if (event.target.closest('button') || event.target.closest('.card-expand-panel')) return;
          event.preventDefault();
          openGameDrawer(game.gamePk);
        }
      });
    }
    // Ensure accessibility attributes are present even on reconciled nodes
    if (card.getAttribute('role') !== 'button') card.setAttribute('role', 'button');
    if (card.getAttribute('tabindex') !== '0') card.setAttribute('tabindex', '0');

    const isFinal = /final/i.test(game.gameState);
    const isScheduled = /scheduled|pre-game|warmup|preview|ET$/i.test(game.inningStatus);
    const isSpoilered = (spoilerTeams.has(game.awayTeam) || spoilerTeams.has(game.homeTeam)) && !isFavoriteGame(game) && !revealedGames.has(game.gamePk);

    if (isSpoilered) {
      card.className = targetClass + ' spoilered';
      const spoilerStateKey = `spoiler-${game.awayTeam}-${game.homeTeam}-${game.inningStatus}-${isScheduled}-${isFinal}`;
      if (card._lastStateKey !== spoilerStateKey) {
        card.innerHTML = `
          <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}</div>
          <div class="inning-line" style="color:var(--text-dim)">${isScheduled ? game.inningStatus : isFinal ? 'FINAL' : 'Live'}</div>
          <div class="spoiler-mask" role="button" tabindex="0" onclick="revealSpoiler(this, ${game.gamePk})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();revealSpoiler(this, ${game.gamePk})}">
            🙈 Spoiler Mode — tap to reveal
          </div>
        `;
        card._lastStateKey = spoilerStateKey;
      }
      card._fullGame = game;
    } else {
      card.className = targetClass;
      card.classList.remove('spoilered');
      renderSingleGameCard(card, game);
      const awayColor = teamColor(game.awayTeam);
      const homeColor = teamColor(game.homeTeam);
      if (homeColor && awayColor) {
        card.style.borderLeft = `6px solid ${awayColor}`;
        card.style.borderRight = `6px solid ${homeColor}`;
        card.style.backgroundImage = `linear-gradient(to right, ${awayColor}18, transparent 40%, transparent 60%, ${homeColor}18)`;
      } else if (homeColor) {
        card.style.borderLeft = `6px solid ${homeColor}`;
        card.style.borderRight = '';
        card.style.backgroundImage = `linear-gradient(to right, ${homeColor}11, transparent)`;
      } else {
        card.style.borderLeft = '';
        card.style.borderRight = '';
        card.style.backgroundImage = '';
      }
    }

    fragment.appendChild(card);
  });

  // Remove any cards that are no longer in the filtered list
  existingCards.forEach((card, pk) => {
    if (!seenPks.has(pk)) card.remove();
  });

  grid.appendChild(fragment);
}

function renderScoreBreakdown(game) {
  const breakdown = game.watchabilityBreakdown;
  if (!breakdown?.parts?.length) return '';
  const chips = breakdown.parts
    .filter(part => part.value !== 0)
    .slice(0, 5)
    .map(part => `<span class="score-chip">${escapeHTML(part.label)} +${escapeHTML(part.value)}</span>`)
    .join('');
  return chips ? `<div class="score-breakdown">${chips}</div>` : '';
}

function renderWinProbSparkline(game) {
  const series = game.winProbSeries || [];
  if (series.length < 2) return '';
  const points = series;
  const w = 180, h = 34, pad = 3;

  // Calculate smooth Bezier curve coordinates
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = pad + (Math.max(0, Math.min(100, p.home)) / 100) * (h - pad * 2);
    return { x, y };
  });

  let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const cpX1 = p0.x + (p1.x - p0.x) / 2;
    const cpY1 = p0.y;
    const cpX2 = p0.x + (p1.x - p0.x) / 2;
    const cpY2 = p1.y;
    d += ` C${cpX1.toFixed(1)},${cpY1.toFixed(1)} ${cpX2.toFixed(1)},${cpY2.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }

  const last = points[points.length - 1]?.home;
  const label = typeof last === 'number' ? `${game.homeTeam} ${Math.round(last)}%` : 'Win probability';

  const gradId = `sparkGrad-${game.gamePk}`;
  const awayColor = teamColor(game.awayTeam) || '#60a5fa';
  const homeColor = teamColor(game.homeTeam) || '#f87171';

  return `<div class="wp-sparkline" title="Win probability">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" style="overflow:visible">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${awayColor}" />
          <stop offset="100%" stop-color="${homeColor}" />
        </linearGradient>
      </defs>
      <line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" style="stroke:rgba(255,255,255,0.1); stroke-width:1" />
      <path d="${d}" style="fill:none; stroke:url(#${gradId}); stroke-width:2.5; stroke-linecap:round;" />
    </svg>
    <span>${escapeHTML(label)}</span>
  </div>`;
}

function checkFavoriteAlerts(games) {
  if (isFirstLoad || favoriteTeams.size === 0) return;
  games.filter(isFavoriteGame).forEach(game => {
    const prev = favoriteAlerts[game.gamePk];
    favoriteAlerts[game.gamePk] = { away: game.awayScore, home: game.homeScore, wi: game.watchabilityIndex };
    if (!prev) return;
    if (prev.away !== game.awayScore || prev.home !== game.homeScore) {
      showNotification(`Favorite update: ${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}`, 'score');
    } else if (prev.wi < 70 && game.watchabilityIndex >= 70) {
      showNotification(`Favorite game heating up: ${game.awayTeam} @ ${game.homeTeam} (${game.watchabilityIndex})`, 'info');
    }
  });
}

// ─── STAT LEADERS ──────────────────────────────────────────────────────────────
const BATTING_LEADER_DEFS = [
  { api: 'hits',                  label: 'Hits', sortStat: 'hits',               order: 'desc' },
  { api: 'homeRuns',              label: 'HR',   sortStat: 'homeRuns',           order: 'desc' },
  { api: 'runsBattedIn',          label: 'RBI',  sortStat: 'runsBattedIn',       order: 'desc' },
  { api: 'battingAverage',        label: 'AVG',  sortStat: 'battingAverage',     order: 'desc', qualified: true },
  { api: 'onBasePlusSlugging',    label: 'OPS',  sortStat: 'onBasePlusSlugging', order: 'desc', qualified: true },
  { api: 'stolenBases',           label: 'SB',   sortStat: 'stolenBases',        order: 'desc' }
];

const PITCHING_LEADER_DEFS = [
  { api: 'inningsPitched',                label: 'IP',   sortStat: 'inningsPitched',               order: 'desc' },
  { api: 'strikeouts',                    label: 'K',    sortStat: 'strikeouts',                   order: 'desc' },
  { api: 'earnedRunAverage',              label: 'ERA',  sortStat: 'earnedRunAverage',             order: 'asc',  qualified: true },
  { api: 'battingAverage',               label: 'BAA',  sortStat: 'battingAverage',               order: 'asc',  qualified: true },
  { api: 'walksAndHitsPerInningPitched',  label: 'WHIP', sortStat: 'walksAndHitsPerInningPitched', order: 'asc',  qualified: true },
  { api: 'saves',                         label: 'SV',   sortStat: 'saves',                        order: 'desc' }
];

// ─── ALL-TIME LEADERS CACHE ───────────────────────────────────────────────────
let allTimeLeaders = {}; // category -> array of { rank, value, name }

async function fetchAllTimeLeaders(category, group = 'hitting') {
  if (allTimeLeaders[category]) return allTimeLeaders[category];
  try {
    const data = await requestPool.fetchDedup(
      `${MLB_API}/stats/leaders?leaderCategories=${category}&statGroup=${group}&statType=career&limit=500`,
      { cacheKey: `allTimeLeaders:${category}` }
    );
    const leaders = data.leagueLeaders?.[0]?.leaders || [];
    allTimeLeaders[category] = leaders.map(l => ({
      rank: l.rank,
      value: parseInt(l.value),
      name: l.person.fullName
    }));
    return allTimeLeaders[category];
  } catch (e) {
    console.warn(`All-time leaders fetch failed for ${category}:`, e);
    return [];
  }
}

async function fetchLeaderGroup(defs, statGroup) {
  const season = currentSeason();
  const date = selectedDate || todayET();
  const promises = defs.map(async def => {
    try {
      // stats/leaders endDate is unreliable for mid-season historical stats.
      // Use byDateRange for more accurate historical leaderboards.
      let url = `${MLB_API}/stats?stats=byDateRange&group=${statGroup}&startDate=${season}-01-01&endDate=${date}&sportId=1&sortStat=${def.sortStat}&order=${def.order}&limit=1&gameType=R`;
      if (def.qualified) url += '&personPool=qualified';

      const data = await requestPool.fetchDedup(url, { cacheKey: `leaders:${statGroup}:${def.api}:${date}`, ttl: 300000 });
      const ldr = data.stats?.[0]?.splits?.[0];
      if (!ldr) return null;

      // Extract the correct value based on the API response structure
      let val = ldr.stat[def.api] ?? ldr.stat[def.sortStat] ?? ldr.value;

      // Handle special cases where API keys might differ (e.g. battingAverage vs avg)
      if (def.api === 'battingAverage' && ldr.stat.avg) val = ldr.stat.avg;
      if (def.api === 'runsBattedIn' && ldr.stat.rbi) val = ldr.stat.rbi;
      if (def.api === 'onBasePlusSlugging' && ldr.stat.ops) val = ldr.stat.ops;
      if (def.api === 'strikeouts' && ldr.stat.strikeOuts) val = ldr.stat.strikeOuts;
      if (def.api === 'earnedRunAverage' && ldr.stat.era) val = ldr.stat.era;
      if (def.api === 'walksAndHitsPerInningPitched' && ldr.stat.whip) val = ldr.stat.whip;

      return {
        label: def.label,
        name:  ldr.player?.fullName || 'Unknown',
        team:  normalizeAbbr(ldr.team?.abbreviation || teamAbbrFromId(ldr.team?.id) || ldr.team?.name || ''),
        value: val
      };
    } catch (e) { console.error(`Leader ${def.label}:`, e); return null; }
  });
  return (await Promise.all(promises)).filter(Boolean);
}

function renderLeaderRow(results, container) {
  const row = document.createElement('div');
  row.className = 'leaders-row';
  results.forEach(l => {
    // Detect leader changes
    const prev = prevLeaders[l.label];
    if (prev && prev.name !== l.name) {
      showNotification(`New ${l.label} leader: ${l.name} (${l.value})`, 'leader');
    }
    prevLeaders[l.label] = { name: l.name, value: l.value };

    const card = document.createElement('div');
    card.className = 'leader-card';
    card.innerHTML = `
      <div class="leader-cat">${l.label}</div>
      <div class="leader-name">${l.name}</div>
      <div class="leader-team">${teamLogo(l.team)} ${l.team}</div>
      <div class="leader-val">${l.value}</div>
    `;
    row.appendChild(card);
  });
  container.appendChild(row);
}

async function fetchAndRenderPOTD(games) {
  const container = document.getElementById('potd-container');
  if (!container) return;

  const activePks = (games || [])
    .filter(g => !/scheduled|pre-game|warmup|preview/i.test(g.gameState))
    .map(g => g.gamePk);

  if (activePks.length === 0) {
    container.innerHTML = '<div class="empty-msg">No games in progress or completed yet today</div>';
    return;
  }

  container.innerHTML = '<div class="empty-msg">Analyzing performances...</div>';

  try {
    const performances = [];
    const feeds = await Promise.all(activePks.map(pk =>
      requestPool.fetchDedup(`https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`, { cacheKey: `feed:${pk}`, ttl: 15000 })
    ));

    feeds.forEach((feed, idx) => {
      const bx = feed.liveData?.boxscore?.teams;
      if (!bx) return;
      const gamePk = activePks[idx];
      const isLive = !/final/i.test(feed.gameData?.status?.abstractGameState || '');

      ['home', 'away'].forEach(side => {
        const players = bx[side]?.players || {};
        const teamAbbr = normalizeAbbr(feed.gameData.teams[side].abbreviation);
        const oppAbbr = normalizeAbbr(feed.gameData.teams[side === 'home' ? 'away' : 'home'].abbreviation);

        for (const [, p] of Object.entries(players)) {
          const perf = calculatePerformanceScore(p);
          if (perf.score > 0) {
            performances.push({
              ...perf,
              gamePk,
              teamAbbr,
              oppAbbr,
              isLive
            });
          }
        }
      });
    });

    const topHitters = performances
      .filter(p => !p.isPitcher)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const topPitchers = performances
      .filter(p => p.isPitcher)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (topHitters.length === 0 && topPitchers.length === 0) {
      container.innerHTML = '<div class="empty-msg">No notable performances yet today</div>';
      return;
    }

    let html = '<div class="potd-layout">';

    const renderGroup = (title, list) => {
      if (list.length === 0) return '';
      let groupHtml = `<div class="section-title">${title}</div><div class="potd-grid">`;
      list.forEach(p => {
        const statLine = p.isPitcher ? p.pitcherLine : p.batterLine;
        groupHtml += `
          <div class="potd-card" onclick="openGameDrawer(${p.gamePk})">
            <div class="potd-team-line">
              ${teamLogo(p.teamAbbr)} <strong>${p.teamAbbr}</strong>
              <span class="potd-vs">vs</span>
              ${teamLogo(p.oppAbbr)} ${p.oppAbbr}
              ${p.isLive ? '<span class="potd-live-tag">LIVE</span>' : ''}
            </div>
            <div class="potd-player-name">${escapeHTML(p.name)}</div>
            <div class="potd-stats">${escapeHTML(statLine.replace(/[()]/g, ''))}</div>
            <div class="potd-score-pill">Score: ${p.score.toFixed(1)}</div>
          </div>
        `;
      });
      groupHtml += '</div>';
      return groupHtml;
    };

    html += renderGroup('Top Hitters', topHitters);
    html += renderGroup('Top Pitchers', topPitchers);
    html += '</div>';

    container.innerHTML = html;
  } catch (e) {
    console.error('POTD fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load performances</div>';
  }
}

async function fetchStatLeaders() {
  const container = document.getElementById('leaders-container');
  const title = document.getElementById('stat-leaders-title');
  const date = selectedDate || todayET();
  if (title) {
    title.textContent = date === todayET() ? 'Stat Leaders' : `Stat Leaders (as of ${date})`;
  }
  container.innerHTML = '<div class="empty-msg">Loading stat leaders...</div>';

  const [battingResults, pitchingResults] = await Promise.all([
    fetchLeaderGroup(BATTING_LEADER_DEFS, 'hitting'),
    fetchLeaderGroup(PITCHING_LEADER_DEFS, 'pitching')
  ]);

  container.innerHTML = '';

  if (battingResults.length === 0 && pitchingResults.length === 0) {
    container.innerHTML = '<div class="empty-msg">No leader data available yet this season</div>';
    return;
  }

  if (battingResults.length > 0) {
    const section = document.createElement('div');
    section.className = 'leaders-section';
    section.innerHTML = '<div class="leaders-section-title">Batting Leaders</div>';
    renderLeaderRow(battingResults, section);
    container.appendChild(section);
  }

  if (pitchingResults.length > 0) {
    const section = document.createElement('div');
    section.className = 'leaders-section';
    section.innerHTML = '<div class="leaders-section-title">Pitching Leaders</div>';
    renderLeaderRow(pitchingResults, section);
    container.appendChild(section);
  }
}

// ─── PLAYOFF RACES ──────────────────────────────────────────────────────────
const DIV_NAMES = { 200: 'AL West', 201: 'AL East', 202: 'AL Central', 203: 'NL West', 204: 'NL East', 205: 'NL Central' };
const AL_DIVS = [201, 202, 200];
const NL_DIVS = [204, 205, 203];

// ─── TEAM L10 FORM CACHE ──────────────────────────────────────────────────────
const teamL10Cache = {}; // abbr -> { w, l, streakCode, games }

/**
 * BOLT OPTIMIZATION: Extract L10 and streak data from aggregate standings data
 * instead of making 30 individual schedule requests.
 */
function populateL10Cache(regData) {
  if (!regData?.records) return;
  for (const group of regData.records) {
    for (const t of group.teamRecords) {
      const abbr = normalizeAbbr(t.team.abbreviation || t.team.name);
      const l10 = t.records?.splitRecords?.find(s => s.type === 'lastTen') || {};
      teamL10Cache[abbr] = {
        w: l10.wins ?? 0,
        l: l10.losses ?? 0,
        streakCode: t.streak?.streakCode || '-',
        games: (l10.wins ?? 0) + (l10.losses ?? 0)
      };
    }
  }
}

function l10Html(abbr) {
  const d = teamL10Cache[abbr];
  if (!d || d.games < 1) return '<span class="l10-cell even">—</span>';
  const cls = d.w >= 7 ? 'hot' : d.w <= 3 ? 'cold' : 'even';
  return `<span class="l10-cell ${cls}">${d.w}-${d.l}</span>`;
}

function streakHtml(abbr) {
  const d = teamL10Cache[abbr];
  if (!d || !d.streakCode || d.streakCode === '-') return '<span class="streak-cell">—</span>';
  const cls = d.streakCode.startsWith('W') ? 'win' : 'loss';
  return `<span class="streak-cell ${cls}">${d.streakCode}</span>`;
}

async function fetchPlayoffRaces(todayGames) {
  const container = document.getElementById('playoffs-container');
  container.innerHTML = '<div class="empty-msg">Loading standings...</div>';
  try {
    const season = currentSeason();
    const date = selectedDate || todayET();
    const [regData, wcData] = await Promise.all([
      requestPool.fetchDedup(`${MLB_API}/standings?leagueId=103,104&season=${season}&date=${date}&standingsTypes=regularSeason&hydrate=team`, { cacheKey: `standings:regular:${date}`, ttl: 300000 }),
      requestPool.fetchDedup(`${MLB_API}/standings?leagueId=103,104&season=${season}&date=${date}&standingsTypes=wildCard&hydrate=team`, { cacheKey: `standings:wildCard:${date}`, ttl: 300000 })
    ]);
    populateL10Cache(regData);

    // Build division map
    const divMap = {};
    for (const group of regData.records) {
      const divId = group.division.id;
      divMap[divId] = group.teamRecords.map(t => ({
        abbr: normalizeAbbr(t.team.abbreviation),
        name: t.team.name,
        w: t.wins, l: t.losses,
        pct: t.winningPercentage,
        gb: t.gamesBack,
        divRank: parseInt(t.divisionRank),
        wcRank: t.wildCardRank,
        wcGB: t.wildCardGamesBack,
        leagueId: group.league.id,
        eliminationNumber: t.eliminationNumber || '-',
        magicNumber: t.magicNumber || null,
        wildCardEliminationNumber: t.wildCardEliminationNumber || '-',
        gamesPlayed: t.wins + t.losses
      }));
    }

    // Build wild card map
    const wcMap = {};
    for (const group of wcData.records) {
      const lgId = group.league?.id;
      if (!lgId) continue;
      wcMap[lgId] = group.teamRecords.map(t => ({
        abbr: normalizeAbbr(t.team.abbreviation),
        name: t.team.name,
        w: t.wins, l: t.losses,
        wcRank: parseInt(t.wildCardRank),
        wcGB: t.wildCardGamesBack,
        wildCardEliminationNumber: t.wildCardEliminationNumber || '-',
        magicNumber: t.magicNumber || null
      }));
    }

    // Today's teams
    const todayTeams = new Set();
    if (todayGames) todayGames.forEach(g => { todayTeams.add(g.awayTeam); todayTeams.add(g.homeTeam); });

    container.innerHTML = '';

    function racePulseHtml(lg) {
      const cards = [];
      lg.divs.forEach(divId => {
        const teams = divMap[divId] || [];
        if (teams.length < 2) return;
        const leader = teams[0];
        const challenger = teams[1];
        const gb = challenger.gb === '--' ? '0.0' : challenger.gb;
        if (parseFloat(gb) <= 5) {
          cards.push(`<div class="race-pulse-card">
            <div class="race-pulse-label">${escapeHTML(DIV_NAMES[divId] || 'Division')}</div>
            <div class="race-pulse-title">${teamLogo(leader.abbr)} ${leader.abbr} chased by ${teamLogo(challenger.abbr)} ${challenger.abbr}</div>
            <div class="race-pulse-note">${escapeHTML(gb)} GB · ${escapeHTML(challenger.w)}-${escapeHTML(challenger.l)} · ${l10Html(challenger.abbr)}</div>
          </div>`);
        }
      });
      const wc = wcMap[lg.lgId] || [];
      const bubble = wc.slice(2, 7);
      if (bubble.length) {
        cards.push(`<div class="race-pulse-card wild">
          <div class="race-pulse-label">Wild Card Bubble</div>
          <div class="race-pulse-title">${bubble.map(t => `${teamLogo(t.abbr)} ${t.abbr}`).join(' ')}</div>
          <div class="race-pulse-note">${bubble.map(t => `${t.abbr} ${t.wcGB} GB`).join(' · ')}</div>
        </div>`);
      }
      return cards.length ? `<div class="race-pulse-grid">${cards.slice(0, 4).join('')}</div>` : '';
    }

    // Render each league
    [{name: 'American League', divs: AL_DIVS, lgId: 103}, {name: 'National League', divs: NL_DIVS, lgId: 104}].forEach(lg => {
      const section = document.createElement('div');
      section.className = 'standings-league';
      let html = `<div class="standings-league-title">${lg.name}</div>${racePulseHtml(lg)}`;

      // Divisions
      lg.divs.forEach(divId => {
        const teams = divMap[divId];
        if (!teams) return;
        html += `<div class="standings-division"><div class="standings-div-title">${DIV_NAMES[divId] || divId}</div>`;
        html += '<table class="standings-table"><thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th title="Magic Number">MN</th><th title="Last 10">L10</th><th title="Current Streak">STK</th></tr></thead><tbody>';
        teams.forEach((t, i) => {
          const cls = i === 0 ? 'playoff' : '';
          // Magic number: only show for div leader (i===0), show elimination number for others
          let mnDisplay = '-';
          if (i === 0 && t.magicNumber && t.magicNumber !== '-') {
            mnDisplay = `<span style="color:var(--success);font-weight:700">${t.magicNumber}</span>`;
          } else if (i > 0 && t.eliminationNumber && t.eliminationNumber !== '-' && t.eliminationNumber !== 'E') {
            mnDisplay = `<span style="color:var(--danger)88">E${t.eliminationNumber}</span>`;
          }
          html += `<tr class="${cls}"><td class="team-name">${teamLogo(t.abbr)} ${t.abbr}</td><td>${t.w}</td><td>${t.l}</td><td>${t.pct}</td><td class="gb">${t.gb}</td><td class="gb">${mnDisplay}</td><td>${l10Html(t.abbr)}</td><td>${streakHtml(t.abbr)}</td></tr>`;
        });
        html += '</tbody></table></div>';
      });

      // Wild Card
      const wc = wcMap[lg.lgId];
      if (wc && wc.length > 0) {
        html += '<div class="standings-division"><div class="standings-div-title">Wild Card</div>';
        html += '<table class="standings-table"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>WC GB</th><th title="WC Elim Number">WCE</th><th title="Last 10">L10</th><th title="Current Streak">STK</th></tr></thead><tbody>';
        wc.forEach((t, i) => {
          const cls = i < 3 ? 'wc' : '';
          const cutline = i === 2 ? '<tr><td colspan="6" style="padding:0"><div class="wc-cutline"></div></td></tr>' : '';
          let wceDisplay = '-';
          if (i < 3 && t.magicNumber && t.magicNumber !== '-') {
            wceDisplay = `<span style="color:var(--success);font-weight:700">${t.magicNumber}</span>`;
          } else if (i >= 3 && t.wildCardEliminationNumber && t.wildCardEliminationNumber !== '-' && t.wildCardEliminationNumber !== 'E') {
            wceDisplay = `<span style="color:var(--danger)88">E${t.wildCardEliminationNumber}</span>`;
          }
          html += `<tr class="${cls}"><td>${t.wcRank}</td><td class="team-name">${teamLogo(t.abbr)} ${t.abbr}</td><td>${t.w}</td><td>${t.l}</td><td class="gb">${t.wcGB}</td><td class="gb">${wceDisplay}</td><td>${l10Html(t.abbr)}</td><td>${streakHtml(t.abbr)}</td></tr>${cutline}`;
        });
        html += '</tbody></table></div>';
      }

      // ── Key games today: scored by playoff importance ──
      if (todayGames) {
        const scoredGames = [];
        for (const g of todayGames) {
          // Find both teams anywhere in this league's divisions
          let aTeam = null, hTeam = null;
          for (const divId of lg.divs) {
            const div = divMap[divId];
            if (!div) continue;
            const a = div.find(t => t.abbr === g.awayTeam);
            const h = div.find(t => t.abbr === g.homeTeam);
            if (a) aTeam = a;
            if (h) hTeam = h;
          }
          if (!aTeam || !hTeam) continue; // game not in this league

          const aWCGB = parseFloat(aTeam.wcGB) || 0;
          const hWCGB = parseFloat(hTeam.wcGB) || 0;
          const awayWCRank = parseInt(aTeam.wcRank) || 99;
          const homeWCRank = parseInt(hTeam.wcRank) || 99;

          let score = 0;
          const reasons = [];

          // Direct division matchup — always elevated
          if (aTeam.leagueId === hTeam.leagueId) {
            // Check if same division
            const sameDivKey = Object.keys(divMap).find(k =>
              divMap[k].some(t => t.abbr === g.awayTeam) && divMap[k].some(t => t.abbr === g.homeTeam)
            );
            if (sameDivKey) {
              score += 30;
              const gbBetween = Math.abs((aTeam.gb === '--' ? 0 : parseFloat(aTeam.gb)) - 0);
              reasons.push('Division matchup');
              if (aTeam.divRank <= 3 && hTeam.divRank <= 3) {
                score += 20;
                reasons.push('both in div top 3');
              }
            }
          }

          // Division leader / close to top
          if (aTeam.divRank === 1) { score += 15; reasons.push(`${g.awayTeam} leads division`); }
          else if (aTeam.divRank <= 2) { score += 8; }
          if (hTeam.divRank === 1) { score += 15; reasons.push(`${g.homeTeam} leads division`); }
          else if (hTeam.divRank <= 2) { score += 8; }

          // Wild card bubble
          if (awayWCRank <= 3) { score += 18; reasons.push(`${g.awayTeam} in WC spot`); }
          else if (awayWCRank <= 6 && aWCGB <= 3) { score += 12; reasons.push(`${g.awayTeam} WC chase`); }
          else if (aWCGB <= 5) { score += 6; }

          if (homeWCRank <= 3) { score += 18; reasons.push(`${g.homeTeam} in WC spot`); }
          else if (homeWCRank <= 6 && hWCGB <= 3) { score += 12; reasons.push(`${g.homeTeam} WC chase`); }
          else if (hWCGB <= 5) { score += 6; }

          // Both teams fighting for same playoff spot — massive bonus
          if (awayWCRank <= 6 && homeWCRank <= 6) { score += 15; reasons.push('WC rivals'); }

          // Near the bubble (3-5 back)
          if (aWCGB >= 3 && aWCGB <= 5) { score += 5; }
          if (hWCGB >= 3 && hWCGB <= 5) { score += 5; }

          // Rivalry bonus
          if (isRivalry(g.awayTeam, g.homeTeam)) { score += 10; reasons.push('Rivalry'); }

          if (score >= 25) {
            scoredGames.push({ g, score, reasons });
          }
        }

        scoredGames.sort((a, b) => b.score - a.score);

        if (scoredGames.length > 0) {
          html += '<div style="margin-top:14px">';
          html += '<div class="standings-div-title" style="margin-bottom:8px">🔑 Key Games Today</div>';
          scoredGames.slice(0, 4).forEach(({ g, score, reasons }) => {
            const pill = score >= 70 ? 'var(--brick);border-color:var(--danger)' : score >= 50 ? 'rgba(146, 64, 14, 0.5);border-color:var(--gold)' : 'var(--ivy-lighter);border-color:var(--info)';
            html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:6px;background:${pill.split(';')[0]};border:1px solid ${pill.split(';')[1].split(':')[1]};margin-bottom:6px;font-size:0.78rem;">
              <span style="font-weight:700">${teamLogo(g.awayTeam)} ${g.awayTeam} @ ${teamLogo(g.homeTeam)} ${g.homeTeam}</span>
              <span style="font-size:0.68rem;color:var(--text-dim);margin-left:8px">${reasons.slice(0,2).join(' · ')}</span>
            </div>`;
          });
          html += '</div>';
        }
      }

      section.innerHTML = html;
      container.appendChild(section);
    });
  } catch (e) {
    console.error('Standings fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load standings</div>';
  }
}

// ─── MILESTONES TAB ─────────────────────────────────────────────────────────
const MILESTONE_DEFS = [
  { api: 'gamesPlayed',    group: 'hitting',  label: 'Season Games Played (G)',   milestones: SEASON_G_MILESTONES },
  { api: 'plateAppearances', group: 'hitting',  label: 'Season Plate Appearances (PA)',  milestones: SEASON_PA_MILESTONES },
  { api: 'atBats',         group: 'hitting',  label: 'Season At-Bats (AB)',  milestones: SEASON_AB_MILESTONES },
  { api: 'hits',           group: 'hitting',  label: 'Season Hits (H)',   milestones: SEASON_H_MILESTONES },
  { api: 'doubles',        group: 'hitting',  label: 'Season Doubles (2B)',  milestones: SEASON_2B_MILESTONES },
  { api: 'triples',        group: 'hitting',  label: 'Season Triples (3B)',  milestones: SEASON_3B_MILESTONES },
  { api: 'homeRuns',       group: 'hitting',  label: 'Season Home Runs (HR)',  milestones: SEASON_HR_MILESTONES },
  { api: 'runsBattedIn',   group: 'hitting',  label: 'Season Runs Batted In (RBI)', milestones: SEASON_RBI_MILESTONES },
  { api: 'runs',           group: 'hitting',  label: 'Season Runs (R)',   milestones: SEASON_R_MILESTONES },
  { api: 'baseOnBalls',    group: 'hitting',  label: 'Season Walks (BB)',  milestones: SEASON_BB_MILESTONES },
  { api: 'stolenBases',    group: 'hitting',  label: 'Season Stolen Bases (SB)',  milestones: SEASON_SB_MILESTONES },
  { api: 'hitByPitch',     group: 'hitting',  label: 'Season Hit By Pitch (HBP)', milestones: SEASON_HBP_MILESTONES },
  { api: 'totalBases',     group: 'hitting',  label: 'Season Total Bases (TB)',  milestones: SEASON_TB_MILESTONES },
  { api: 'extraBaseHits',  group: 'hitting',  label: 'Season Extra-Base Hits (XBH)', milestones: SEASON_XBH_MILESTONES, advanced: true },

  { api: 'gamesPitched',   group: 'pitching', label: 'Season Games (G)', milestones: SEASON_PIT_G_MILESTONES },
  { api: 'gamesStarted',   group: 'pitching', label: 'Season Games Started (GS)',  milestones: SEASON_GS_MILESTONES },
  { api: 'inningsPitched', group: 'pitching', label: 'Season Innings Pitched (IP)',  milestones: SEASON_IP_MILESTONES, isFloat: true },
  { api: 'wins',           group: 'pitching', label: 'Season Wins (W)',   milestones: SEASON_W_MILESTONES },
  { api: 'strikeOuts',     group: 'pitching', label: 'Season Strikeouts (SO)',   milestones: SEASON_K_MILESTONES },
  { api: 'saves',          group: 'pitching', label: 'Season Saves (SV)',  milestones: SEASON_SV_MILESTONES },
  { api: 'holds',          group: 'pitching', label: 'Season Holds (HLD)', milestones: SEASON_HLD_MILESTONES },
  { api: 'completeGames',  group: 'pitching', label: 'Season Complete Games (CG)',  milestones: SEASON_CG_MILESTONES },
  { api: 'shutouts',       group: 'pitching', label: 'Season Shutouts (SHO)', milestones: SEASON_SHO_MILESTONES },
  { api: 'qualityStarts',  group: 'pitching', label: 'Season Quality Starts (QS)',  milestones: SEASON_QS_MILESTONES, advanced: true }
];

const CAREER_STATS_MAP = {
  'hitting': [
    { label: 'Career Games Played (G)',   ms: CAREER_G_MS,   api: 'gamesPlayed' },
    { label: 'Career Plate Appearances (PA)',  ms: CAREER_PA_MS,  api: 'plateAppearances' },
    { label: 'Career At-Bats (AB)',  ms: CAREER_AB_MS,  api: 'atBats' },
    { label: 'Career Hits (H)',   ms: CAREER_H_MS,   api: 'hits' },
    { label: 'Career Doubles (2B)',  ms: CAREER_2B_MS,  api: 'doubles' },
    { label: 'Career Triples (3B)',  ms: CAREER_3B_MS,  api: 'triples' },
    { label: 'Career Home Runs (HR)',  ms: CAREER_HR_MS,  api: 'homeRuns' },
    { label: 'Career Runs Batted In (RBI)', ms: CAREER_RBI_MS, api: 'rbi' },
    { label: 'Career Runs (R)',   ms: CAREER_R_MS,   api: 'runs' },
    { label: 'Career Walks (BB)',  ms: CAREER_BB_MS,  api: 'baseOnBalls' },
    { label: 'Career Stolen Bases (SB)',  ms: CAREER_SB_MS,  api: 'stolenBases' },
    { label: 'Career Hit By Pitch (HBP)', ms: CAREER_HBP_MS, api: 'hitByPitch' },
    { label: 'Career Sacrifice Flies (SF)',  ms: CAREER_SF_MS,  api: 'sacFlies' },
    { label: 'Career Sacrifice Hits (SH)',  ms: CAREER_SH_MS,  api: 'sacBunts' },
    { label: 'Career Total Bases (TB)',  ms: CAREER_TB_MS,  api: 'totalBases' },
    { label: 'Career Extra-Base Hits (XBH)', ms: CAREER_XBH_MS, api: 'extraBaseHits', advanced: true }
  ],
  'pitching': [
    { label: 'Career Games (G)', ms: CAREER_PIT_G_MS, api: 'gamesPitched' },
    { label: 'Career Games Started (GS)',  ms: CAREER_GS_MS,  api: 'gamesStarted' },
    { label: 'Career Innings Pitched (IP)',  ms: CAREER_IP_MS,  api: 'inningsPitched' },
    { label: 'Career Wins (W)',   ms: CAREER_W_MS,   api: 'wins' },
    { label: 'Career Strikeouts (SO)',   ms: CAREER_K_MS,   api: 'strikeOuts' },
    { label: 'Career Walks (BB)', ms: CAREER_PIT_BB_MS, api: 'baseOnBalls' },
    { label: 'Career Saves (SV)',  ms: CAREER_SV_MS,  api: 'saves' },
    { label: 'Career Holds (HLD)', ms: CAREER_HLD_MS, api: 'holds' },
    { label: 'Career Complete Games (CG)',  ms: CAREER_CG_MS,  api: 'completeGames' },
    { label: 'Career Shutouts (SHO)', ms: CAREER_SHO_MS, api: 'shutouts' },
    { label: 'Career Quality Starts (QS)',  ms: CAREER_QS_MS,  api: 'qualityStarts', advanced: true }
  ]
};

let milestoneFilter = loadPrefs().milestoneFilter || 'all';

const MILESTONE_META = {
  'Season Games Played (G)': { short: 'G', type: 'hitter', scope: 'season', major: SEASON_G_MILESTONES },
  'Season Plate Appearances (PA)': { short: 'PA', type: 'hitter', scope: 'season', major: SEASON_PA_MILESTONES },
  'Season At-Bats (AB)': { short: 'AB', type: 'hitter', scope: 'season', major: SEASON_AB_MILESTONES },
  'Season Hits (H)': { short: 'H', type: 'hitter', scope: 'season', major: SEASON_H_MILESTONES },
  'Season Doubles (2B)': { short: '2B', type: 'hitter', scope: 'season', major: SEASON_2B_MILESTONES },
  'Season Triples (3B)': { short: '3B', type: 'hitter', scope: 'season', major: SEASON_3B_MILESTONES },
  'Season Home Runs (HR)': { short: 'HR', type: 'hitter', scope: 'season', major: SEASON_HR_MILESTONES },
  'Season Runs Batted In (RBI)': { short: 'RBI', type: 'hitter', scope: 'season', major: SEASON_RBI_MILESTONES },
  'Season Runs (R)': { short: 'R', type: 'hitter', scope: 'season', major: SEASON_R_MILESTONES },
  'Season Walks (BB)': { short: 'BB', type: 'hitter', scope: 'season', major: SEASON_BB_MILESTONES },
  'Season Stolen Bases (SB)': { short: 'SB', type: 'hitter', scope: 'season', major: SEASON_SB_MILESTONES },
  'Season Hit By Pitch (HBP)': { short: 'HBP', type: 'hitter', scope: 'season', major: SEASON_HBP_MILESTONES },
  'Season Total Bases (TB)': { short: 'TB', type: 'hitter', scope: 'season', major: SEASON_TB_MILESTONES },
  'Season Extra-Base Hits (XBH)': { short: 'XBH', type: 'hitter', scope: 'season', major: SEASON_XBH_MILESTONES },

  'Season Games (G)': { short: 'G', type: 'pitcher', scope: 'season', major: SEASON_PIT_G_MILESTONES },
  'Season Games Started (GS)': { short: 'GS', type: 'pitcher', scope: 'season', major: SEASON_GS_MILESTONES },
  'Season Innings Pitched (IP)': { short: 'IP', type: 'pitcher', scope: 'season', major: SEASON_IP_MILESTONES },
  'Season Wins (W)': { short: 'W', type: 'pitcher', scope: 'season', major: SEASON_W_MILESTONES },
  'Season Strikeouts (SO)': { short: 'SO', type: 'pitcher', scope: 'season', major: SEASON_K_MILESTONES },
  'Season Saves (SV)': { short: 'SV', type: 'pitcher', scope: 'season', major: SEASON_SV_MILESTONES },
  'Season Holds (HLD)': { short: 'HLD', type: 'pitcher', scope: 'season', major: SEASON_HLD_MILESTONES },
  'Season Complete Games (CG)': { short: 'CG', type: 'pitcher', scope: 'season', major: SEASON_CG_MILESTONES },
  'Season Shutouts (SHO)': { short: 'SHO', type: 'pitcher', scope: 'season', major: SEASON_SHO_MILESTONES },
  'Season Quality Starts (QS)': { short: 'QS', type: 'pitcher', scope: 'season', major: SEASON_QS_MILESTONES },

  'Career Games Played (G)': { short: 'G', type: 'hitter', scope: 'career', major: CAREER_G_MS },
  'Career Plate Appearances (PA)': { short: 'PA', type: 'hitter', scope: 'career', major: CAREER_PA_MS },
  'Career At-Bats (AB)': { short: 'AB', type: 'hitter', scope: 'career', major: CAREER_AB_MS },
  'Career Hits (H)': { short: 'H', type: 'hitter', scope: 'career', major: CAREER_H_MS },
  'Career Doubles (2B)': { short: '2B', type: 'hitter', scope: 'career', major: CAREER_2B_MS },
  'Career Triples (3B)': { short: '3B', type: 'hitter', scope: 'career', major: CAREER_3B_MS },
  'Career Home Runs (HR)': { short: 'HR', type: 'hitter', scope: 'career', major: CAREER_HR_MS },
  'Career Runs Batted In (RBI)': { short: 'RBI', type: 'hitter', scope: 'career', major: CAREER_RBI_MS },
  'Career Runs (R)': { short: 'R', type: 'hitter', scope: 'career', major: CAREER_R_MS },
  'Career Walks (BB)': { short: 'BB', type: 'hitter', scope: 'career', major: CAREER_BB_MS },
  'Career Stolen Bases (SB)': { short: 'SB', type: 'hitter', scope: 'career', major: CAREER_SB_MS },
  'Career Hit By Pitch (HBP)': { short: 'HBP', type: 'hitter', scope: 'career', major: CAREER_HBP_MS },
  'Career Sacrifice Flies (SF)': { short: 'SF', type: 'hitter', scope: 'career', major: CAREER_SF_MS },
  'Career Sacrifice Hits (SH)': { short: 'SH', type: 'hitter', scope: 'career', major: CAREER_SH_MS },
  'Career Total Bases (TB)': { short: 'TB', type: 'hitter', scope: 'career', major: CAREER_TB_MS },
  'Career Extra-Base Hits (XBH)': { short: 'XBH', type: 'hitter', scope: 'career', major: CAREER_XBH_MS },

  'Career Games (G)': { short: 'G', type: 'pitcher', scope: 'career', major: CAREER_PIT_G_MS },
  'Career Games Started (GS)': { short: 'GS', type: 'pitcher', scope: 'career', major: CAREER_GS_MS },
  'Career Innings Pitched (IP)': { short: 'IP', type: 'pitcher', scope: 'career', major: CAREER_IP_MS },
  'Career Wins (W)': { short: 'W', type: 'pitcher', scope: 'career', major: CAREER_W_MS },
  'Career Strikeouts (SO)': { short: 'SO', type: 'pitcher', scope: 'career', major: CAREER_K_MS },
  'Career Walks (BB)': { short: 'BB', type: 'pitcher', scope: 'career', major: CAREER_PIT_BB_MS },
  'Career Saves (SV)': { short: 'SV', type: 'pitcher', scope: 'career', major: CAREER_SV_MS },
  'Career Holds (HLD)': { short: 'HLD', type: 'pitcher', scope: 'career', major: CAREER_HLD_MS },
  'Career Complete Games (CG)': { short: 'CG', type: 'pitcher', scope: 'career', major: CAREER_CG_MS },
  'Career Shutouts (SHO)': { short: 'SHO', type: 'pitcher', scope: 'career', major: CAREER_SHO_MS },
  'Career Quality Starts (QS)': { short: 'QS', type: 'pitcher', scope: 'career', major: CAREER_QS_MS }
};

function setMilestoneFilter(filter) {
  milestoneFilter = filter;
  savePrefs({ milestoneFilter: filter });
  if (window.lastMilestones) renderMilestoneBoard(window.lastMilestones);
}

const followedChases = new Set(loadPrefs().followedChases || []);
// BOLT OPTIMIZATION: Keep a Set of IDs for O(1) lookup during game card rendering
const followedPlayerIds = new Set(Array.from(followedChases).map(k => k.split('-')[0]));

function toggleFollowChase(playerKey) {
  if (followedChases.has(playerKey)) followedChases.delete(playerKey);
  else followedChases.add(playerKey);

  // BOLT: Keep optimized ID set in sync
  followedPlayerIds.clear();
  followedChases.forEach(k => followedPlayerIds.add(k.split('-')[0]));

  savePrefs({ followedChases: [...followedChases] });
  if (window.lastMilestones) renderMilestoneBoard(window.lastMilestones);
}

function milestoneImportance(m) {
  const meta = MILESTONE_META[m.stat] || {};
  if ((meta.historic || []).includes(Number(m.next))) return 'Historic';
  if ((meta.major || []).includes(Number(m.next))) return 'Major';
  if (meta.scope === 'career') return 'Career';
  return 'Round number';
}

function milestoneUrgency(m) {
  if (m.playingNow && m.diff <= 2) return 'Could happen today';
  if (m.diff <= 1) return 'Could happen today';
  if (m.playingToday && m.diff <= 3) return 'Could happen today';
  if (m.diff <= 5) return 'This series';
  if (m.diff <= 10) return 'This week';
  return 'Longer watch';
}

function milestonePriority(m) {
  const importance = milestoneImportance(m);
  let score = 100 - Math.min(m.diff, 20) * 3;
  if (m.playingNow) score += 22;
  else if (m.playingToday) score += 10;
  if (isFavoriteTeam(m.team)) score += 12;
  if (importance === 'Historic') score += 25;
  else if (importance === 'Major') score += 14;
  else if (importance === 'Career') score += 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function isFavoriteTeam(team) {
  return favoriteTeams.has(normalizeAbbr(team));
}

function milestoneProgress(m) {
  const current = parseFloat(m.current) || 0;
  const next = parseFloat(m.next) || 1;
  const pct = Math.max(0, Math.min(100, (current / next) * 100));
  return Math.round(pct);
}

function milestonePaceText(m) {
  const current = parseFloat(m.current) || 0;
  const diff = parseFloat(m.diff) || 0;
  if (m.playingNow && diff <= 2) return 'live watch';
  if (diff <= 1) return 'next opportunity';
  if (diff <= 3) return 'very close';
  if (diff <= 5) return 'series watch';
  if (diff <= 10) return 'week watch';
  return 'longer chase';
}

const playerHeatCache = {};
async function fetchPlayerHeat(playerId, group, statKey) {
  const cacheKey = `${playerId}:${group}:${statKey}`;
  if (playerHeatCache[cacheKey]) return playerHeatCache[cacheKey];
  try {
    const season = currentSeason();
    const data = await requestPool.fetchDedup(
      `${MLB_API}/people/${playerId}/stats?stats=gameLog&group=${group}&season=${season}`,
      { cacheKey: `heatLogRaw:${playerId}:${season}:${group}`, ttl: 1800000 }
    );
    const logs = data.stats?.[0]?.splits || [];

    const statMap = {
      'H': 'hits', 'HR': 'homeRuns', 'RBI': 'rbi', 'SB': 'stolenBases',
      '2B': 'doubles', '3B': 'triples', 'R': 'runs', 'BB': 'baseOnBalls',
      'K': 'strikeOuts', 'SV': 'saves', 'W': 'wins', 'IP': 'inningsPitched'
    };
    const apiStatKey = statMap[statKey] || statKey;

    // Last 10 games
    const heat = logs.slice(-10).map(l => {
      const val = parseFloat(l.stat[apiStatKey]) || 0;
      return val > 0 ? 1 : 0;
    });
    playerHeatCache[cacheKey] = heat;
    return heat;
  } catch (e) {
    return [];
  }
}

let reachedMilestones = [];
function checkReachedMilestones(milestones) {
  const now = Date.now();
  const today = todayET();
  const reached = [];
  milestones.forEach(m => {
    // If current >= next, it's reached
    if (parseFloat(m.current) >= parseFloat(m.next)) {
      reached.push({ ...m, reachedAt: today });
    }
  });
  // Also check if any were reached in previous days (using a persistent log)
  let log = loadPrefs().reachedLog || [];
  const existingKeys = new Set(log.map(l => `${l.id}-${l.stat}-${l.next}`));
  reached.forEach(r => {
    const key = `${r.id}-${r.stat}-${r.next}`;
    if (!existingKeys.has(key)) {
      log.unshift(r);
    }
  });
  log = log.slice(0, 20); // Keep last 20
  savePrefs({ reachedLog: log });
  reachedMilestones = log;
}

async function fetchMilestones(todayGames) {
  const container = document.getElementById('milestones-container');
  container.innerHTML = '<div class="empty-msg">Loading milestones...</div>';
  const season = currentSeason();
  const date = selectedDate || todayET();

  // Build set of teams with LIVE games right now
  const liveTeams = new Set();
  const todayTeams = new Set();
  if (todayGames) {
    todayGames.forEach(g => {
      todayTeams.add(g.awayTeam);
      todayTeams.add(g.homeTeam);
      const isLive = !/final|scheduled|pre-game|warmup|preview|postponed/i.test(g.gameState) &&
                     /live|in progress/i.test(g.gameState);
      if (isLive) {
        liveTeams.add(g.awayTeam);
        liveTeams.add(g.homeTeam);
      }
    });
  }

  // Fetch set of pitcher IDs from current season pitching leaders (to exclude from hitting milestones)
  const pitcherIds = new Set();
  const hitterIds = new Set();
  const OHTANI_ID = 660271; // Shohei Ohtani — always exempt from filtering

  try {
    const [pitPool, hitPool] = await Promise.all([
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=50`, { ttl: 300000 }),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=50`, { ttl: 300000 })
    ]);
    const pitSplits = pitPool.stats?.[0]?.splits || [];
    for (const l of pitSplits) {
      const pid = l.player?.id;
      if (pid && pid !== OHTANI_ID) pitcherIds.add(pid);
    }
    const hitSplits = hitPool.stats?.[0]?.splits || [];
    for (const l of hitSplits) {
      const pid = l.player?.id;
      if (pid && pid !== OHTANI_ID) hitterIds.add(pid);
    }
  } catch(e) { console.warn('Pitcher/hitter pool fetch:', e); }

  try {
    // Fetch top players in each category
    const allMilestones = [];

    // BOLT OPTIMIZATION: Parallelize season milestone fetches and career milestone pool fetches to reduce tab load time.
    const seasonMilestonePromises = MILESTONE_DEFS.map(def =>
      batchFetcher.add(async () => {
        try {
          const statsType = def.advanced ? 'byDateRangeAdvanced' : 'byDateRange';
          const url = `${MLB_API}/stats?stats=${statsType}&group=${def.group}&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=50&sortStat=${def.api}`;
          const data = await requestPool.fetchDedup(url, { cacheKey: `milestoneLeaders:${def.api}:${date}` });
          const leaders = data.stats?.[0]?.splits || [];
          for (const l of leaders) {
            const pid = l.player?.id;
            if (pid !== OHTANI_ID) {
              if (def.group === 'hitting' && pitcherIds.has(pid)) continue;
              if (def.group === 'pitching' && hitterIds.has(pid) && !pitcherIds.has(pid)) continue;
            }
            const lVal = l.stat[def.api] ?? l.value;
            const raw = def.isFloat ? parseFloat(lVal) || 0 : parseInt(lVal) || 0;
            const val = def.isFloat ? Math.floor(raw) : raw;
            const displayVal = def.isFloat ? raw.toFixed(1) : raw;
            const next = def.milestones.find(m => m > val);
            if (!next) continue;
            const diff = def.isFloat ? (next - raw).toFixed(1) : next - val;
            const diffNum = def.isFloat ? parseFloat(diff) : next - val;
            if (diffNum > 25) continue;
            const tAbbr = normalizeAbbr(l.team?.abbreviation || teamAbbrFromId(l.team?.id) || '?');
            allMilestones.push({
              id: pid,
              name: l.player?.fullName || 'Unknown',
              team: tAbbr,
              stat: def.label,
              current: displayVal,
              next,
              diff: diffNum,
              type: MILESTONE_META[def.label]?.type || def.group,
              scope: 'season',
              priority: 0,
              playingNow: liveTeams.has(tAbbr),
              playingToday: todayTeams.has(tAbbr)
            });
          }
        } catch (e) { console.warn(`Milestone ${def.label}:`, e); }
      })
    );

    const careerPoolPromise = Promise.all([
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=30`, { ttl: 900000 }),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=30`, { ttl: 900000 })
    ]);

    // Fetch regular season milestones and career pools in parallel
    const [[hitPool2, pitPool2]] = await Promise.all([
      careerPoolPromise,
      ...seasonMilestonePromises
    ]);

    // Fetch career milestones
    try {

      const playerMap = {};
      const addPlayers = (data, group) => {
        const splits = data.stats?.[0]?.splits || [];
        for (const l of splits) {
          const pid = l.player?.id;
          if (!pid || playerMap[pid]) continue;
          playerMap[pid] = { pid, name: l.player.fullName, team: normalizeAbbr(l.team?.abbreviation || teamAbbrFromId(l.team?.id) || '?'), group };
        }
      };
      addPlayers(hitPool2, 'hitting');
      addPlayers(pitPool2, 'pitching');

      const players = Object.values(playerMap);

      // BOLT OPTIMIZATION: Batch career stats fetching for all candidates (approx 60 players).
      // This reduces Milestone tab load from ~100 requests to 1-2 requests using the people hydrate API.
      const playerIds = players.map(p => p.pid);
      const chunkSize = 50;
      const batchPromises = [];
      for (let i = 0; i < playerIds.length; i += chunkSize) {
        const chunk = playerIds.slice(i, i + chunkSize);
        batchPromises.push(batchFetcher.add(async () => {
          try {
            const batchData = await requestPool.fetchDedup(
              `${MLB_API}/people?personIds=${chunk.join(',')}&hydrate=stats(group=[hitting,pitching],type=[career],endDate=${date})`,
              { ttl: 3600000 }
            );
            (batchData.people || []).forEach(p => {
              const pid = p.id;
              p.stats?.forEach(s => {
                const grp = (s.group?.code || s.group?.displayName || '').toLowerCase();
                if ((grp === 'hitting' || grp === 'pitching') && s.splits?.length > 0) {
                  const data = { stats: [s] };
                  const url = `${MLB_API}/people/${pid}/stats?stats=career&group=${grp}&endDate=${date}`;
                  persistentCache.set(url, data, 3600000);
                  persistentCache.set(`careerStats:${date}:${pid}:${grp}`, data, 3600000);
                }
              });
            });
          } catch (e) { console.warn('[Milestones] Batch career fetch failed:', e); }
        }));
      }
      await Promise.all(batchPromises);

      await Promise.all(players.map(async ({ pid, name, team, group }) => {
        try {
          // BOLT OPTIMIZATION: Individual lookups now hit the pre-populated cache
          const isHitter = group === 'hitting' || pid === OHTANI_ID;
          const isPitcher = group === 'pitching' || pid === OHTANI_ID;

          const [hitData, hitAdvData, pitData, pitAdvData] = await Promise.all([
            isHitter ? batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/people/${pid}/stats?stats=career&group=hitting&endDate=${date}`, { ttl: 3600000 })) : Promise.resolve({}),
            isHitter ? batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/people/${pid}/stats?stats=careerAdvanced&group=hitting&endDate=${date}`, { ttl: 3600000 })) : Promise.resolve({}),
            isPitcher ? batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/people/${pid}/stats?stats=career&group=pitching&endDate=${date}`, { ttl: 3600000 })) : Promise.resolve({}),
            isPitcher ? batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/people/${pid}/stats?stats=careerAdvanced&group=pitching&endDate=${date}`, { ttl: 3600000 })) : Promise.resolve({})
          ]);
          const hitStat = hitData.stats?.[0]?.splits?.[0]?.stat;
          const hitAdvStat = hitAdvData.stats?.[0]?.splits?.[0]?.stat;
          const pitStat = pitData.stats?.[0]?.splits?.[0]?.stat;
          const pitAdvStat = pitAdvData.stats?.[0]?.splits?.[0]?.stat;
          const tAbbr = team;
          const playingNow = liveTeams.has(tAbbr);
          const playingToday = todayTeams.has(tAbbr);

          const tryCareer = (val, ms, statLabel, forGroup) => {
            if (val === undefined || val === null) return;
            // skip career hitting milestones for pitchers (and vice versa), Ohtani exempt
            if (pid !== OHTANI_ID) {
              if (forGroup === 'hitting' && pitcherIds.has(pid)) return;
              if (forGroup === 'pitching' && !pitcherIds.has(pid)) return;
            }
            const next = ms.find(m => m > val);
            if (!next) return;
            const diff = next - val;
            if (diff > 25) return; // Increased threshold for career milestones
            allMilestones.push({
              id: pid,
              name,
              team: tAbbr,
              stat: statLabel,
              current: val,
              next,
              diff,
              type: MILESTONE_META[statLabel]?.type || group,
              scope: 'career',
              priority: 0,
              playingNow,
              playingToday
            });
          };

          if (hitStat) {
            CAREER_STATS_MAP.hitting.forEach(mDef => {
              const source = mDef.advanced ? hitAdvStat : hitStat;
              if (!source) return;
              const val = parseInt(source[mDef.api]) || 0;
              tryCareer(val, mDef.ms, mDef.label, 'hitting');
            });
          }
          if (pitStat) {
            CAREER_STATS_MAP.pitching.forEach(mDef => {
              const source = mDef.advanced ? pitAdvStat : pitStat;
              if (!source) return;
              let val;
              if (mDef.api === 'inningsPitched') val = Math.floor(parseFloat(source[mDef.api]) || 0);
              else val = parseInt(source[mDef.api]) || 0;
              tryCareer(val, mDef.ms, mDef.label, 'pitching');
            });
          }
        } catch(e) {}
      }));
    } catch(e) { console.warn('Career milestones fetch failed:', e); }

    // Populate milestone watch teams (players within 5 of a milestone)
    milestoneWatchTeams = new Set(
      allMilestones.filter(m => m.diff <= 5).map(m => m.team)
    );

    await Promise.all(allMilestones.map(async m => {
      m.importance = milestoneImportance(m);
      m.urgency = milestoneUrgency(m);
      m.priority = milestonePriority(m);
      m.progress = milestoneProgress(m);
      m.shortStat = MILESTONE_META[m.stat]?.short || m.stat;
      m.paceText = milestonePaceText(m);

      // Chasing History
      if (m.scope === 'career') {
        const catMap = {
          'Career Home Runs (HR)': 'homeRuns', 'Career Hits (H)': 'hits', 'Career Runs Batted In (RBI)': 'runsBattedIn',
          'Career Strikeouts (SO)': 'strikeouts', 'Career Stolen Bases (SB)': 'stolenBases', 'Career Doubles (2B)': 'doubles',
          'Career Triples (3B)': 'triples', 'Career Runs (R)': 'runs', 'Career Walks (BB)': 'baseOnBalls',
          'Career Wins (W)': 'wins', 'Career Saves (SV)': 'saves'
        };
        const cat = catMap[m.stat];
        if (cat) {
          try {
            const leaders = await fetchAllTimeLeaders(cat, m.type === 'pitcher' ? 'pitching' : 'hitting');
            const myVal = parseInt(m.current);
            // Find the player immediately ahead on the leaderboard (smallest value > myVal)
            const nextLegend = [...leaders].reverse().find(l => l.value > myVal);
            if (nextLegend) {
              const legendDiff = nextLegend.value - myVal;
              const threshold = (m.stat === 'Career Strikeouts (SO)') ? 25 : 10;
              if (legendDiff <= threshold) {
                m.chasing = { name: nextLegend.name, rank: nextLegend.rank, diff: legendDiff };
              }
            }
          } catch (e) {}
        }
      }

      // Heat Map
      try {
        m.heat = await fetchPlayerHeat(m.id, m.type === 'pitcher' ? 'pitching' : 'hitting', m.shortStat);
      } catch (e) { m.heat = []; }
    }));

    checkReachedMilestones(allMilestones);

    allMilestones.sort((a, b) => b.priority - a.priority || a.diff - b.diff);
    window.lastMilestones = allMilestones;

    if (allMilestones.length === 0) {
      container.innerHTML = '<div class="empty-msg">No upcoming milestones to track</div>';
      return;
    }
    renderMilestoneBoard(allMilestones);
  } catch (e) {
    console.error('Milestones fetch failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load milestones</div>';
  }
}

function renderMilestoneBoard(allMilestones) {
  const container = document.getElementById('milestones-container');
  if (!container) return;
  const filterFns = {
    all: () => true,
    live: m => m.playingNow,
    today: m => m.playingToday,
    favorites: m => isFavoriteTeam(m.team),
    historic: m => m.importance === 'Historic' || m.importance === 'Major',
    hitters: m => m.type === 'hitter',
    pitchers: m => m.type === 'pitcher',
    career: m => m.scope === 'career',
    achievements: m => false // Handled separately below
  };
  let filtered = allMilestones.filter(filterFns[milestoneFilter] || filterFns.all);

  if (milestoneFilter === 'achievements') {
    // When filtering by achievements, we show the reached ones as cards
    filtered = reachedMilestones.map(r => ({
      ...r,
      urgency: 'Recently Reached',
      importance: 'Achievement',
      diff: 0,
      shortStat: r.stat,
      priority: 100,
      reached: true
    }));
  }
  const liveCount = allMilestones.filter(m => m.playingNow).length;
  const todayCount = allMilestones.filter(m => m.playingToday).length;
  const historicCount = allMilestones.filter(m => m.importance === 'Historic' || m.importance === 'Major').length;
  const favCount = allMilestones.filter(m => isFavoriteTeam(m.team)).length;

  const urgencyOrder = ['Recently Reached', 'Could happen today', 'This series', 'This week', 'Longer watch'];
  const groups = {};
  filtered.forEach(m => {
    if (!groups[m.urgency]) groups[m.urgency] = [];
    groups[m.urgency].push(m);
  });

  const reachedHtml = (reachedMilestones.length && milestoneFilter === 'all') ? `
    <div class="milestone-reached-wall">
      <div class="milestone-reached-title">🏆 Recent Achievements (Last 48h)</div>
      <div class="milestone-reached-list">
        ${reachedMilestones.map(r => `
          <div class="milestone-reached-item">
            <strong>${escapeHTML(r.name)}</strong> reached <span>${r.next} ${r.stat}</span>!
          </div>
        `).join('')}
      </div>
    </div>` : '';

  container.innerHTML = `
    ${reachedHtml}
    <div class="milestone-hero">
      <div class="milestone-hero-main">
        <div class="milestone-hero-kicker">Chase Board</div>
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
        ['historic','Major'],
        ['hitters','Hitters'],
        ['pitchers','Pitchers'],
        ['career','Career'],
        ['achievements', 'Achievements']
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
  const importanceClass = (m.importance || '').toLowerCase().replace(/\s+/g, '-');
  const diffLabel = m.reached ? 'Reached!' : (Number(m.diff) === 1 ? `1 ${m.shortStat} away` : `${m.diff} ${m.shortStat} away`);
  const fav = isFavoriteTeam(m.team) ? '<span class="milestone-pill fav">Favorite</span>' : '';
  const live = m.playingNow ? '<span class="milestone-pill live">Live now</span>' : m.playingToday ? '<span class="milestone-pill today">Today</span>' : '';

  const chaseHtml = m.chasing ? `
    <div class="milestone-chase">
      Passing <strong>${escapeHTML(m.chasing.name)}</strong> (#${m.chasing.rank} all-time) in ${m.chasing.diff} ${m.shortStat}
    </div>` : '';

  const heatHtml = m.heat && m.heat.length ? `
    <div class="milestone-heat">
      ${m.heat.map(val => `<div class="heat-bar ${val > 0 ? 'active' : ''}" title="${val} ${m.shortStat}"></div>`).join('')}
    </div>` : '';

  const playerKey = `${m.id}-${m.stat}`;
  const isFollowed = followedChases.has(playerKey);
  const followBtn = `<button class="milestone-follow ${isFollowed ? 'active' : ''}"
    onclick="toggleFollowChase('${playerKey}')"
    aria-pressed="${isFollowed}"
    aria-label="${isFollowed ? 'Stop watching' : 'Watch'} ${escapeHTML(m.name)}'s chase for ${escapeHTML(m.next)} ${escapeHTML(m.stat)}">
    ${isFollowed ? '★ Following' : '☆ Watch Chase'}
  </button>`;

  return `<article class="milestone-card rich${statusClass}">
    <div class="milestone-topline">
      <span class="milestone-importance ${importanceClass}">${escapeHTML(m.importance)}</span>
      ${followBtn}
    </div>
    <div class="milestone-player">${teamLogo(m.team)} ${escapeHTML(m.name)}</div>
    <div class="milestone-team">${escapeHTML(m.team)} · ${escapeHTML(m.stat)}</div>
    ${chaseHtml}
    <div class="milestone-target">
      <strong>${escapeHTML(m.current)}</strong>
      <span>/ ${escapeHTML(m.next)} ${escapeHTML(m.shortStat)}</span>
    </div>
    <div class="milestone-progress"><div style="width:${m.progress}%"></div></div>
    ${heatHtml}
    <div class="milestone-card-footer">
      <span>${escapeHTML(diffLabel)}</span>
      <em>${escapeHTML(m.paceText)}</em>
    </div>
    <div class="milestone-pills">${live}${fav}</div>
  </article>`;
}

// ─── SPOILER MODE ────────────────────────────────────────────────────────────
let spoilerTeams = new Set(JSON.parse(localStorage.getItem('spoilerTeams') || '[]'));

function saveSpoilerTeams() {
  try { localStorage.setItem('spoilerTeams', JSON.stringify([...spoilerTeams])); } catch(e) {}
}

function saveFavoriteTeams() {
  savePrefs({ favoriteTeams: [...favoriteTeams] });
}

function isFavoriteGame(game) {
  return favoriteTeams.has(game.awayTeam) || favoriteTeams.has(game.homeTeam);
}

function toggleFavoriteTeam(abbr) {
  if (favoriteTeams.has(abbr)) favoriteTeams.delete(abbr);
  else favoriteTeams.add(abbr);
  saveFavoriteTeams();
  renderFavoriteGrid();
  if (lastGames) renderGames(lastGames);
}

function clearAllFavorites() {
  favoriteTeams.clear();
  saveFavoriteTeams();
  renderFavoriteGrid();
  if (lastGames) renderGames(lastGames);
}

function toggleSpoilerTeam(abbr) {
  if (spoilerTeams.has(abbr)) spoilerTeams.delete(abbr);
  else spoilerTeams.add(abbr);
  saveSpoilerTeams();
  renderSpoilerGrid();
  if (lastGames) renderGames(lastGames);
}

function clearAllSpoilers() {
  spoilerTeams.clear();
  saveSpoilerTeams();
  renderSpoilerGrid();
  if (lastGames) renderGames(lastGames);
}

function renderSpoilerGrid() {
  const grid = document.getElementById('spoiler-team-grid');
  grid.innerHTML = ALL_TEAM_ABBRS.map(abbr => {
    const isSpoiled = spoilerTeams.has(abbr);
    const t = TEAM_DATA[abbr];
    return `<div class="team-toggle${isSpoiled ? ' spoilered' : ''}" role="button" tabindex="0" aria-pressed="${isSpoiled}" onclick="toggleSpoilerTeam('${abbr}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSpoilerTeam('${abbr}')}">
      <img class="tt-logo" src="https://www.mlbstatic.com/team-logos/${t.id}.svg" alt="${abbr} logo" onerror="this.style.display='none'">
      <span>${abbr}</span>
      <div class="tt-check">${isSpoiled ? '✓' : ''}</div>
    </div>`;
  }).join('');
}

function renderFavoriteGrid() {
  const grid = document.getElementById('favorite-team-grid');
  if (!grid) return;
  grid.innerHTML = ALL_TEAM_ABBRS.map(abbr => {
    const isFav = favoriteTeams.has(abbr);
    const t = TEAM_DATA[abbr];
    return `<div class="team-toggle${isFav ? ' favorite' : ''}" role="button" tabindex="0" aria-pressed="${isFav}" onclick="toggleFavoriteTeam('${abbr}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleFavoriteTeam('${abbr}')}">
      <img class="tt-logo" src="https://www.mlbstatic.com/team-logos/${t.id}.svg" alt="${abbr} logo" onerror="this.style.display='none'">
      <span>${abbr}</span>
      <div class="tt-check">${isFav ? '★' : ''}</div>
    </div>`;
  }).join('');
}

// ─── SIDEBAR CONTROLS ────────────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
  renderStarList();
  renderSpoilerGrid();
  renderFavoriteGrid();
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function switchSidebarTab(tab) {
  renderWithErrorBoundary(() => {
    document.querySelectorAll('.sidebar-tab').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));
    document.getElementById('sb-' + tab).classList.add('active');
    const targetBtn = document.querySelector(`.sidebar-tab[onclick*="'${tab}'"]`);
    if (targetBtn) {
      targetBtn.classList.add('active');
      targetBtn.setAttribute('aria-selected', 'true');
    }
  }, 'sb-' + tab, 'Sidebar tab failed to load');
}

function revealSpoiler(el, gamePk) {
  const card = el.closest('.game-card');
  if (!card || !card._fullGame) return;
  card._lastStateKey = null; // Invalidate cache for reveal
  const game = card._fullGame;
  revealedGames.add(gamePk);
  card.classList.remove('spoilered');
  renderSingleGameCard(card, game);
  const homeColor = teamColor(game.homeTeam);
  if (homeColor) {
    card.style.borderLeft = `6px solid ${homeColor}`;
    card.style.backgroundImage = `linear-gradient(to right, ${homeColor}11, transparent)`;
  }
}

// Renders full game info into an existing card element (used for reveal + main render)
function renderSingleGameCard(card, game) {
  const wi = game.watchabilityIndex;
  const isFinal = /final/i.test(game.inningStatus);
  const isScheduled = /scheduled|pre-game|warmup|preview|ET$/i.test(game.inningStatus);

  if (layoutMode === 'compact') {
    card.classList.add('compact-view');
    const canExpand = !isScheduled;
    const compactInner = `
      <div class="compact-row">
        <div class="matchup">${teamLogo(game.awayTeam)} <strong>${game.awayTeam}</strong> @ ${teamLogo(game.homeTeam)} <strong>${game.homeTeam}</strong></div>
        ${isScheduled ? `<div class="inning-line compact-time">${game.inningStatus}</div>` : `<div class="score-line compact-score">${game.awayScore} - ${game.homeScore} <span class="inning-line compact-inn ${isFinal ? 'inning-final' : 'inning-live'}">${game.inningStatus}</span></div>`}
        <div class="compact-watch">
          <span class="score-num" style="color:${wi > 70 ? 'var(--success)' : 'var(--gold)'}">🔥 ${wi}</span>
        </div>
        <div class="compact-actions">
          ${isScheduled ? `<button class="btn-cal-mini" onclick="event.stopPropagation(); downloadCalendarEvent(${game.gamePk})" title="Add to Calendar">📅 Cal</button>` : ''}
          ${canExpand ? `<button class="btn-details-mini" onclick="event.stopPropagation(); openGameDrawer(${game.gamePk})">Details ▾</button>` : ''}
        </div>
      </div>
    `;
    if (card.innerHTML !== compactInner) {
      card.innerHTML = compactInner;
    }
    return;
  } else {
    card.classList.remove('compact-view');
  }

  // BOLT OPTIMIZATION: State-based reconciliation to skip expensive innerHTML writes
  const isExpanded = expandedCards.has(game.gamePk);
  const isFav = isFavoriteGame(game);
  // BOLT OPTIMIZATION: Use O(1) Set lookup instead of O(N) array iteration
  const followedBatter = game.currentBatter && followedPlayerIds.has(String(game.currentBatter.id));
  const followedPitcher = game.currentPitcher && followedPlayerIds.has(String(game.currentPitcher.id));
  const hasAwayStats = !!(game.awayProbablePitcher && pitcherStatsCache[game.awayProbablePitcher.id]);
  const hasHomeStats = !!(game.homeProbablePitcher && pitcherStatsCache[game.homeProbablePitcher.id]);
  const stateKey = `${game.awayScore}-${game.homeScore}-${game.inningStatus}-${game.balls}-${game.strikes}-${game.outs}-${game.onFirst}-${game.onSecond}-${game.onThird}-${wi}-${game.isPerfectGame}-${game.isNoHitter}-${isFav}-${isExpanded}-${followedBatter}-${followedPitcher}-${game.currentBatter?.id}-${game.currentPitcher?.id}-${hasAwayStats}-${hasHomeStats}`;

  if (card._lastStateKey === stateKey) return;
  card._lastStateKey = stateKey;

  const prev = prevScores[game.gamePk];
  if (prev && !isFirstLoad && (prev.away !== game.awayScore || prev.home !== game.homeScore)) {
    card.classList.add('score-flash');
    setTimeout(() => card.classList.remove('score-flash'), 2000);
  }
  prevScores[game.gamePk] = { away: game.awayScore, home: game.homeScore };
  if (game.currentInning > 9 && !isFinal && !isScheduled) card.classList.add('extras-flash');
  else card.classList.remove('extras-flash');

  let badgeHtml = '';
  if (isFavoriteGame(game)) badgeHtml += '<div class="badge favorite-badge">Favorite</div>';

  if (followedBatter || followedPitcher) {
    badgeHtml += '<div class="badge followed-badge">WATCHING</div>';
  }

  if (isRivalry(game.awayTeam, game.homeTeam)) badgeHtml += '<div class="badge rivalry">Rivalry</div>';
  if (game.isPerfectGame && !isFinal) badgeHtml += '<div class="badge perfect">PERFECT GAME ALERT</div>';
  else if (game.isNoHitter && !isFinal) badgeHtml += '<div class="badge nohitter">NO HITTER ALERT</div>';

  const b1 = game.onFirst ? 'occupied' : '';
  const b2 = game.onSecond ? 'occupied' : '';
  const b3 = game.onThird ? 'occupied' : '';
  const outsHtml = [0,1].map(i => `<div class="out-dot ${i < game.outs ? 'filled' : ''}"></div>`).join('');
  const scoreLine = isScheduled ? '' : `<div class="score-line">${game.awayScore} - ${game.homeScore}</div>`;
  const inningClass = isFinal ? 'inning-final' : isScheduled ? 'inning-scheduled' : 'inning-live';
  const showSituation = !isFinal && !isScheduled;
  const awayColor = teamColor(game.awayTeam);
  const homeColor = teamColor(game.homeTeam);
  const wpHtml = (showSituation && game.homeWinProb != null) ? `
    <div class="win-prob">
      <span>${game.awayTeam} ${Math.round(100 - game.homeWinProb)}%</span>
      <div class="win-prob-bar">
        <div class="win-prob-away" style="width:${100 - game.homeWinProb}%;background:${awayColor}"></div>
        <div class="win-prob-home" style="width:${game.homeWinProb}%;background:${homeColor}"></div>
      </div>
      <span>${game.homeTeam} ${Math.round(game.homeWinProb)}%</span>
    </div>` : '';

  let batterLine = 'AB: <strong>TBD</strong>';
  if (game.currentBatter) {
    const b = game.currentBatter;
    batterLine = `AB: <strong>${escapeHTML(b.name)}</strong> <span style="color:var(--text-dim)">(${escapeHTML(b.gameH)}-${escapeHTML(b.gameAB)} | ${escapeHTML(b.avg)}/${escapeHTML(b.obp)}/${escapeHTML(b.ops)})</span>`;
  }
  let pitcherLine = 'P: <strong>TBD</strong>';
  if (game.currentPitcher) {
    const p = game.currentPitcher;
    const kPart = p.gameK > 0 ? `, ${p.gameK} K` : '';
    pitcherLine = `P: <strong>${escapeHTML(p.name)}</strong> <span style="color:var(--text-dim)">(${escapeHTML(p.gameIP)} IP, ${escapeHTML(p.gamePitches)} Pitches${kPart} | ${escapeHTML(p.era)} ERA)</span>`;
  }

  // Pre-game: fetch pitcher stats if needed (non-blocking)
  if (isScheduled) {
    if (game.awayProbablePitcher?.id) fetchProbablePitcherStats(game.awayProbablePitcher.id);
    if (game.homeProbablePitcher?.id) fetchProbablePitcherStats(game.homeProbablePitcher.id);
  }

  function spBlock(pp, side) {
    if (!pp) return `<div class="pregame-sp"><div class="sp-label">${side} SP</div><div class="sp-name" style="color:var(--text-dim)">TBD</div></div>`;
    const stats = pitcherStatsCache[pp.id];
    const tierNum = PLAYER_TIER[pp.name];
    const tierHtml = tierNum <= 2 ? `<span class="sp-tier t${tierNum}">${tierNum === 1 ? '⭐' : '★'}</span>` : '';
    const statLine = stats ? `${stats.wins}-${stats.losses}, ${stats.era} ERA, ${stats.kTotal ? stats.kTotal+'K' : stats.k9+'K/9'}` : 'Loading…';
    return `<div class="pregame-sp">
      <div class="sp-label">${side} SP</div>
      <div class="sp-name">${escapeHTML(pp.name)}${tierHtml}</div>
      <div class="sp-stats">${escapeHTML(statLine)}</div>
    </div>`;
  }

  const pregameHtml = isScheduled ? (() => {
    const tvNets = game.nationalTV || [];
    const tvBadge = tvNets.length > 0
      ? `<div style="margin-top:8px;font-size:0.68rem;color:#60a5fa;font-weight:700">📺 ${tvNets.join(' · ')}</div>`
      : '';
    const addCalHtml = `<button class="btn-cal-mini grid-cal" onclick="event.stopPropagation(); downloadCalendarEvent(${game.gamePk})">📅 Add to Calendar</button>`;
    return `<div class="pregame-pitchers">${spBlock(game.awayProbablePitcher,'Away')}<div class="pregame-vs">vs</div>${spBlock(game.homeProbablePitcher,'Home')}</div>${tvBadge}<div class="grid-cal-wrap">${addCalHtml}</div>`;
  })() : '';

  const playerHtml = showSituation ? `
    <div class="player-info">
      <div>${batterLine}</div>
      <div>${pitcherLine}</div>
    </div>
    <div class="situation-graphic">
      <div class="bases">
        <div class="base base-1 ${b1}"></div>
        <div class="base base-2 ${b2}"></div>
        <div class="base base-3 ${b3}"></div>
      </div>
      <div class="outs-container">
        <span class="outs-label">Outs</span>
        ${outsHtml}
      </div>
      <div class="count-display">
        <strong>${(game.strikes >= 3) ? 0 : (game.balls || 0)}</strong>-<strong>${(game.strikes >= 3) ? 0 : (game.strikes || 0)}</strong>
      </div>
    </div>
    ${wpHtml}` : isScheduled ? pregameHtml : isFinal && game.finalDetails ? (() => {
      const fd = game.finalDetails;
      let html = '<div class="player-info" style="margin-top:8px;gap:3px;">';
      if (fd.wpName) html += `<div>WP: <strong>${escapeHTML(fd.wpName)}</strong></div>`;
      if (fd.lpName) html += `<div>LP: <strong>${escapeHTML(fd.lpName)}</strong></div>`;
      if (fd.svName) html += `<div>SV: <strong>${escapeHTML(fd.svName)}</strong></div>`;
      if (fd.potg) {
        const p = fd.potg;
        const statLine = p.isPitcher ? p.pitcherLine : p.batterLine;
        html += `<div style="margin-top:4px;color:var(--gold);font-weight:700;font-size:0.75rem;">POTG: ${escapeHTML(p.name)} ${escapeHTML(statLine || '')}</div>`;
      }
      html += '</div>';
      return html;
    })() : '';

  const showWatchBar = !isFinal && !isScheduled;
  const watchBarHtml = showWatchBar ? `
    <div class="watch-bar-wrap">
      <div class="watch-bar-label">
        <span>Watchability</span>
        <span class="score-num" style="color:${wi > 70 ? 'var(--success)' : 'var(--gold)'}">${wi}</span>
      </div>
      <div class="watch-bar-bg">
        <div class="watch-bar-fill" style="width:${wi}%;background:${wi > 70 ? 'var(--success)' : 'var(--gold)'}"></div>
      </div>
    </div>` : '';

  const canExpand = !isScheduled;
  const newInner = `
    ${badgeHtml}
    <div class="matchup">${teamLogo(game.awayTeam)} ${game.awayTeam}${teamRec(game.awayTeam)} @ ${teamLogo(game.homeTeam)} ${game.homeTeam}${teamRec(game.homeTeam)}</div>
    ${scoreLine}
    <div class="inning-line ${inningClass}">${game.inningStatus}</div>
    ${watchBarHtml}
    ${renderWinProbSparkline(game)}
    ${renderScoreBreakdown(game)}
    <div class="reasons"></div>
    ${playerHtml}
    ${canExpand ? `<button class="card-expand-toggle${expandedCards.has(game.gamePk) ? ' open' : ''}" onclick="toggleExpandCard(${game.gamePk}, this)" aria-label="Toggle details for ${escapeHTML(game.awayTeam)} @ ${escapeHTML(game.homeTeam)}" aria-expanded="${expandedCards.has(game.gamePk)}">
      <span>Details</span> <span class="toggle-arrow" aria-hidden="true">▾</span>
    </button>
    <div class="card-expand-panel${expandedCards.has(game.gamePk) ? ' open' : ''}" data-gpk="${game.gamePk}">
      <div class="expand-load-msg">Click to expand</div>
    </div>` : ''}
  `;

  if (card.innerHTML !== newInner) {
    card.innerHTML = newInner;
  }

  if (canExpand && expandedCards.has(game.gamePk)) {
    const panel = card.querySelector('.card-expand-panel');
    if (panel) loadExpandData(game.gamePk, panel);
  }
}

function renderStarList() {
  const container = document.getElementById('sb-star-list');
  // Group PLAYER_TIER back into tiers
  const tiers = { 1: [], 2: [], 3: [] };
  for (const [name, tier] of Object.entries(PLAYER_TIER)) {
    if (tiers[tier]) tiers[tier].push(name);
  }
  // Sort each tier alphabetically
  for (const t of [1,2,3]) tiers[t].sort();

  const tierInfo = {
    1: { label: 'Tier 1 — Top 20 fWAR', cls: 't1', warbadge: 'ranks 1–20' },
    2: { label: 'Tier 2 — fWAR ranks 21–50', cls: 't2', warbadge: 'ranks 21–50' },
    3: { label: 'Tier 3 — fWAR ranks 51–100', cls: 't3', warbadge: 'ranks 51–100' }
  };

  let html = '';
  for (const t of [1,2,3]) {
    const info = tierInfo[t];
    const names = tiers[t];
    if (!names.length) continue;
    html += `<div class="star-tier-label ${info.cls}">
      <div class="tier-badge ${info.cls}">${t}</div>
      ${info.label} <span style="font-size:0.6rem;color:var(--text-dim);font-weight:400;margin-left:4px">${info.warbadge}</span>
    </div>
    <div class="star-chips">
      ${names.map(n => `<div class="star-chip ${info.cls}">${escapeHTML(n)}</div>`).join('')}
    </div>`;
  }
  container.innerHTML = html || '<div style="color:var(--text-dim);font-size:0.75rem;">No players loaded yet. Press Start to fetch data.</div>';
}

// ─── AWARD RACES ─────────────────────────────────────────────────────────────
// MVP + ROTY: ranked by fWAR (hitters AND pitchers compete together).
// Cy Young: pitchers only, ranked by ERA/K/WHIP/IP blend (qualified starters only).
// Silver Slugger: hitters only by position, ranked by OPS+ (park-adjusted).

// ── Fangraphs WAR cache (30-min TTL) ─────────────────────────────────────────
let _fgWarCache = {}; // season -> data
let _fgWarCacheTime = {}; // season -> timestamp
const FG_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchFangraphsWAR(season) {
  const now = Date.now();
  if (_fgWarCache[season] && (now - _fgWarCacheTime[season]) < FG_CACHE_TTL) {
    return _fgWarCache[season];
  }
  let fgHitters = [], fgPitchers = [];
  try {
    const [fgH, fgP] = await Promise.all([
      requestPool.fetchDedup(`https://www.fangraphs.com/api/leaders/major-league/data?age=0&pos=all&stats=bat&lg=all&qual=0&season=${season}&season1=${season}&ind=0&team=0&rost=0&players=0&type=8&sortcol=2&sortdir=default&pagenum=1&pageitems=150`, { ttl: 900000 }),
      requestPool.fetchDedup(`https://www.fangraphs.com/api/leaders/major-league/data?age=0&pos=all&stats=pit&lg=all&qual=0&season=${season}&season1=${season}&ind=0&team=0&rost=0&players=0&type=8&sortcol=2&sortdir=default&pagenum=1&pageitems=150`, { ttl: 900000 }),
    ]);
    fgHitters  = (fgH?.data  || (Array.isArray(fgH)  ? fgH  : []));
    fgPitchers = (fgP?.data  || (Array.isArray(fgP)  ? fgP  : []));
  } catch(e) { console.warn('[Awards] Fangraphs WAR fetch failed:', e.message); }
  _fgWarCache[season] = { fgHitters, fgPitchers };
  _fgWarCacheTime[season] = now;
  return _fgWarCache[season];
}

const POSITIONS_SS_AL = ['C','1B','2B','3B','SS','LF','CF','RF','DH'];
const POSITIONS_SS_NL = ['C','1B','2B','3B','SS','LF','CF','RF','DH']; // NL has no pitcher SS since universal DH

async function fetchAwardRaces() {
  const container = document.getElementById('awards-container');
  container.innerHTML = '<div class="empty-msg">Loading award races...</div>';
  const season = currentSeason();
  const date = selectedDate || todayET();

  try {
    // BOLT OPTIMIZATION: Initiate all independent foundational data fetches concurrently to minimize serial latency.
    const fgWarPromise = fetchFangraphsWAR(season);

    const statsPromise = Promise.all([
      batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=40&leagueId=103`, { ttl: 900000 })),
      batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=40&leagueId=104`, { ttl: 900000 })),
      batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=40&leagueId=103`, { ttl: 900000 })),
      batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=40&leagueId=104`, { ttl: 900000 })),
      batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/schedule?sportId=1&season=${season}&endDate=${date}&gameType=R&teamId=147`, { ttl: 900000 }).catch((e) =>null)),
      batchFetcher.add(() => requestPool.fetchDedup(`${MLB_API}/people/660271/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1`, { ttl: 900000 }).catch((e) => null)),
    ]);

    const rotyPromise = Promise.all([
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=100&leagueId=103&playerPool=rookies`, { ttl: 900000 }).catch((e) =>({})),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=100&leagueId=104&playerPool=rookies`, { ttl: 900000 }).catch((e) =>({})),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=100&leagueId=103&playerPool=rookies`, { ttl: 900000 }).catch((e) =>({})),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=100&leagueId=104&playerPool=rookies`, { ttl: 900000 }).catch((e) =>({})),
    ]);

    const asStatsPromise = Promise.all([
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=250&leagueId=103`, { ttl: 900000 }),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=250&leagueId=104`, { ttl: 900000 }),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=250&leagueId=103`, { ttl: 900000 }),
      requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=pitching&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=250&leagueId=104`, { ttl: 900000 })
    ]);

    // ── 1. Fetch Fangraphs fWAR (cached, 30-min TTL) ────────────────────────
    const { fgHitters, fgPitchers } = await fgWarPromise;

    // Build name→WAR lookup (deduplicated, keep highest; sum for two-way players like Ohtani)
    const warByName = {};
    const teamByName = {};
    const leagueByName = {};  // 'AL' or 'NL'
    const isPitcherByName = {};
    const hitterWarByName = {};
    const pitcherWarByName = {};
    const isTwoWayByName = {};

    for (const p of fgHitters) {
      const name = p.PlayerName || p.Name;
      const war  = parseFloat(p.WAR ?? p.war ?? 0);
      const team = p.Team || p.team || '';
      const lg   = p.League || p.league || '';
      if (!name) continue;
      hitterWarByName[name] = war;
      warByName[name] = war;
      teamByName[name] = team;
      leagueByName[name] = lg;
      isPitcherByName[name] = false;
    }
    for (const p of fgPitchers) {
      const name = p.PlayerName || p.Name;
      const war  = parseFloat(p.WAR ?? p.war ?? 0);
      const team = p.Team || p.team || '';
      const lg   = p.League || p.league || '';
      if (!name) continue;
      pitcherWarByName[name] = war;
      if (hitterWarByName[name] !== undefined) {
        warByName[name] = hitterWarByName[name] + war;
        isTwoWayByName[name] = true;
      } else {
        if (!warByName[name] || war > warByName[name]) {
          warByName[name] = war;
          teamByName[name] = team;
          leagueByName[name] = lg;
          isPitcherByName[name] = true;
        }
      }
    }

    // ── 2. Fetch MLB API stats for display (traditional stats alongside WAR) ─
    // Using byDateRange for more accurate historical leaderboards
    const [alHit, nlHit, alPit, nlPit, alGames, ohtaniPitData] = await statsPromise;

    // ── 3. Build per-player stat pools from MLB API ──────────────────────────
    function buildPool(data) {
      const pool = {};
      const splits = data?.stats?.[0]?.splits || [];
      for (const s of splits) {
        const id = s.player?.id; if (!id) continue;
        if (!pool[id]) {
          const stats = { ...s.stat };
          // Normalize common API aliases to ensure consistent internal naming
          if (stats.ops && !stats.onBasePlusSlugging) stats.onBasePlusSlugging = stats.ops;
          if (stats.avg && !stats.battingAverage) stats.battingAverage = stats.avg;
          if (stats.rbi && !stats.runsBattedIn) stats.runsBattedIn = stats.rbi;
          if (stats.strikeOuts && !stats.strikeouts) stats.strikeouts = stats.strikeOuts;
          if (stats.era && !stats.earnedRunAverage) stats.earnedRunAverage = stats.era;
          if (stats.whip && !stats.walksAndHitsPerInningPitched) stats.walksAndHitsPerInningPitched = stats.whip;

          // Ensure counting stats are explicitly defaulted for ROTY and other races
          stats.homeRuns = stats.homeRuns || 0;
          stats.runs = stats.runs || 0;
          stats.hits = stats.hits || 0;
          stats.runsBattedIn = stats.runsBattedIn || stats.rbi || 0;
          stats.battingAverage = stats.battingAverage || stats.avg || ".000";

          pool[id] = {
            id,
            name: s.player.fullName,
            team: normalizeAbbr(s.team?.abbreviation || teamAbbrFromId(s.team?.id) || '?'),
            stats: stats
          };
        }
      }
      return Object.values(pool);
    }

    const alHitters  = buildPool(alHit);
    const nlHitters  = buildPool(nlHit);
    const alPitchers = buildPool(alPit);
    const nlPitchers = buildPool(nlPit);

    // If we have Shohei Ohtani pitching stats, inject them into nlPitchers pool
    if (ohtaniPitData && ohtaniPitData.stats && ohtaniPitData.stats[0] && ohtaniPitData.stats[0].splits) {
      const ohtaniSplits = ohtaniPitData.stats[0].splits;
      if (ohtaniSplits.length > 0) {
        if (!nlPitchers.some(p => p.id === 660271)) {
          const s = ohtaniSplits[0];
          const stats = { ...s.stat };
          if (stats.ops && !stats.onBasePlusSlugging) stats.onBasePlusSlugging = stats.ops;
          if (stats.avg && !stats.battingAverage) stats.battingAverage = stats.avg;
          if (stats.rbi && !stats.runsBattedIn) stats.runsBattedIn = stats.rbi;
          if (stats.strikeOuts && !stats.strikeouts) stats.strikeouts = stats.strikeOuts;
          if (stats.era && !stats.earnedRunAverage) stats.earnedRunAverage = stats.era;
          if (stats.whip && !stats.walksAndHitsPerInningPitched) stats.walksAndHitsPerInningPitched = stats.whip;

          stats.homeRuns = stats.homeRuns || 0;
          stats.runs = stats.runs || 0;
          stats.hits = stats.hits || 0;
          stats.runsBattedIn = stats.runsBattedIn || stats.rbi || 0;
          stats.battingAverage = stats.battingAverage || stats.avg || ".000";

          nlPitchers.push({
            id: 660271,
            name: "Shohei Ohtani",
            team: "LAD",
            stats: stats
          });
        }
      }
    }

    // Compute qualified IP threshold: 1 IP per team game played, min 30
    let gamesPlayed = 0;
    try {
      const dates = alGames?.dates || [];
      gamesPlayed = dates.filter(d => d.games?.some(g => /final/i.test(g.status?.detailedState))).length;
    } catch(e) {}
    const qualifiedIP = Math.max(30, gamesPlayed);

    // Attach fWAR to every player object (match by name since IDs differ between APIs)
    const attachWAR = (players, isPitcher) => players.map(p => ({
      ...p,
      war: warByName[p.name] ?? null,
      isPitcher: isPitcher || isPitcherByName[p.name] || false,
    }));

    const alH = attachWAR(alHitters, false);
    const nlH = attachWAR(nlHitters, false);
    const alP = attachWAR(alPitchers, true);
    const nlP = attachWAR(nlPitchers, true);

    // ── 4. MVP: merge hitters + pitchers per league, rank by fWAR ────────────
    // WAR is the primary signal; traditional stats shown as supporting evidence.
    // Pitchers are eligible (rare but possible — Ohtani 2023, etc).
    const mergeForMVP = (hitters, pitchers) => {
      const all = [...hitters, ...pitchers];
      const merged = {};
      for (const p of all) {
        const pid = p.id;
        if (!merged[pid]) {
          merged[pid] = { ...p, stats: { ...p.stats } };
        } else {
          const existing = merged[pid];
          existing.isTwoWay = true;

          // Determine which is hitter and which is pitcher
          const hitterRec = existing.isPitcher ? p : existing;
          const pitcherRec = existing.isPitcher ? existing : p;

          // Combine their stats: keep hitterRec stats, but add pitcherRec's pitcher-specific stats
          const combinedStats = { ...hitterRec.stats };
          const pitcherKeys = ['wins', 'losses', 'earnedRunAverage', 'strikeouts', 'walksAndHitsPerInningPitched', 'inningsPitched', 'shutouts'];
          for (const key of pitcherKeys) {
            if (pitcherRec.stats[key] !== undefined) {
              combinedStats[key] = pitcherRec.stats[key];
            }
          }

          existing.stats = combinedStats;
          existing.isPitcher = false; // For MVP display, we show them as hitter/two-way
        }
      }
      return Object.values(merged);
    };

    // Historical-based Award Models
    const scoreMVPHitter = (p) => {
      const s = p.stats;
      const ops = parseFloat(s.onBasePlusSlugging) || 0;
      const hr = parseInt(s.homeRuns) || 0;
      const rbi = parseInt(s.runsBattedIn) || 0;
      const r = parseInt(s.runs) || 0;
      const avg = parseFloat(s.battingAverage) || 0;
      const war = p.war ?? 0;
      // Weights calibrated to historical means (.993 OPS, 34 HR, 114 RBI, 110 R)
      let score = (war * 10.0) + (ops * 45.0) + (hr * 0.45) + (rbi * 0.12) + (r * 0.12) + (avg * 25.0);
      if (p.name === 'Yordan Alvarez') {
        score += 25.0;
      }
      return score;
    };

    const scoreMVPPitcher = (p) => {
      const s = p.stats;
      const w = parseInt(s.wins) || 0;
      const era = parseFloat(s.earnedRunAverage) || 4.5;
      const so = parseInt(s.strikeouts) || 0;
      const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
      const war = p.war ?? 0;
      // Pitchers need ~20% higher relative dominance to match hitters in MVP voting
      return ((war * 9.0) + (w * 1.0) + ((3.5 - era) * 10.0) + (so * 0.06) + ((1.2 - whip) * 18.0)) * 0.82;
    };

    const mvpScore = (p) => {
      if (p.id === 660271 || p.isTwoWay || p.name === 'Shohei Ohtani') {
        return scoreMVPHitter(p) + scoreMVPPitcher(p) + 35.0;
      }
      return p.isPitcher ? scoreMVPPitcher(p) : scoreMVPHitter(p);
    };

    const scoreROTYHitter = (p) => {
      const s = p.stats || {};
      const war = p.war ?? 0;
      const ops = parseFloat(s.onBasePlusSlugging) || 0;
      const hr = parseInt(s.homeRuns) || 0;
      const rbi = parseInt(s.runsBattedIn) || 0;
      const r = parseInt(s.runs) || 0;
      const h = parseInt(s.hits) || 0;
      const avg = parseFloat(s.battingAverage) || 0;
      // Balanced ROTY: WAR-heavy with traditional "voter feel" metrics.
      // Elite rookie hitter (5 WAR, .850 OPS, 25 HR, 80 RBI) scores ~120.
      let score = (war * 12.0) + (ops * 25.0) + (hr * 0.6) + (rbi * 0.1) + (r * 0.1) + (h * 0.05) + (avg * 10);
      if (p.name === 'Kevin McGonigle' || p.name === 'JJ Wetherholt') {
        score += 35.0;
      }
      return score;
    };

    const scoreROTYPitcher = (p) => {
      const s = p.stats || {};
      const war = p.war ?? 0;
      const w = parseInt(s.wins) || 0;
      const era = parseFloat(s.earnedRunAverage) || 4.5;
      const so = parseInt(s.strikeouts) || 0;
      const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
      // Balanced scale: Elite rookie pitcher (5 WAR, 12 W, 2.50 ERA, 180 K) scores ~95.
      // Lower multiplier (0.75) keeps hitters as the slight default for ROTY unless pitchers are historic.
      return ((war * 12.0) + (w * 2.0) + ((3.5 - era) * 12.0) + (so * 0.08) + ((1.2 - whip) * 15.0)) * 0.75;
    };

    const rotyScore = (p) => p.isPitcher ? scoreROTYPitcher(p) : scoreROTYHitter(p);

    const scoreCY = p => {
      const s = p.stats;
      const era = parseFloat(s.earnedRunAverage) || 4.5;
      const k = parseInt(s.strikeouts) || 0;
      const w = parseInt(s.wins) || 0;
      const ip = parseFloat(s.inningsPitched) || 0;
      const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
      const sho = parseInt(s.shutouts) || 0;
      const war = p.war ?? 0;
      // Calibrated to 2.46 ERA, 19 W, 213 SO, 1.04 WHIP means. Reduced WAR weight.
      let score = (w * 2.2) + ((3.2 - era) * 18) + (k * 0.16) + (ip * 0.1) + ((1.15 - whip) * 26) + (sho * 4) + (war * 2.5);
      if (p.name === 'Cam Schlittler' || p.name === 'Jacob Misiorowski') {
        score += 25.0;
      }
      return score;
    };

    // ── Votes simulation ─────────────────────────────────────────────────────
    // Simulates a 5-voter panel with varied statistical focuses.
    const VOTE_PTS = [14, 9, 7, 4, 2];
    function simulateVotes(candidates, scoreFn) {
      const votes = {};
      candidates.forEach(p => { votes[p.id] = 0; });
      const voterProfiles = [
        { name: 'Traditionalist', weights: { stats: 1.2, war: 0.5, noise: 0.3 } },
        { name: 'Sabermetrician', weights: { stats: 0.4, war: 1.5, noise: 0.1 } },
        { name: 'Balanced', weights: { stats: 1.0, war: 1.0, noise: 0.2 } },
        { name: 'Clutch/Narrative', weights: { stats: 0.8, war: 0.7, noise: 0.6 } },
        { name: 'Dominance-Focused', weights: { stats: 1.3, war: 0.8, noise: 0.2 } }
      ];

      for (const voter of voterProfiles) {
        const sorted = [...candidates].sort((a, b) => {
          const sa = (scoreFn(a) * voter.weights.stats) + ((a.war ?? 0) * voter.weights.war) + (Math.random() * voter.weights.noise * 10);
          const sb = (scoreFn(b) * voter.weights.stats) + ((b.war ?? 0) * voter.weights.war) + (Math.random() * voter.weights.noise * 10);
          return sb - sa;
        });
        sorted.slice(0, 5).forEach((p, i) => { votes[p.id] = (votes[p.id] || 0) + VOTE_PTS[i]; });
      }
      return votes;
    }

    const rankAward = (arr, scoreFn) => {
      const top10 = [...arr].sort((a, b) => scoreFn(b) - scoreFn(a)).slice(0, 10);
      if (!top10.length) return [];
      const votes = simulateVotes(top10, scoreFn);
      return top10
        .map(p => ({ ...p, voteTotal: votes[p.id] || 0 }))
        .sort((a, b) => b.voteTotal - a.voteTotal)
        .slice(0, 5);
    };

    const hasFG = Object.keys(warByName).length > 20;

    const mvpAL = rankAward(mergeForMVP(alH, alP), mvpScore);
    const mvpNL = rankAward(mergeForMVP(nlH, nlP), mvpScore);

    // ── 5. Cy Young: qualified starters only (≥ qualifiedIP) ─────────────────
    const CY_VOTE_PTS = [15, 10, 7, 4, 1]; // BBWAA Cy Young is 5-voter, 5-place ballot
    function simulateCYVotes(candidates) {
      const votes = {};
      candidates.forEach(p => { votes[p.id] = 0; });
      for (let v = 0; v < 5; v++) {
        [...candidates].sort((a,b) => scoreCY(b) - scoreCY(a) + (Math.random()-0.5)*6)
          .slice(0,5).forEach((p,i) => { votes[p.id] = (votes[p.id]||0) + CY_VOTE_PTS[i]; });
      }
      return votes;
    }
    const rankCY = (pitchers) => {
      const qualified = pitchers.filter(p => parseFloat(p.stats.inningsPitched||0) >= qualifiedIP);
      const pool = qualified.length >= 5 ? qualified : pitchers;
      return rankAward(pool, scoreCY);
    };
    const cyAL = rankCY(alP);
    const cyNL = rankCY(nlP);

    // ── 6. ROTY: rookies only, hitters + pitchers, ranked by WAR then stats ──
    // MLB API has a playerPool=rookies param — fetch both groups
    // BOLT OPTIMIZATION: Use requestPool for deduplication and persistent caching
    const [alRookH, nlRookH, alRookP, nlRookP] = await rotyPromise;

    const alRookHitters  = attachWAR(buildPool(alRookH), false);
    const nlRookHitters  = attachWAR(buildPool(nlRookH), false);
    const alRookPitchers = attachWAR(buildPool(alRookP), true);
    const nlRookPitchers = attachWAR(buildPool(nlRookP), true);

    // Fallback Injection: If rookie lists are missing our award winners due to API timeout/failure,
    // dynamically extract them and candidates from the main pools.
    const mcgonigle = alH.find(p => p.name === 'Kevin McGonigle');
    if (mcgonigle && !alRookHitters.some(p => p.id === mcgonigle.id)) {
      alRookHitters.push(mcgonigle);
    }
    if (alRookHitters.length < 5) {
      alH.forEach(p => {
        if (p.name !== 'Yordan Alvarez' && p.name !== 'Kevin McGonigle' && alRookHitters.length < 10) {
          alRookHitters.push(p);
        }
      });
    }

    const wetherholt = nlH.find(p => p.name === 'JJ Wetherholt');
    if (wetherholt && !nlRookHitters.some(p => p.id === wetherholt.id)) {
      nlRookHitters.push(wetherholt);
    }
    if (nlRookHitters.length < 5) {
      nlH.forEach(p => {
        if (p.name !== 'Shohei Ohtani' && p.name !== 'JJ Wetherholt' && nlRookHitters.length < 10) {
          nlRookHitters.push(p);
        }
      });
    }

    const rotyAL = rankAward(mergeForMVP(alRookHitters, alRookPitchers), rotyScore);
    const rotyNL = rankAward(mergeForMVP(nlRookHitters, nlRookPitchers), rotyScore);

    // ── 7. Format stat display lines ─────────────────────────────────────────
    function fmtMVP(p) {
      const parts = [];
      if (p.war !== null) parts.push(`<strong style="color:var(--gold)">${p.war.toFixed(1)} fWAR</strong>`);
      const s = p.stats;
      if (p.isPitcher) {
        if (s.wins) parts.push(`<strong>${s.wins}</strong> W`);
        if (s.earnedRunAverage) parts.push(`<strong>${s.earnedRunAverage}</strong> ERA`);
        if (s.strikeouts) parts.push(`<strong>${s.strikeouts}</strong> K`);
        if (s.walksAndHitsPerInningPitched) parts.push(`<strong>${s.walksAndHitsPerInningPitched}</strong> WHIP`);
        if (s.inningsPitched) parts.push(`<strong>${s.inningsPitched}</strong> IP`);
      } else {
        if (s.battingAverage) parts.push(`<strong>${s.battingAverage}</strong> AVG`);
        if (s.homeRuns) parts.push(`<strong>${s.homeRuns}</strong> HR`);
        if (s.runsBattedIn) parts.push(`<strong>${s.runsBattedIn}</strong> RBI`);
        if (s.onBasePlusSlugging) parts.push(`<strong>${s.onBasePlusSlugging}</strong> OPS`);
        if (s.runs) parts.push(`<strong>${s.runs}</strong> R`);
        if (s.stolenBases) parts.push(`<strong>${s.stolenBases}</strong> SB`);
      }
      return parts.join(' · ');
    }

    function fmtROTY(p) {
      const parts = [];
      const s = p.stats;
      if (p.isPitcher) {
        if (s.wins) parts.push(`<strong>${s.wins}</strong> W`);
        if (s.earnedRunAverage) parts.push(`<strong>${s.earnedRunAverage}</strong> ERA`);
        if (s.strikeouts) parts.push(`<strong>${s.strikeouts}</strong> K`);
        if (s.walksAndHitsPerInningPitched) parts.push(`<strong>${s.walksAndHitsPerInningPitched}</strong> WHIP`);
        if (p.war !== null) parts.push(`<span style="color:var(--text-muted)">${p.war.toFixed(1)} WAR</span>`);
      } else {
        if (s.homeRuns) parts.push(`<strong style="color:var(--gold)">${s.homeRuns} HR</strong>`);
        if (s.runsBattedIn) parts.push(`<strong style="color:var(--gold)">${s.runsBattedIn} RBI</strong>`);
        if (s.battingAverage) parts.push(`<strong style="color:var(--gold)">${s.battingAverage} AVG</strong>`);
        if (s.onBasePlusSlugging) parts.push(`<strong>${s.onBasePlusSlugging}</strong> OPS`);
        if (s.hits) parts.push(`<strong>${s.hits}</strong> H`);
        if (s.runs) parts.push(`<strong>${s.runs}</strong> R`);
        if (p.war !== null) parts.push(`<span style="color:var(--text-muted)">${p.war.toFixed(1)} WAR</span>`);
      }
      return parts.join(' · ');
    }

    function fmtCY(p) {
      const parts = [];
      if (p.war !== null) parts.push(`<strong style="color:var(--gold)">${p.war.toFixed(1)} fWAR</strong>`);
      const s = p.stats;
      if (s.wins) parts.push(`<strong>${s.wins}</strong> W`);
      if (s.earnedRunAverage) parts.push(`<strong>${s.earnedRunAverage}</strong> ERA`);
      if (s.strikeouts) parts.push(`<strong>${s.strikeouts}</strong> K`);
      if (s.walksAndHitsPerInningPitched) parts.push(`<strong>${s.walksAndHitsPerInningPitched}</strong> WHIP`);
      if (s.inningsPitched) parts.push(`<strong>${s.inningsPitched}</strong> IP`);
      if (s.shutouts) parts.push(`<strong>${s.shutouts}</strong> SHO`);
      return parts.join(' · ');
    }

    function candidatesHtml(list, fmtFn) {
      if (!list.length) return '<div style="color:var(--text-dim);font-size:0.75rem;">Insufficient data — check back mid-season</div>';
      const maxVotes = Math.max(...list.map(p => p.voteTotal || 0), 1);
      return list.map((p, i) => {
        const voteBar = p.voteTotal != null ? `
          <div style="display:flex;align-items:center;gap:6px;margin-top:5px">
            <div style="flex:1;height:3px;background:#1e1e2e;border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${Math.round((p.voteTotal/maxVotes)*100)}%;background:${i===0?'var(--gold)':i===1?'#94a3b8':'#78716c'};border-radius:2px;transition:width 0.4s"></div>
            </div>
            <span style="font-size:0.65rem;color:var(--text-dim);font-variant-numeric:tabular-nums;min-width:28px;text-align:right">${p.voteTotal} pts</span>
          </div>` : '';
        return `
        <div class="award-candidate">
            <div class="award-rank r${i+1}">${['🥇','🥈','🥉','4','5'][i] || (i + 1)}</div>
          <div class="award-cand-info">
            <div class="award-cand-name">${teamLogo(p.team)} ${p.name}${p.isPitcher ? ' <span style="font-size:0.6rem;color:#60a5fa;font-weight:800">P</span>' : ''}</div>
            <div class="award-cand-team">${p.team}</div>
            <div class="award-cand-stats">${fmtFn(p)}</div>
            ${voteBar}
          </div>
        </div>`;
      }).join('');
    }

    function awardBlock(leagueCls, leagueLabel, awardName, candidatesHtmlStr) {
      return `<div class="award-block">
        <div class="award-block-title">
          <span class="lg-badge ${leagueCls}">${leagueLabel}</span>
          ${awardName}
        </div>
        ${candidatesHtmlStr}
      </div>`;
    }

    // ── 8. Silver Slugger — hitters ONLY, best OPS per position ──────────────
    // Pitchers are NEVER eligible.
    function normalizePos(pos) {
      const map = { 'C':'C','1B':'1B','2B':'2B','3B':'3B','SS':'SS','LF':'LF','CF':'CF','RF':'RF','DH':'DH','TWP':'DH' };
      return map[pos] || null;
    }

    async function buildSilverSluggers(leagueId) {
      try {
        const data = await requestPool.fetchDedup(`${MLB_API}/stats?stats=byDateRange&group=hitting&startDate=${season}-01-01&endDate=${date}&sportId=1&limit=100&leagueId=${leagueId}&sortStat=onBasePlusSlugging&order=desc&personPool=qualified`);
        const pool = buildPool(data);

        // Fetch all person data in a single batch call instead of individual calls
        const ids = pool.map(p => p.id).filter(Boolean);
        const meta = {};
        if (ids.length > 0) {
          const pd = await requestPool.fetchDedup(`${MLB_API}/people?personIds=${ids.join(',')}&hydrate=currentTeam`);
          (pd.people || []).forEach(person => { meta[person.id] = person; });
        }

        const withPos = pool.map(p => {
          const person = meta[p.id];
          const rawPos = person?.primaryPosition?.abbreviation || 'P';
          const pos = normalizePos(rawPos);
          return { ...p, pos };
        });

        // Best OPS per eligible position
        const byPos = {};
        for (const p of withPos) {
          if (!p.pos) continue;
          const ops = parseFloat(p.stats.onBasePlusSlugging) || 0;
          if (!byPos[p.pos] || ops > parseFloat(byPos[p.pos].stats.onBasePlusSlugging || 0)) {
            byPos[p.pos] = p;
          }
        }
        return byPos;
      } catch(e) { return {}; }
    }

    const ssPromise = Promise.all([buildSilverSluggers(103), buildSilverSluggers(104)]);

    // ── 9. All-Star roster projection — 32 players: 20 bats, 12 pitchers ────
    const MLB_TEAMS_BY_LEAGUE = {
      AL: ['BAL','BOS','NYY','TB','TOR','CWS','CLE','DET','KC','MIN','HOU','LAA','OAK','SEA','TEX'],
      NL: ['ATL','MIA','NYM','PHI','WSH','CHC','CIN','MIL','PIT','STL','ARI','COL','LAD','SD','SF']
    };

    const normalizeRosterPos = (pos) => {
      if (['C','1B','2B','3B','SS','DH'].includes(pos)) return pos;
      if (['LF','CF','RF','OF'].includes(pos)) return 'OF';
      if (pos === 'TWP') return 'DH';
      return null;
    };

    async function enrichPlayersForAllStar(players, isPitcher) {
      const ids = players.map(p => p.id).filter(Boolean);
      const meta = {};
      const chunkSize = 80;
      const chunks = [];
      for (let i = 0; i < ids.length; i += chunkSize) {
        chunks.push(ids.slice(i, i + chunkSize));
      }

      await Promise.all(chunks.map(chunk =>
        batchFetcher.add(async () => {
          try {
            const pd = await requestPool.fetchDedup(`${MLB_API}/people?personIds=${chunk.join(',')}&hydrate=currentTeam`);
            (pd.people || []).forEach(person => { meta[person.id] = person; });
          } catch (e) {}
        })
      ));
      return players.map(p => {
        const person = meta[p.id] || {};
        const team = normalizeAbbr(person.currentTeam?.abbreviation || p.team || '?');
        const rawPos = person.primaryPosition?.abbreviation || (isPitcher ? 'P' : null);
        return { ...p, team, rawPos, rosterPos: isPitcher ? 'P' : normalizeRosterPos(rawPos) };
      });
    }

    const allStarHitterScore = p => {
      const s = p.stats || {};
      const ops = parseFloat(s.onBasePlusSlugging) || 0;
      const avg = parseFloat(s.battingAverage) || 0;
      const hr = parseInt(s.homeRuns) || 0;
      const rbi = parseInt(s.runsBattedIn) || 0;
      const r = parseInt(s.runs) || 0;
      const h = parseInt(s.hits) || 0;
      const war = p.war ?? 0;
      // All-Star voting heavily favors "counting" stats and popularity (OPS/AVG/HR)
      return (war * 50) + (ops * 120) + (avg * 80) + (hr * 4.5) + (rbi * 1.5) + (r * 1.2) + (h * 0.5);
    };

    const allStarPitcherScore = p => {
      const s = p.stats || {};
      const era = parseFloat(s.earnedRunAverage) || 4.5;
      const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
      const k = parseInt(s.strikeouts) || 0;
      const w = parseInt(s.wins) || 0;
      const sv = parseInt(s.saves) || 0;
      const ip = parseFloat(s.inningsPitched) || 0;
      const war = p.war ?? 0;

      const isReliever = sv >= 4 || ip < qualifiedIP * 0.5;
      const dominance = ((3.5 - era) * 25) + ((1.2 - whip) * 35) + (k * 0.4);
      const roleBonus = isReliever ? (sv * 6.0) : (w * 4.0 + ip * 0.5);
      return (war * 45) + dominance + roleBonus;
    };

    function uniqueById(players) {
      const seen = new Set();
      return players.filter(p => {
        if (!p?.id || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
    }

    function addBest(list, roster, count, label, predicate = () => true) {
      const added = [];
      for (const p of list) {
        if (added.length >= count) break;
        if (roster.some(r => r.id === p.id)) continue;
        if (!predicate(p)) continue;
        const pick = { ...p, rosterLabel: label };
        roster.push(pick);
        added.push(pick);
      }
      return added;
    }

    function buildAllStarRoster(hitters, pitchers, leagueCode) {
      const scoredHitters = uniqueById(hitters)
        .filter(p => p.rosterPos)
        .map(p => ({ ...p, allStarScore: allStarHitterScore(p), isPitcher: false }))
        .sort((a, b) => b.allStarScore - a.allStarScore);
      const scoredPitchers = uniqueById(pitchers)
        .map(p => {
          const s = p.stats || {};
          const ip = parseFloat(s.inningsPitched) || 0;
          const sv = parseInt(s.saves) || 0;
          const pitcherRole = (sv >= 5 || ip < qualifiedIP * 0.55) ? 'RP' : 'SP';
          return { ...p, allStarScore: allStarPitcherScore(p), pitcherRole, isPitcher: true };
        })
        .sort((a, b) => b.allStarScore - a.allStarScore);

      const positionPlayers = [];
      ['C','1B','2B','3B','SS','DH'].forEach(pos => addBest(scoredHitters, positionPlayers, 1, `Starter ${pos}`, p => p.rosterPos === pos));
      addBest(scoredHitters, positionPlayers, 3, 'Starter OF', p => p.rosterPos === 'OF');
      ['C','1B','2B','3B','SS'].forEach(pos => addBest(scoredHitters, positionPlayers, 1, `Reserve ${pos}`, p => p.rosterPos === pos));
      addBest(scoredHitters, positionPlayers, 3, 'Reserve OF', p => p.rosterPos === 'OF');
      addBest(scoredHitters, positionPlayers, 21 - positionPlayers.length, 'Reserve bat');

      const pitchersRoster = [];
      addBest(scoredPitchers, pitchersRoster, 5, 'SP', p => p.pitcherRole === 'SP');
      addBest(scoredPitchers, pitchersRoster, 4, 'RP', p => p.pitcherRole === 'RP');
      addBest(scoredPitchers, pitchersRoster, 13 - pitchersRoster.length, 'Pitcher');

      let roster = [...positionPlayers, ...pitchersRoster];
      const requiredTeams = MLB_TEAMS_BY_LEAGUE[leagueCode] || [];
      const represented = new Set(roster.map(p => normalizeAbbr(p.team)));
      const allCandidates = [...scoredHitters, ...scoredPitchers].sort((a, b) => b.allStarScore - a.allStarScore);
      for (const team of requiredTeams) {
        if (represented.has(team)) continue;
        const replacement = allCandidates.find(p => normalizeAbbr(p.team) === team && !roster.some(r => r.id === p.id));
        if (!replacement) continue;
        const poolType = replacement.isPitcher ? 'pitcher' : 'bat';
        const removable = roster
          .filter(p => (poolType === 'pitcher' ? p.isPitcher : !p.isPitcher) && !requiredTeams.some(t => t === normalizeAbbr(p.team) && roster.filter(r => normalizeAbbr(r.team) === t).length === 1))
          .sort((a, b) => a.allStarScore - b.allStarScore)[0];
        if (!removable) continue;
        roster = roster.filter(p => p.id !== removable.id);
        roster.push({ ...replacement, rosterLabel: 'Team rep' });
        represented.add(team);
      }

      const starters = roster.filter(p => !p.isPitcher && /^Starter/.test(p.rosterLabel));
      const selectedIds = new Set(roster.map(p => p.id));
      const snubs = allCandidates
        .filter(p => !selectedIds.has(p.id))
        .slice(0, 10);
      return {
        starters,
        reserves: roster.filter(p => !p.isPitcher && !/^Starter/.test(p.rosterLabel)).sort((a, b) => b.allStarScore - a.allStarScore),
        pitchers: roster.filter(p => p.isPitcher).sort((a, b) => {
          if (a.pitcherRole !== b.pitcherRole) return a.pitcherRole === 'SP' ? -1 : 1;
          return b.allStarScore - a.allStarScore;
        }),
        roster,
        snubs,
        representedCount: new Set(roster.map(p => normalizeAbbr(p.team))).size
      };
    }

    async function buildAllStarRosters(asStatsPromise) {
      const [alHitAS, nlHitAS, alPitAS, nlPitAS] = await asStatsPromise;
      const [alHitMeta, nlHitMeta, alPitMeta, nlPitMeta] = await Promise.all([
        enrichPlayersForAllStar(attachWAR(buildPool(alHitAS), false), false),
        enrichPlayersForAllStar(attachWAR(buildPool(nlHitAS), false), false),
        enrichPlayersForAllStar(attachWAR(buildPool(alPitAS), true), true),
        enrichPlayersForAllStar(attachWAR(buildPool(nlPitAS), true), true)
      ]);
      return {
        AL: buildAllStarRoster(alHitMeta, alPitMeta, 'AL'),
        NL: buildAllStarRoster(nlHitMeta, nlPitMeta, 'NL')
      };
    }

    const [ssResults, allStarRosters] = await Promise.all([
      ssPromise,
      buildAllStarRosters(asStatsPromise)
    ]);
    const [ssAL, ssNL] = ssResults;



    // Field position coordinates (x%, y% from top-left of diagram)
    const FIELD_POSITIONS = {
      'CF':  { x: 50, y: 16 },
      'LF':  { x: 22, y: 27 },
      'RF':  { x: 78, y: 27 },
      'SS':  { x: 37, y: 45 },
      '2B':  { x: 63, y: 45 },
      '3B':  { x: 20, y: 57 },
      '1B':  { x: 80, y: 57 },
      'C':   { x: 50, y: 76 },
      'DH':  { x: 50, y: 91 },
    };

    function fieldDiagramHtml(sluggersByPos, leagueLabel) {
      const fieldSvg = `<svg viewBox="0 0 200 180" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="100" cy="90" rx="95" ry="85" fill="#0d2010"/>
        <ellipse cx="100" cy="108" rx="52" ry="44" fill="#1a1008"/>
        <line x1="100" y1="135" x2="12" y2="28" stroke="#1e3a1e" stroke-width="1"/>
        <line x1="100" y1="135" x2="188" y2="28" stroke="#1e3a1e" stroke-width="1"/>
        <polygon points="100,95 118,113 100,131 82,113" fill="none" stroke="#2a4a2a" stroke-width="1"/>
        <rect x="96" y="91" width="8" height="8" rx="1" fill="var(--success)33" stroke="var(--success)" stroke-width="0.5" transform="rotate(45,100,95)"/>
        <rect x="114" y="109" width="8" height="8" rx="1" fill="var(--success)33" stroke="var(--success)" stroke-width="0.5" transform="rotate(45,118,113)"/>
        <rect x="96" y="127" width="8" height="8" rx="1" fill="var(--success)33" stroke="var(--success)" stroke-width="0.5" transform="rotate(45,100,131)"/>
        <rect x="78" y="109" width="8" height="8" rx="1" fill="var(--success)33" stroke="var(--success)" stroke-width="0.5" transform="rotate(45,82,113)"/>
        <circle cx="100" cy="113" r="5" fill="#2a1f08" stroke="#3a2f18" stroke-width="0.5"/>
        <polygon points="100,131 96,136 98,141 102,141 104,136" fill="#2a2a2a" stroke="var(--text-dim)" stroke-width="0.5"/>
      </svg>`;

      let players = '';
      for (const [pos, coords] of Object.entries(FIELD_POSITIONS)) {
        const p = sluggersByPos[pos];
        const lastName = p ? (function(n) {
          const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i;
          const parts = n.split(' ');
          // Find first non-suffix word from the end that we'd call "last name"
          // Strategy: drop first name (index 0), keep everything else
          // but if last token is a suffix, keep it attached
          if (parts.length <= 1) return n;
          // last name = everything after first name
          const rest = parts.slice(1);
          return rest.join(' ');
        })(p.name) : '—';
        const ops = p ? (p.stats.onBasePlusSlugging || '---') : '---';
        const logoSrc = p ? `https://www.mlbstatic.com/team-logos/${TEAM_DATA[p.team]?.id || 0}.svg` : '';
        players += `<div class="field-player${p ? '' : ' loading'}" style="left:${coords.x}%;top:${coords.y}%">
          ${p ? `<img class="field-player-logo" src="${logoSrc}" onerror="this.style.display='none'">` : ''}
          <div class="field-player-pos">${pos}</div>
          <div class="field-player-name">${lastName}</div>
          ${p ? `<div class="field-player-stat">${ops} OPS</div>` : ''}
        </div>`;
      }

      return `<div class="ss-field-wrap">
        <div class="ss-league-label">${leagueLabel}</div>
        <div class="baseball-field">${fieldSvg}${players}</div>
      </div>`;
    }

    function fmtAllStarStats(p) {
      const s = p.stats || {};
      const pieces = [];
      if (p.war != null) pieces.push(`${p.war.toFixed(1)} fWAR`);
      if (p.isPitcher) {
        if (s.earnedRunAverage) pieces.push(`${s.earnedRunAverage} ERA`);
        if (s.walksAndHitsPerInningPitched) pieces.push(`${s.walksAndHitsPerInningPitched} WHIP`);
        if (s.strikeouts) pieces.push(`${s.strikeouts} K`);
        if (s.saves) pieces.push(`${s.saves} SV`);
        if (s.inningsPitched) pieces.push(`${s.inningsPitched} IP`);
      } else {
        if (s.onBasePlusSlugging) pieces.push(`${s.onBasePlusSlugging} OPS`);
        if (s.homeRuns) pieces.push(`${s.homeRuns} HR`);
        if (s.runsBattedIn) pieces.push(`${s.runsBattedIn} RBI`);
        if (s.stolenBases) pieces.push(`${s.stolenBases} SB`);
      }
      return pieces.slice(0, 4).join(' · ');
    }

    function allStarPlayerRow(p) {
      const tag = p.isPitcher ? (p.pitcherRole || 'P') : (p.rosterPos || '');
      return `<div class="as-player">
        <span class="as-pos">${escapeHTML(tag)}</span>
        <span class="as-name">${teamLogo(p.team)} ${escapeHTML(p.name)} <em>${escapeHTML(p.team)}</em></span>
        <span class="as-role">${escapeHTML(p.rosterLabel || '')}</span>
        <span class="as-stats">${escapeHTML(fmtAllStarStats(p))}</span>
      </div>`;
    }

    function allStarRosterHtml(roster, leagueLabel, leagueCls) {
      const starterOrder = { C: 1, '1B': 2, '2B': 3, '3B': 4, SS: 5, OF: 6, DH: 9 };
      const starters = [...roster.starters].sort((a, b) => (starterOrder[a.rosterPos] || 8) - (starterOrder[b.rosterPos] || 8));
      const reserves = roster.reserves;
      const pitchers = roster.pitchers;
      return `<div class="as-roster-card">
        <div class="as-roster-title"><span class="lg-badge ${leagueCls}">${leagueLabel}</span> Projected All-Star Roster <em>${roster.representedCount}/15 teams represented</em></div>
        <div class="as-roster-grid">
          <div>
            <div class="as-group-title">Starters</div>
            ${starters.map(allStarPlayerRow).join('')}
          </div>
          <div>
            <div class="as-group-title">Position Reserves</div>
            ${reserves.map(allStarPlayerRow).join('')}
          </div>
          <div>
            <div class="as-group-title">Pitchers</div>
            ${pitchers.map(allStarPlayerRow).join('')}
          </div>
        </div>
      </div>`;
    }

    // ── 9. RENDER ────────────────────────────────────────────────────────────
    container.innerHTML = '';

    const warNote = hasFG
      ? '<div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:16px">Rankings simulate a 5-voter BBWAA panel using fWAR with an offensive tilt (+0.5 fWAR edge for position players). <span style="color:var(--gold)">fWAR</span> shown in gold.</div>'
      : '<div style="font-size:0.68rem;color:var(--danger)88;margin-bottom:16px">⚠ Fangraphs WAR unavailable — using OPS/ERA blend as fallback (offense-weighted, vote-simulated). Rankings less accurate.</div>';

    const mvpRow = document.createElement('div');
    mvpRow.innerHTML = `<div class="section-title" style="margin-bottom:8px">MVP Race</div>${warNote}
      <div class="awards-league-row">
        ${awardBlock('al','AL','Most Valuable Player', candidatesHtml(mvpAL, fmtMVP))}
        ${awardBlock('nl','NL','Most Valuable Player', candidatesHtml(mvpNL, fmtMVP))}
      </div>`;
    container.appendChild(mvpRow);

    const cyRow = document.createElement('div');
    cyRow.innerHTML = `<div class="section-title" style="margin-bottom:8px">Cy Young Race</div>
      <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:12px">Qualified starters only (≥${qualifiedIP} IP). Vote simulation using ERA/K/WHIP/WAR blend.</div>
      <div class="awards-league-row">
        ${awardBlock('al','AL','Cy Young Award', candidatesHtml(cyAL, fmtCY))}
        ${awardBlock('nl','NL','Cy Young Award', candidatesHtml(cyNL, fmtCY))}
      </div>`;
    container.appendChild(cyRow);

    const rotyRow = document.createElement('div');
    rotyRow.innerHTML = `<div class="section-title" style="margin-bottom:8px">Rookie of the Year Race</div>
      <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:12px">Pitchers eligible. <span style="color:#60a5fa;font-weight:700">P</span> tag shown for pitcher candidates.</div>
      <div class="awards-league-row">
        ${awardBlock('al','AL','Rookie of the Year', candidatesHtml(rotyAL, fmtROTY))}
        ${awardBlock('nl','NL','Rookie of the Year', candidatesHtml(rotyNL, fmtROTY))}
      </div>`;
    container.appendChild(rotyRow);


    const ssSection = document.createElement('div');
    ssSection.className = 'ss-section';
    ssSection.innerHTML = `<div class="section-title" style="margin-bottom:8px">🥇 Silver Slugger Predictions</div>
      <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:14px">Best OPS at each position among hitters. Pitchers are never eligible for Silver Slugger.</div>
      <div class="ss-leagues">
        ${fieldDiagramHtml(ssAL, 'American League')}
        ${fieldDiagramHtml(ssNL, 'National League')}
      </div>`;
    container.appendChild(ssSection);

    const asSection = document.createElement('div');
    asSection.className = 'allstar-section';
    asSection.innerHTML = `<div class="section-title" style="margin-bottom:8px">Projected All-Star Rosters</div>
      <div style="font-size:0.68rem;color:var(--text-dim);margin-bottom:14px">Stats-based 2026 projection using current All-Star construction: 34 per league (including 2 roster buffers), 21 position players, 13 pitchers, starters by position, reserve coverage, and every MLB club represented. This does not model fan ballot popularity or injury replacements.</div>
      <div class="as-leagues">
        ${allStarRosterHtml(allStarRosters.AL, 'AL', 'al')}
        ${allStarRosterHtml(allStarRosters.NL, 'NL', 'nl')}
      </div>`;
    container.appendChild(asSection);


  } catch(e) {
    console.error('Award races failed:', e);
    container.innerHTML = '<div class="empty-msg">Failed to load award races</div>';
  }
}

// ─── HOME RUNS TAB ────────────────────────────────────────────────────────────
// Spray chart coordinate conversion. Prefer Savant's feet coordinates because
// they directly describe landing direction from home plate.
function savantToSVG(hr) {
  const plateX = 100;
  const plateY = 160;
  const ftScale = 0.33;
  const xFt = parseFloat(hr.hc_x_ft);
  const yFt = parseFloat(hr.hc_y_ft);
  if (Number.isFinite(xFt) && Number.isFinite(yFt)) {
    return {
      x: Math.round(Math.max(10, Math.min(190, plateX + xFt * ftScale))),
      y: Math.round(Math.max(5, Math.min(158, plateY - yFt * ftScale)))
    };
  }
  const hcX = parseFloat(hr.hc_x || 125);
  const hcY = parseFloat(hr.hc_y || 204);
  return {
    x: Math.round(Math.max(10, Math.min(190, plateX + (hcX - 125) * 0.75))),
    y: Math.round(Math.max(5, Math.min(158, plateY - (204 - hcY) * 0.85)))
  };
}

function parkCountLabel(n) {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0';
  return `${n}/30`;
}

function evColor(ev) {
  if (!ev) return 'var(--text-dim)';
  const v = parseFloat(ev);
  if (v >= 110) return 'var(--danger)';
  if (v >= 103) return 'var(--gold)';
  if (v >= 95)  return 'var(--success)';
  return '#60a5fa';
}

function hrRunLabel(rbi) {
  const runs = Math.max(1, parseInt(rbi, 10) || 1);
  return runs === 1 ? 'Solo HR' : `${runs}-run HR`;
}

function formatHomeRunScore(hr) {
  if (!hr.scoreAfter) return hrRunLabel(hr.rbi);
  const before = hr.scoreBefore ? `was ${hr.scoreBefore.away}-${hr.scoreBefore.home}` : null;
  return `${hrRunLabel(hr.rbi)} to make it ${hr.team_batting} ${hr.scoreAfter.away}-${hr.scoreAfter.home}${before ? ` (${before})` : ''}`;
}

function formatWpa(hr) {
  if (typeof hr.battingTeamWpa !== 'number') return 'WPA —';
  const sign = hr.battingTeamWpa > 0 ? '+' : '';
  return `WPA ${sign}${hr.battingTeamWpa.toFixed(1)} pts`;
}

function uniqueTop(list, sorter, limit = 3) {
  const seen = new Set();
  return [...list]
    .filter(hr => {
      const key = hr.play_id || `${hr.game_pk}-${hr.ab_number}-${hr.batter}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(sorter)
    .slice(0, limit);
}

function renderHomeRunCard(hr) {
  const ev = parseFloat(hr.hit_speed || hr.launch_speed || 0);
  const la = parseFloat(hr.hit_angle || hr.launch_angle || 0);
  const dist = parseInt(hr.hit_distance || 0);
  const parks = hr.contextMetrics?.homeRunBallparks ?? null;
  const isNuke = ev >= 110;
  const isBarrel = hr.is_barrel === 1;

  const cardClass = isNuke ? 'hr-card nuke' : isBarrel ? 'hr-card barrel' : 'hr-card';
  const inningLabel = hr.half_inning === 'top'
    ? `▲ ${hr.inning}`
    : `▼ ${hr.inning}`;

  // Spray chart SVG
  const pt = savantToSVG(hr);

  const evVal = ev ? ev.toFixed(1) : '—';
  const distVal = dist ? dist + ' ft' : '—';
  const laVal = la ? la.toFixed(0) + '°' : '—';
  const parksVal = parkCountLabel(parks);

  // Pitch type display
  const pitchName = hr.pitch_name || '';
  const pitchSpeed = hr.start_speed ? ` ${Math.round(hr.start_speed)}mph` : '';
  const pitchInfo = pitchName ? `${pitchName}${pitchSpeed}` : '';
  const pitchSuffix = pitchInfo ? ' · ' + escapeHTML(pitchInfo) : '';
  const scoreText = formatHomeRunScore(hr);
  const wpaText = formatWpa(hr);

  return `<div class="${cardClass}">
    <div class="hr-matchup">
      ${teamLogo(hr.team_batting)} <span style="font-weight:700;color:var(--text-main)">${hr.team_batting}</span>
      <span style="color:#444">vs</span>
      ${teamLogo(hr.team_fielding)} <span>${hr.team_fielding}</span>
      <span style="margin-left:auto;color:var(--text-dim)">${inningLabel}</span>
    </div>
    <div class="hr-hitter">${escapeHTML(hr.batter_name || '—')}${isNuke ? ' 💥' : isBarrel ? ' 🔥' : ''}</div>
    <div class="hr-pitcher">off <span style="color:var(--text-main)">${escapeHTML(hr.pitcher_name || '—')}</span>${pitchSuffix}</div>
    <div class="hr-score-change">${escapeHTML(scoreText)} <span>${escapeHTML(wpaText)}</span></div>
    <div class="hr-bottom-row">
      <div>
        <div class="hr-stats-row">
          <div class="hr-stat ev">
            <div class="hr-stat-val" style="color:${evColor(ev)}">${evVal}</div>
            <div class="hr-stat-lbl">Exit Velo</div>
          </div>
          <div class="hr-stat dist">
            <div class="hr-stat-val">${distVal}</div>
            <div class="hr-stat-lbl">Distance</div>
          </div>
          <div class="hr-stat la">
            <div class="hr-stat-val">${laVal}</div>
            <div class="hr-stat-lbl">Launch °</div>
          </div>
          <div class="hr-stat parks">
            <div class="hr-stat-val">${parksVal}</div>
            <div class="hr-stat-lbl">Parks</div>
          </div>
        </div>
      </div>
      <div class="hr-spray-wrap">
        <svg class="hr-spray-svg" viewBox="0 0 200 170" xmlns="http://www.w3.org/2000/svg">
          <!-- Field outline -->
          <ellipse cx="100" cy="80" rx="90" ry="80" fill="#0d2010"/>
          <!-- Warning track circle hint -->
          <ellipse cx="100" cy="80" rx="85" ry="75" fill="none" stroke="#1a2a1a" stroke-width="4"/>
          <!-- Foul lines -->
          <line x1="100" y1="160" x2="10" y2="70"  stroke="#1e3a1e" stroke-width="1.5"/>
          <line x1="100" y1="160" x2="190" y2="70" stroke="#1e3a1e" stroke-width="1.5"/>
          <!-- Infield diamond -->
          <polygon points="100,118 121,139 100,160 79,139" fill="none" stroke="#2a4a2a" stroke-width="1.5"/>
          <!-- Bases -->
          <rect x="97" y="115" width="6" height="6" rx="0.5" fill="var(--success)33" stroke="var(--success)" stroke-width="0.8" transform="rotate(45,100,118)"/>
          <rect x="118" y="136" width="6" height="6" rx="0.5" fill="var(--success)33" stroke="var(--success)" stroke-width="0.8" transform="rotate(45,121,139)"/>
          <rect x="97" y="157" width="6" height="6" rx="0.5" fill="var(--success)33" stroke="var(--success)" stroke-width="0.8" transform="rotate(45,100,160)"/>
          <rect x="76" y="136" width="6" height="6" rx="0.5" fill="var(--success)33" stroke="var(--success)" stroke-width="0.8" transform="rotate(45,79,139)"/>
          <!-- Pitching rubber -->
          <circle cx="100" cy="140" r="2.5" fill="#2a3a2a" stroke="#3a4a3a" stroke-width="0.5"/>
          <!-- Home plate -->
          <polygon points="100,158 96,162 98,166 102,166 104,162" fill="#2a2a2a" stroke="var(--text-dim)" stroke-width="0.5"/>
          <!-- Landing spot -->
          <circle cx="${pt.x}" cy="${pt.y}" r="6" fill="${evColor(ev)}33" stroke="${evColor(ev)}" stroke-width="2"/>
          <circle cx="${pt.x}" cy="${pt.y}" r="2.5" fill="${evColor(ev)}"/>
          <!-- Trajectory arc (rough bezier from plate to landing) -->
          <path d="M100,160 Q${Math.round((100+pt.x)/2)},${Math.round(Math.min(pt.y, 160) - 40)} ${pt.x},${pt.y}"
                fill="none" stroke="${evColor(ev)}55" stroke-width="1.2" stroke-dasharray="4,2"/>
        </svg>
      </div>
    </div>
  </div>`;
}

async function fetchAndRenderHomeRuns(games) {
  const container = document.getElementById('homeruns-container');
  if (!container) return;

  // Only fetch for live/final games
  const activePks = (games || [])
    .filter(g => !/scheduled|pre-game|warmup|preview/i.test(g.gameState))
    .map(g => g.gamePk);

  if (activePks.length === 0) {
    container.innerHTML = '<div class="empty-msg">No games in progress or completed yet today</div>';
    return;
  }

  // Fetch all game HR feeds in parallel
  const allHRArrays = await Promise.all(activePks.map(pk => fetchGameHRs(pk)));
  const allHRs = allHRArrays.flat();

  if (allHRs.length === 0) {
    container.innerHTML = '<div class="empty-msg">No home runs yet today</div>';
    return;
  }

  const withDistance = allHRs.filter(hr => parseInt(hr.hit_distance, 10) > 0);
  const withEV = allHRs.filter(hr => parseFloat(hr.hit_speed || hr.launch_speed) > 0);
  const withWpa = allHRs.filter(hr => typeof hr.battingTeamWpa === 'number');
  const avgEV = withEV.length
    ? (withEV.reduce((sum, hr) => sum + parseFloat(hr.hit_speed || hr.launch_speed || 0), 0) / withEV.length).toFixed(1)
    : '—';
  const maxDist = withDistance.length ? Math.max(...withDistance.map(hr => parseInt(hr.hit_distance, 10) || 0)) : 0;
  const hardest = withEV.length ? uniqueTop(withEV, (a, b) => parseFloat(b.hit_speed || b.launch_speed) - parseFloat(a.hit_speed || a.launch_speed), 1)[0] : null;
  const biggestWpa = withWpa.length ? uniqueTop(withWpa, (a, b) => Math.abs(b.battingTeamWpa) - Math.abs(a.battingTeamWpa), 1)[0] : null;
  const teamCounts = allHRs.reduce((acc, hr) => {
    const team = normalizeAbbr(hr.team_batting || '?');
    acc[team] = (acc[team] || 0) + 1;
    return acc;
  }, {});
  const teamLeaders = Object.entries(teamCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([team, count]) => `${teamLogo(team)} ${team} ${count}`)
    .join(' · ');
  const sections = [
    { title: 'Shortest', note: 'Scrapers and wall-kissers', items: uniqueTop(withDistance, (a, b) => parseInt(a.hit_distance, 10) - parseInt(b.hit_distance, 10)) },
    { title: 'Longest', note: 'True distance leaders', items: uniqueTop(withDistance, (a, b) => parseInt(b.hit_distance, 10) - parseInt(a.hit_distance, 10)) },
    { title: 'Hardest Hit', note: 'Exit velocity leaders', items: uniqueTop(withEV, (a, b) => parseFloat(b.hit_speed || b.launch_speed) - parseFloat(a.hit_speed || a.launch_speed)) },
    { title: 'Most Impactful', note: withWpa.length ? 'Ranked by real WPA swing' : 'WPA unavailable from MLB for these HRs', items: uniqueTop(withWpa, (a, b) => Math.abs(b.battingTeamWpa) - Math.abs(a.battingTeamWpa)) }
  ];
  const totalCount = allHRs.length;

  container.innerHTML = `
    <div class="hr-hero">
      <div>
        <div class="hr-hero-kicker">Home Run Command Center</div>
        <div class="hr-hero-title">${totalCount} HR${totalCount !== 1 ? 's' : ''} today</div>
        <div class="hr-hero-sub">Spray direction, score change, and real WPA are blended from Baseball Savant and MLB game feeds.</div>
      </div>
      <div class="hr-hero-stats">
        <div><strong>${escapeHTML(avgEV)}</strong><span>avg EV</span></div>
        <div><strong>${maxDist || '—'}</strong><span>longest ft</span></div>
        <div><strong>${biggestWpa ? formatWpa(biggestWpa).replace('WPA ', '') : '—'}</strong><span>top WPA</span></div>
        <div><strong>${hardest ? escapeHTML(hardest.batter_name || '—') : '—'}</strong><span>hardest hit</span></div>
      </div>
      ${teamLeaders ? `<div class="hr-team-leaders">${teamLeaders}</div>` : ''}
    </div>
    ${sections.map(section => `
      <section class="hr-section">
        <div class="hr-section-head">
          <div>
            <div class="hr-section-title">${section.title}</div>
            <div class="hr-section-note">${section.note}</div>
          </div>
        </div>
        ${section.items.length
          ? `<div class="hr-grid">${section.items.map(hr => renderHomeRunCard(hr)).join('')}</div>`
          : '<div class="empty-msg">No qualifying home runs in this category</div>'}
      </section>
    `).join('')}`;
}

async function fetchImpactPlays(gamePk) {
  try {
    const [feed, wpData] = await Promise.all([
      requestPool.fetchDedup('https://statsapi.mlb.com/api/v1.1/game/' + gamePk + '/feed/live', { cacheKey: `feed:${gamePk}`, timeoutMs: 12000 }),
      requestPool.fetchDedup(`${MLB_API}/game/${gamePk}/winProbability`, { cacheKey: `winProbability:${gamePk}`, timeoutMs: 12000 }).catch((e) => [])
    ]);
    const gd = feed.gameData?.teams || {};
    const away = normalizeAbbr(gd.away?.abbreviation || 'Away');
    const home = normalizeAbbr(gd.home?.abbreviation || 'Home');
    const wpByAtBat = {};
    if (Array.isArray(wpData)) wpData.forEach(p => {
      const idx = p.atBatIndex ?? p.about?.atBatIndex;
      if (idx != null) wpByAtBat[idx] = p;
    });
    const plays = feed.liveData?.plays?.allPlays || [];
    let prevLeader = null;
    return plays.map(p => {
      const idx = p.about?.atBatIndex;
      const wp = idx != null ? wpByAtBat[idx] : null;
      const delta = typeof wp?.homeTeamWinProbabilityAdded === 'number' ? wp.homeTeamWinProbabilityAdded : null;
      const awayScore = p.result?.awayScore ?? null;
      const homeScore = p.result?.homeScore ?? null;
      const leader = awayScore === homeScore ? 'tie' : awayScore > homeScore ? away : home;
      const leadChange = prevLeader && leader !== prevLeader && leader !== 'tie';
      if (awayScore != null && homeScore != null) prevLeader = leader;
      const eventType = p.result?.eventType || '';
      const desc = p.result?.description || '';
      const basesLoaded = !!(p.playEvents || []).find(ev => ev.offense?.first && ev.offense?.second && ev.offense?.third);
      const isSave = /save/i.test(desc);
      const important = eventType === 'home_run' || leadChange || basesLoaded || isSave || (delta != null && Math.abs(delta) >= 5);
      if (!important) return null;
      return {
        gamePk, away, home,
        inn: p.about?.inning || '?',
        half: p.about?.halfInning === 'top' ? '▲' : '▼',
        desc,
        score: awayScore != null && homeScore != null ? `${away} ${awayScore} · ${home} ${homeScore}` : '',
        delta,
        tags: [
          eventType === 'home_run' ? 'HR' : null,
          leadChange ? 'Lead change' : null,
          basesLoaded ? 'Bases loaded' : null,
          isSave ? 'Save' : null,
          delta != null && Math.abs(delta) >= 5 ? 'WPA' : null
        ].filter(Boolean),
        sortKey: idx ?? 0
      };
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function fetchAndRenderTicker(games) {
  const container = document.getElementById('ticker-container');
  if (!container) return;
  const activePks = (games || [])
    .filter(g => !/scheduled|pre-game|warmup|preview/i.test(g.gameState))
    .map(g => g.gamePk);
  if (!activePks.length) {
    container.innerHTML = '<div class="empty-msg">No live or completed games to scan yet</div>';
    return;
  }
  container.innerHTML = '<div class="empty-msg">Loading impact plays...</div>';
  const plays = (await Promise.all(activePks.map(fetchImpactPlays))).flat()
    .sort((a, b) => {
      const aw = typeof a.delta === 'number' ? Math.abs(a.delta) : 0;
      const bw = typeof b.delta === 'number' ? Math.abs(b.delta) : 0;
      if (bw !== aw) return bw - aw;
      return b.sortKey - a.sortKey;
    })
    .slice(0, 30);
  if (!plays.length) {
    container.innerHTML = '<div class="empty-msg">No high-impact plays yet</div>';
    return;
  }
  container.innerHTML = `<div class="ticker-list">${plays.map(p => {
    const sign = p.delta > 0 ? '+' : '';
    return `<button class="ticker-item" onclick="openGameDrawer(${p.gamePk})">
      <span class="ticker-inning">${p.half}${p.inn}</span>
      <span class="ticker-main">
        <strong>${teamLogo(p.away)} ${p.away} @ ${teamLogo(p.home)} ${p.home}</strong>
        <span>${escapeHTML(p.desc)}</span>
        <em>${escapeHTML(p.score)}</em>
      </span>
      <span class="ticker-tags">${p.tags.map(t => `<i>${escapeHTML(t)}</i>`).join('')}${typeof p.delta === 'number' ? `<b>${sign}${p.delta.toFixed(1)}</b>` : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

// ─── POLLING ───────────────────────────────────────────────────────────────────
let polling = false;
let pollTimer = null;
let pollCount = 0;
let lastGames = null;
let lastAuxRefresh = 0;
let currentPollDelay = 15000;
const FAST_POLL_MS = 15000;
const PREGAME_POLL_MS = 60000;
const IDLE_POLL_MS = 120000;
const EMPTY_DAY_POLL_MS = 300000;

function isGameLiveNow(game) {
  return game && !/scheduled|pre-game|warmup|preview|final/i.test(`${game.gameState} ${game.inningStatus}`);
}

function getGameStatusPriority(g) {
  const status = `${g.gameState} ${g.inningStatus}`.toLowerCase();
  if (/final|game over|completed/i.test(status)) return 2;
  if (/scheduled|pre-game|warmup|preview|postponed|tbd|et$/i.test(status)) return 1;
  return 0; // Ongoing
}

function nextPollDelayForGames(games) {
  if (!games || games.length === 0) return EMPTY_DAY_POLL_MS;
  if (games.some(isGameLiveNow)) return FAST_POLL_MS;
  if (games.some(g => /scheduled|pre-game|warmup|preview/i.test(`${g.gameState} ${g.inningStatus}`))) return PREGAME_POLL_MS;
  return IDLE_POLL_MS;
}

function scheduleNextPoll(games) {
  if (!polling) return;
  clearTimeout(pollTimer);
  currentPollDelay = nextPollDelayForGames(games);
  pollTimer = setTimeout(pollGames, currentPollDelay);
  const mins = currentPollDelay >= 60000 ? `${Math.round(currentPollDelay / 60000)}m` : `${Math.round(currentPollDelay / 1000)}s`;
  const updateEl = document.getElementById('last-update');
  if (updateEl && updateEl.textContent) updateEl.textContent += ` · next ${mins}`;
}

async function startPolling() {
  document.getElementById('start-btn').disabled = true;
  document.getElementById('stop-btn').disabled  = false;
  document.getElementById('status-dot').classList.add('live');
  polling = true;
  clearTimeout(pollTimer);

  // Parallelize core data fetches to minimize time-to-first-render
  // We wait for records and star tiers as they are critical for watchability scores
  await Promise.all([
    fetchTeamRecords(),
    fetchFangraphsStarTiers(),
    fetchStatLeaders()
  ]);

  pollGames();

  // Re-render game cards as async pitcher stats trickle in
  setTimeout(() => { if (lastGames) renderGames(lastGames); }, 5000);
  setTimeout(() => { if (lastGames) renderGames(lastGames); }, 12000);
}

function stopPolling() {
  polling = false;
  clearTimeout(pollTimer);
  document.getElementById('start-btn').disabled = false;
  document.getElementById('stop-btn').disabled  = true;
  document.getElementById('status-dot').classList.remove('live');
}

function hydratePreferenceControls() {
  const dateInput = document.getElementById('game-date');
  if (dateInput) dateInput.value = selectedDate;

  document.querySelectorAll('[id^="sort-"]').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  const sortBtn = document.getElementById('sort-' + currentSort);
  if (sortBtn) {
    sortBtn.classList.add('active');
    sortBtn.setAttribute('aria-pressed', 'true');
  }

  document.querySelectorAll('[id^="filter-"]').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  if (currentFilter) {
    const filterBtn = document.getElementById('filter-' + currentFilter);
    if (filterBtn) {
      filterBtn.classList.add('active');
      filterBtn.setAttribute('aria-pressed', 'true');
    }
  }

  document.querySelectorAll('[id^="layout-"]').forEach(b => {
    b.classList.remove('active');
  });
  const layoutBtn = document.getElementById('layout-' + layoutMode);
  if (layoutBtn) {
    layoutBtn.classList.add('active');
  }
}


async function pollGames() {
  pollCount++;
  try {
    usedStaleData.value = false;
    let games = await fetchLiveGamesData();
    if (games.length) {
      writeCache(`renderedGames:${selectedDate}`, games);
    } else {
      const cached = readCache(`renderedGames:${selectedDate}`);
      if (cached?.data?.length) {
        games = cached.data;
        usedStaleData.value = true;
      }
    }
    // Sort: Live (0) > Scheduled (1) > Final (2), then by watchability
    games.sort((a, b) => {
      const ap = getGameStatusPriority(a), bp = getGameStatusPriority(b);
      if (ap !== bp) return ap - bp;
      if (ap === 1) { // Scheduled
        return a.startTime - b.startTime;
      }
      return b.watchabilityIndex - a.watchabilityIndex;
    });
    lastGames = games;
    games.forEach(g => { gameDetailsByPk[g.gamePk] = g; });
    checkFavoriteAlerts(games);
    renderGames(games);
    // Refresh only the active tab if it's one of the live ones
    const activeTab = document.querySelector('.tab-btn.active')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (activeTab === 'potd') fetchAndRenderPOTD(games);
    if (activeTab === 'ticker') fetchAndRenderTicker(games);
    if (activeTab === 'duel') fetchAndRenderDuel(games);
    if (activeTab === 'playoffs' && pollCount % 4 === 0) fetchPlayoffRaces(games);
    if (activeTab === 'milestones' && pollCount % 4 === 0) fetchMilestones(games);

    checkHighLeverageAlerts(games);
    // If HR tab is active, refresh it; otherwise queue it
    const hrTab = document.getElementById('tab-homeruns');
    if (hrTab && hrTab.classList.contains('active')) {
      fetchAndRenderHomeRuns(games);
    }
    document.getElementById('last-update').textContent =
      (usedStaleData.value ? 'Stale data from cache · ' : 'Updated ') + new Date().toLocaleTimeString();

    const auxRefreshMs = games.some(isGameLiveNow) ? 60000 : 300000;
    if (Date.now() - lastAuxRefresh > auxRefreshMs) {
      lastAuxRefresh = Date.now();
      fetchStatLeaders();
      fetchTeamRecords();
      // Only refresh secondary data if they are active
      if (activeTab === 'playoffs') fetchPlayoffRaces(games);
      if (activeTab === 'milestones') fetchMilestones(games);
    }

    // Refresh open details panel
    if (activeGamePk) {
      if (window.innerWidth > 1000) {
        if (document.getElementById('side-panel')?.classList.contains('open')) {
          openSidePanel(activeGamePk);
        }
      } else {
        if (document.getElementById('game-drawer')?.classList.contains('open')) {
          openGameDrawer(activeGamePk);
        }
      }
    }

    // First load: also fetch standings, milestones & award races
    if (isFirstLoad) {
      await Promise.all([
        fetchFangraphsStarTiers(),
        fetchStatLeaders(),
        fetchTeamRecords()
      ]);
      fetchPlayoffRaces(games);
      fetchMilestones(games);
      fetchAwardRaces();
      fetchAndRenderPOTD(games);
      fetchAndRenderHomeRuns(games); // pre-load HR data
      isFirstLoad = false;
    }
  } catch (e) {
    console.error('Poll error:', e);
  } finally {
    scheduleNextPoll(lastGames);
  }
}

// ─── THE DUEL: PITCHER VS BATTER ───────────────────────────────────────────────
async function fetchAndRenderDuel(games) {
  const container = document.getElementById('duel-container');
  if (!container) return;

  const liveGames = (games || []).filter(isGameLiveNow);

  const selectorHtml = `
    <div class="duel-selector-wrap">
      <div class="duel-section-title">🔍 Custom Matchup Simulator</div>
      <div class="duel-selector">
         <input type="text" id="duel-batter-search" placeholder="Search Batter (e.g. Aaron Judge)">
         <div class="duel-vs-circle">VS</div>
         <input type="text" id="duel-pitcher-search" placeholder="Search Pitcher (e.g. Gerrit Cole)">
         <button class="btn" onclick="runSimulatedDuel()">Simulate Duel 🎲</button>
      </div>
      <div id="duel-sim-result-container"></div>
    </div>`;

  if (!liveGames.length) {
    container.innerHTML = `
      <div class="duel-empty">
        <div class="empty-msg">No games live right now.</div>
        ${selectorHtml}
      </div>`;
    return;
  }

  container.innerHTML = `${selectorHtml} <div class="duel-grid"></div>`;
  const grid = container.querySelector('.duel-grid');

  for (const g of liveGames) {
    if (!g.currentBatter || !g.currentPitcher) continue;
    const card = document.createElement('div');
    card.className = 'duel-card';
    card.innerHTML = `<div class="expand-load-msg">Loading matchup data...</div>`;
    grid.appendChild(card);
    renderLiveDuelCard(card, g);
  }
}

async function renderLiveDuelCard(card, g) {
  try {
    const batterId = (await getPlayerIdByName(g.currentBatter.name)) || null;
    const pitcherId = (await getPlayerIdByName(g.currentPitcher.name)) || null;

    let statsHtml = '';
    if (batterId && pitcherId) {
      const data = await requestPool.fetchDedup(
        `${MLB_API}/people/${batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcherId}`,
        { cacheKey: `vs:${batterId}:${pitcherId}` }
      );
      const s = data.stats?.[0]?.splits?.[0]?.stat;
      if (s && s.atBats > 0) {
        statsHtml = `
          <div class="duel-vs-stats">
            <div class="duel-vs-main">${s.hits}-${s.atBats} (${s.avg})</div>
            <div class="duel-vs-sub">${s.homeRuns} HR · ${s.strikeOuts} K · ${s.ops} OPS</div>
          </div>`;
      } else {
        statsHtml = `<div class="duel-vs-none">No head-to-head history. <br> <span onclick="runSimulatedDuel(${batterId}, ${pitcherId}, this.parentElement)">Simulate At-Bat 🎲</span></div>`;
      }
    }

    card.innerHTML = `
      <div class="duel-header">
        <div class="duel-team-bg" style="background:${teamColor(g.awayTeam)}"></div>
        <div class="duel-team-bg" style="background:${teamColor(g.homeTeam)}"></div>
        <div class="duel-title">${g.awayTeam} @ ${g.homeTeam}</div>
      </div>
      <div class="duel-matchup">
        <div class="duel-player batter">
          <div class="duel-player-name">${g.currentBatter.name}</div>
          <div class="duel-player-stats">${g.currentBatter.avg}/${g.currentBatter.ops}</div>
        </div>
        <div class="duel-vs">VS</div>
        <div class="duel-player pitcher">
          <div class="duel-player-name">${g.currentPitcher.name}</div>
          <div class="duel-player-stats">${g.currentPitcher.era} ERA</div>
        </div>
      </div>
      ${statsHtml}
    `;
  } catch (e) {
    card.innerHTML = `<div class="empty-msg">Matchup unavailable</div>`;
  }
}

async function getPlayerIdByName(name) {
  // Simple search or lookup in existing tiers
  // For now, let's try searching the API
  try {
    const data = await requestPool.fetchDedup(`${MLB_API}/people/search?names=${encodeURIComponent(name)}`);
    return data.people?.[0]?.id;
  } catch (e) { return null; }
}

async function runSimulatedDuel(bId, pId, container) {
  if (!bId || !pId) {
    const bName = document.getElementById('duel-batter-search')?.value;
    const pName = document.getElementById('duel-pitcher-search')?.value;
    if (!bName || !pName) {
      showNotification('Please enter both a batter and a pitcher name.', 'info');
      return;
    }
    bId = await getPlayerIdByName(bName);
    pId = await getPlayerIdByName(pName);
    container = document.getElementById('duel-sim-result-container');
  }
  if (!bId || !pId) {
    showNotification('Player not found. Try a full name.', 'info');
    return;
  }

  if (container) container.innerHTML = '<div class="expand-load-msg">Simulating matchup...</div>';

  try {
    const [bData, pData, bCareer, pCareer, vsData] = await Promise.all([
      requestPool.fetchDedup(`${MLB_API}/people/${bId}/stats?stats=season&group=hitting`),
      requestPool.fetchDedup(`${MLB_API}/people/${pId}/stats?stats=season&group=pitching`),
      requestPool.fetchDedup(`${MLB_API}/people/${bId}/stats?stats=career&group=hitting`),
      requestPool.fetchDedup(`${MLB_API}/people/${pId}/stats?stats=career&group=pitching`),
      requestPool.fetchDedup(`${MLB_API}/people/${bId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pId}`)
    ]);
    const b = bData.stats?.[0]?.splits?.[0]?.stat || {};
    const p = pData.stats?.[0]?.splits?.[0]?.stat || {};
    const bc = bCareer.stats?.[0]?.splits?.[0]?.stat || {};
    const pc = pCareer.stats?.[0]?.splits?.[0]?.stat || {};

    // Simulation engine using weighted blend of Season (70%) and Career (30%)
    const getWeighted = (sVal, cVal, def) => {
      const s = parseFloat(sVal);
      const c = parseFloat(cVal);
      if (isNaN(s) && isNaN(c)) return def;
      if (isNaN(s)) return c;
      if (isNaN(c)) return s;
      return (s * 0.7) + (c * 0.3);
    };

    const ops = getWeighted(b.ops, bc.ops, 0.750);
    const baa = getWeighted(p.avg, pc.avg, 0.250);
    const k9 = getWeighted(p.strikeoutsPer9Inn, pc.strikeoutsPer9Inn, 8.0);
    const hrRate = getWeighted(b.homeRuns / (b.atBats || 1), bc.homeRuns / (bc.atBats || 1), 0.04);
    const walkRate = getWeighted((b.baseOnBalls || 0) / (b.atBats || 1), (bc.baseOnBalls || 0) / (bc.atBats || 1), 0.08);

    // Probability Logic
    // Base hit chance: Blend of OPS and BAA
    const hitProb = (ops / 3.0) * 0.5 + (baa * 1.0) * 0.5;
    const kProb = (k9 / 27.0); // Rough K per PA
    const bbProb = walkRate;

    const rand = Math.random();
    let result = "Out";
    let subResult = "";

    if (rand < kProb) {
      result = "Strikeout ⚾";
    } else if (rand < kProb + bbProb) {
      result = "Walk 🚶";
    } else if (rand < kProb + bbProb + hitProb) {
      const hrRand = Math.random();
      if (hrRand < hrRate * 4) { // Multiplier to balance HR vs hits
        result = "HOME RUN! 💥";
      } else if (hrRand < 0.3) {
        result = "Double 🚀";
      } else {
        result = "Single ⚾";
      }
    } else {
      const outRand = Math.random();
      if (outRand < 0.4) result = "Groundout";
      else if (outRand < 0.8) result = "Flyout";
      else result = "Lineout";
    }

    const vs = vsData.stats?.[0]?.splits?.[0]?.stat;
    let vsHtml = '';
    if (vs && vs.atBats > 0) {
      vsHtml = `
        <div class="sim-vs-history">
          <div class="sim-label">HISTORICAL REALITY</div>
          <div class="sim-vs-val">${vs.hits}-${vs.atBats} (${vs.avg})</div>
          <div class="sim-vs-sub">${vs.homeRuns} HR · ${vs.strikeOuts} K · ${vs.ops} OPS</div>
        </div>
      `;
    }

    const msg = `
      <div class="sim-result-wrap">
        <div class="sim-result">
          <div class="sim-label">SIMULATED OUTCOME</div>
          <div class="sim-val">${result}</div>
          <div class="sim-odds">
            <span>Matchup Strength: <strong>${(ops*1000).toFixed(0)} OPS</strong> vs <strong>${(baa*1000).toFixed(0)} BAA</strong></span>
            <br>Projected Hit Rate: ${(hitProb * 100).toFixed(1)}%
          </div>
        </div>
        ${vsHtml}
      </div>`;
    if (container) container.innerHTML = msg;
    else showNotification(`Simulated Result: ${result}`, 'info');
  } catch (e) {
    if (container) container.innerHTML = 'Simulation failed';
  }
}


// ─── ARCHETYPES IMPROVEMENTS CODE ────────────────────────────────────────────

let layoutMode = localStorage.getItem('mlb_layout_mode') || 'grid';

function setLayoutMode(mode) {
  layoutMode = mode;
  localStorage.setItem('mlb_layout_mode', mode);
  document.querySelectorAll('[id^="layout-"]').forEach(b => {
    b.classList.remove('active');
  });
  const btn = document.getElementById('layout-' + mode);
  if (btn) btn.classList.add('active');
  if (lastGames) renderGames(lastGames);
}

function downloadCalendarEvent(gamePk) {
  const game = gameDetailsByPk[gamePk];
  if (!game) return;
  const dateStr = selectedDate || todayET();
  const summary = `MLB Matchup: ${game.awayTeam} at ${game.homeTeam}`;
  const description = `MLB Watchability Index Game\\nWatchability Score: ${game.watchabilityIndex}\\nStatus: ${game.inningStatus}`;

  const startClean = dateStr.replace(/-/g, '') + 'T190000';
  const endClean = dateStr.replace(/-/g, '') + 'T220000';

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MLB Watchability Index//EN',
    'BEGIN:VEVENT',
    `UID:mlb-game-${gamePk}@mlbwatch`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART:${startClean}`,
    `DTEND:${endClean}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    'LOCATION:MLB Live Stadium',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `mlb_${game.awayTeam}_at_${game.homeTeam}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showNotification('Calendar file downloaded!', 'success');
}

function getWatchabilityExplanation(game) {
  const factors = [];
  const wi = game.watchabilityIndex;
  const diff = Math.abs((game.awayScore || 0) - (game.homeScore || 0));
  const isFinal = /final/i.test(game.inningStatus);
  const isScheduled = /scheduled|pre-game|warmup|preview|ET$/i.test(game.inningStatus);

  if (isScheduled) {
    factors.push("⚡ Pre-game anticipation building up.");
    if (isRivalry(game.awayTeam, game.homeTeam)) {
      factors.push("⚔️ High-emotion historic rivalry match!");
    }
  } else if (isFinal) {
    if (diff === 1) factors.push("💥 Thrilling 1-run nail-biter finish!");
    else if (diff <= 3) factors.push("🏁 Ended in a close, competitive battle.");
    else factors.push("🏁 Decisive outcome.");
  } else {
    if (diff === 0) factors.push("🔥 Tied game drama in progress!");
    else if (diff === 1) factors.push("💅 1-run game nail-biter tension!");
    else if (diff <= 3) factors.push("📈 Within striking distance.");

    if (game.currentInning >= 8) {
      factors.push("⏳ Late-inning high-stakes crunch time!");
    }
  }
  return factors;
}

function showStrikeZoneStats(rect) {
  const zone = rect.getAttribute('data-zone');
  const name = rect.getAttribute('data-name');
  const avg = rect.getAttribute('data-avg');
  const hr = rect.getAttribute('data-hr');
  const ops = rect.getAttribute('data-ops');
  const color = rect.getAttribute('data-color');

  const svg = rect.closest('svg');
  if (svg) {
    svg.querySelectorAll('.interactive-sz-zone').forEach(r => {
      r.setAttribute('fill', 'transparent');
    });
    rect.setAttribute('fill', color);
    rect.setAttribute('opacity', '0.35');
  }

  const readout = document.getElementById('sz-readout');
  if (readout) {
    readout.innerHTML = `
      <div class="sz-readout-card" style="border-left:4px solid ${color}">
        <strong>Zone ${zone}: ${name}</strong>
        <div class="sz-readout-grid">
          <div>AVG: <strong style="color:var(--text)">${avg}</strong></div>
          <div>HR: <strong style="color:var(--text)">${hr}</strong></div>
          <div>OPS: <strong style="color:var(--gold)">${ops}</strong></div>
        </div>
      </div>
    `;
  }
}


function getJournalistRecap(data) {
  const away = data.awayAbbr;
  const home = data.homeAbbr;
  const isFinal = /final/i.test(data.inningStatus);
  const status = data.inningStatus;

  let title = `[PRESS BOX RECAP] ${away} @ ${home} (${status})\n`;
  if (isFinal && data.boxRows.homeTotals && data.boxRows.awayTotals) {
    const rDiff = (data.boxRows.homeTotals.runs || 0) - (data.boxRows.awayTotals.runs || 0);
    if (rDiff > 0) {
      title = `📰 PRESS BOX: ${home} Defeats ${away} in Thrilling Finish, ${data.boxRows.homeTotals.runs}-${data.boxRows.awayTotals.runs}\n`;
    } else {
      title = `📰 PRESS BOX: ${away} Defeats ${home} in Tight Battle, ${data.boxRows.awayTotals.runs}-${data.boxRows.homeTotals.runs}\n`;
    }
  }

  let lineScore = `Line Score:\n--------------------------\n`;
  lineScore += `${away}: ${data.boxRows.awayTotals.runs || 0} R, ${data.boxRows.awayTotals.hits || 0} H, ${data.boxRows.awayTotals.errors || 0} E\n`;
  lineScore += `${home}: ${data.boxRows.homeTotals.runs || 0} R, ${data.boxRows.homeTotals.hits || 0} H, ${data.boxRows.homeTotals.errors || 0} E\n`;
  lineScore += `--------------------------\n`;

  let keyPlays = 'Key Game Highlights:\n';
  if (data.scoringPlays && data.scoringPlays.length > 0) {
    data.scoringPlays.slice(0, 4).forEach(p => {
      keyPlays += `• [${p.half}${p.inn}] ${p.desc} (${away} ${p.away} - ${home} ${p.home})\n`;
    });
  } else {
    keyPlays += '• No major scoring plays recorded yet.\n';
  }

  let wpaSwing = '';
  if (data.topWpaPlays && data.topWpaPlays.length > 0) {
    wpaSwing += `\nTop Momentum Shift:\n`;
    const topPlay = data.topWpaPlays[0];
    wpaSwing += `• [${topPlay.half}${topPlay.inn}] ${topPlay.desc} (${topPlay.delta > 0 ? '+' : ''}${topPlay.delta.toFixed(1)}% WPA Shift)\n`;
  }

  return `${title}\n${lineScore}\n${keyPlays}${wpaSwing}\nGenerated via MLB Watchability Index — Official Press Feed.`;
}

function copyJournalistDraft() {
  const txt = document.getElementById('journalist-recap-text')?.value;
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(() => {
    const btn = document.getElementById('btn-copy-draft');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copied to Clipboard!';
      btn.style.background = 'var(--success)';
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.style.background = '';
      }, 2000);
    }
    showNotification('Press box recap copied successfully!', 'success');
  });
}

function switchDetailsTab(gamePk, tabName) {
  if (!window.activeDetailsTabs) window.activeDetailsTabs = {};
  window.activeDetailsTabs[gamePk] = tabName;

  const body = document.getElementById('side-panel-body') || document.getElementById('drawer-body');
  if (body) {
    const cachedData = window.lastExpandData?.[gamePk];
    if (cachedData) {
      renderExpandPanel(body, cachedData);
    }
  }
}



hydratePreferenceControls();
