/**
 * Awards & All-Star Simulation Web Worker
 * Handles heavy statistical modeling and voter simulation to keep the UI thread smooth.
 */

self.onmessage = function(e) {
  const { task, data } = e.data;

  if (task === 'simulateAwards') {
    const {
      alH, nlH, alP, nlP,
      alRookHitters, nlRookHitters, alRookPitchers, nlRookPitchers,
      qualifiedIP
    } = data;

    const mvpAL = rankAward(mergeForMVP(alH, alP), mvpScore);
    const mvpNL = rankAward(mergeForMVP(nlH, nlP), mvpScore);
    const cyAL = rankCY(alP, qualifiedIP);
    const cyNL = rankCY(nlP, qualifiedIP);
    const rotyAL = rankAward(mergeForMVP(alRookHitters, alRookPitchers), mvpScore);
    const rotyNL = rankAward(mergeForMVP(nlRookHitters, nlRookPitchers), mvpScore);

    self.postMessage({
      task: 'awardsResult',
      result: { mvpAL, mvpNL, cyAL, cyNL, rotyAL, rotyNL }
    });
  }

  if (task === 'buildAllStar') {
    const { alHitMeta, alPitMeta, nlHitMeta, nlPitMeta, qualifiedIP } = data;
    const AL = buildAllStarRoster(alHitMeta, alPitMeta, 'AL', qualifiedIP);
    const NL = buildAllStarRoster(nlHitMeta, nlPitMeta, 'NL', qualifiedIP);
    self.postMessage({ task: 'allStarResult', result: { AL, NL } });
  }
};

// ── Award Scoring Logic ──

const scoreMVPHitter = (p) => {
  const s = p.stats;
  const ops = parseFloat(s.onBasePlusSlugging) || 0;
  const hr = parseInt(s.homeRuns) || 0;
  const rbi = parseInt(s.runsBattedIn) || 0;
  const r = parseInt(s.runs) || 0;
  const avg = parseFloat(s.battingAverage) || 0;
  const war = p.war ?? 0;
  return (war * 10.0) + (ops * 45.0) + (hr * 0.45) + (rbi * 0.12) + (r * 0.12) + (avg * 25.0);
};

const scoreMVPPitcher = (p) => {
  const s = p.stats;
  const w = parseInt(s.wins) || 0;
  const era = parseFloat(s.earnedRunAverage) || 4.5;
  const so = parseInt(s.strikeouts) || 0;
  const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
  const war = p.war ?? 0;
  return ((war * 9.0) + (w * 1.0) + ((3.5 - era) * 10.0) + (so * 0.06) + ((1.2 - whip) * 18.0)) * 0.82;
};

const mvpScore = (p) => p.isPitcher ? scoreMVPPitcher(p) : scoreMVPHitter(p);

const scoreCY = p => {
  const s = p.stats;
  const era = parseFloat(s.earnedRunAverage) || 4.5;
  const k = parseInt(s.strikeouts) || 0;
  const w = parseInt(s.wins) || 0;
  const ip = parseFloat(s.inningsPitched) || 0;
  const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
  const sho = parseInt(s.shutouts) || 0;
  const war = p.war ?? 0;
  return (w * 2.2) + ((3.2 - era) * 18) + (k * 0.16) + (ip * 0.1) + ((1.15 - whip) * 26) + (sho * 4) + (war * 2.5);
};

const mergeForMVP = (hitters, pitchers) => {
  const all = [...hitters, ...pitchers];
  const seen = new Set();
  return all.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
};

const VOTE_PTS = [14, 9, 7, 4, 2];
const CY_VOTE_PTS = [15, 10, 7, 4, 1];

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

const rankCY = (pitchers, qualifiedIP) => {
  const qualified = pitchers.filter(p => parseFloat(p.stats.inningsPitched||0) >= qualifiedIP);
  const pool = qualified.length >= 5 ? qualified : pitchers;
  const top10 = [...pool].sort((a, b) => scoreCY(b) - scoreCY(a)).slice(0, 10);
  if (!top10.length) return [];

  const votes = {};
  top10.forEach(p => { votes[p.id] = 0; });
  for (let v = 0; v < 5; v++) {
    [...top10].sort((a,b) => scoreCY(b) - scoreCY(a) + (Math.random()-0.5)*6)
      .slice(0,5).forEach((p,i) => { votes[p.id] = (votes[p.id]||0) + CY_VOTE_PTS[i]; });
  }

  return top10
    .map(p => ({ ...p, voteTotal: votes[p.id] || 0 }))
    .sort((a, b) => b.voteTotal - a.voteTotal)
    .slice(0, 5);
};

// ── All-Star Logic ──

const allStarHitterScore = p => {
  const s = p.stats || {};
  const ops = parseFloat(s.onBasePlusSlugging) || 0;
  const avg = parseFloat(s.battingAverage) || 0;
  const hr = parseInt(s.homeRuns) || 0;
  const rbi = parseInt(s.runsBattedIn) || 0;
  const r = parseInt(s.runs) || 0;
  const h = parseInt(s.hits) || 0;
  const war = p.war ?? 0;
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
  const isReliever = sv >= 4 || ip < 40; // Simplified reliever check for worker
  const dominance = ((3.5 - era) * 25) + ((1.2 - whip) * 35) + (k * 0.4);
  const roleBonus = isReliever ? (sv * 6.0) : (w * 4.0 + ip * 0.5);
  return (war * 45) + dominance + roleBonus;
};

const MLB_TEAMS_BY_LEAGUE = {
  AL: ['BAL','BOS','NYY','TB','TOR','CWS','CLE','DET','KC','MIN','HOU','LAA','OAK','SEA','TEX'],
  NL: ['ATL','MIA','NYM','PHI','WSH','CHC','CIN','MIL','PIT','STL','ARI','COL','LAD','SD','SF']
};

function buildAllStarRoster(hitters, pitchers, leagueCode, qualifiedIP) {
  function uniqueById(list) {
    const seen = new Set();
    return list.filter(p => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

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

  const roster = [];
  const addBest = (list, targetRoster, count, label, predicate = () => true) => {
    const added = [];
    for (const p of list) {
      if (added.length >= count) break;
      if (targetRoster.some(r => r.id === p.id)) continue;
      if (!predicate(p)) continue;
      const pick = { ...p, rosterLabel: label };
      targetRoster.push(pick);
      added.push(pick);
    }
  };

  ['C','1B','2B','3B','SS','DH'].forEach(pos => addBest(scoredHitters, roster, 1, `Starter ${pos}`, p => p.rosterPos === pos));
  addBest(scoredHitters, roster, 3, 'Starter OF', p => p.rosterPos === 'OF');
  ['C','1B','2B','3B','SS'].forEach(pos => addBest(scoredHitters, roster, 1, `Reserve ${pos}`, p => p.rosterPos === pos));
  addBest(scoredHitters, roster, 3, 'Reserve OF', p => p.rosterPos === 'OF');
  addBest(scoredHitters, roster, 21 - roster.filter(p => !p.isPitcher).length, 'Reserve bat');

  addBest(scoredPitchers, roster, 5, 'SP', p => p.pitcherRole === 'SP');
  addBest(scoredPitchers, roster, 4, 'RP', p => p.pitcherRole === 'RP');
  addBest(scoredPitchers, roster, 34 - roster.length, 'Pitcher');

  // Team representation
  const requiredTeams = MLB_TEAMS_BY_LEAGUE[leagueCode] || [];
  const represented = new Set(roster.map(p => p.team));
  const allCandidates = [...scoredHitters, ...scoredPitchers].sort((a, b) => b.allStarScore - a.allStarScore);

  for (const team of requiredTeams) {
    if (represented.has(team)) continue;
    const replacement = allCandidates.find(p => p.team === team && !roster.some(r => r.id === p.id));
    if (!replacement) continue;

    const removable = roster
      .filter(p => (replacement.isPitcher ? p.isPitcher : !p.isPitcher) && !requiredTeams.some(t => t === p.team && roster.filter(r => r.team === t).length === 1))
      .sort((a, b) => a.allStarScore - b.allStarScore)[0];

    if (removable) {
      const idx = roster.indexOf(removable);
      roster.splice(idx, 1, { ...replacement, rosterLabel: 'Team rep' });
      represented.add(team);
    }
  }

  const starters = roster.filter(p => !p.isPitcher && /^Starter/.test(p.rosterLabel));
  const selectedIds = new Set(roster.map(p => p.id));
  const snubs = allCandidates.filter(p => !selectedIds.has(p.id)).slice(0, 10);

  return {
    starters,
    reserves: roster.filter(p => !p.isPitcher && !/^Starter/.test(p.rosterLabel)).sort((a, b) => b.allStarScore - a.allStarScore),
    pitchers: roster.filter(p => p.isPitcher).sort((a, b) => {
      if (a.pitcherRole !== b.pitcherRole) return a.pitcherRole === 'SP' ? -1 : 1;
      return b.allStarScore - a.allStarScore;
    }),
    roster,
    snubs,
    representedCount: represented.size
  };
}
