export const MLB_API = 'https://statsapi.mlb.com/api/v1';
export const WATCHABILITY_CONFIG = {
  caps: { starPower: 15, teamQuality: 8, playoff: 15, context: 30, liveSituation: 50, finalSituation: 28 },
  context: { milestone: 5, rivalry: 5 },
  bases: { preview: 20, live: 30, final: 22 },
  scaling: { previewContext: 1.1, liveContext: 0.65, finalContext: 0.55 },
  live: {
    diff: { tied: 20, oneRun: 15, twoRun: 9, threeRun: 4, fivePlus: -4, sevenPlus: -8 },
    inning: { extras11: 18, ninth: 15, eighth: 11, seventh: 7, fifthSixth: 3 },
    runners: { each: 3, cap: 7, twoOutPressure: 3 },
    noHitter: 10
  },
  final: {
    diff: { tied: 20, oneRun: 14, twoRun: 8, threeRun: 3 },
    extras: 8
  }
};
export const TEAM_DATA = {
  ARI: { id: 109, color: '#A71930' }, ATL: { id: 144, color: '#CE1141' }, BAL: { id: 110, color: '#DF4601' }, BOS: { id: 111, color: '#BD3039' }, CHC: { id: 112, color: '#0E3386' }, CWS: { id: 145, color: '#C4CED4' }, CIN: { id: 113, color: '#C6011F' }, CLE: { id: 114, color: '#E31937' }, COL: { id: 115, color: '#33006F' }, DET: { id: 116, color: '#FA4616' }, HOU: { id: 117, color: '#EB6E1F' }, KC:  { id: 118, color: '#004687' }, LAA: { id: 108, color: '#BA0021' }, LAD: { id: 119, color: '#005A9C' }, MIA: { id: 146, color: '#00A3E0' }, MIL: { id: 158, color: '#FFC52F' }, MIN: { id: 142, color: '#D31145' }, NYM: { id: 121, color: '#FF5910' }, NYY: { id: 147, color: '#003087' }, OAK: { id: 133, color: '#003831' }, ATH: { id: 133, color: '#003831' }, PHI: { id: 143, color: '#E81828' }, PIT: { id: 134, color: '#FDB827' }, SD:  { id: 135, color: '#FFC425' }, SF:  { id: 137, color: '#FD5A1E' }, SEA: { id: 136, color: '#005C5C' }, STL: { id: 138, color: '#C41E3A' }, TB:  { id: 139, color: '#8FBCE6' }, TEX: { id: 140, color: '#C0111F' }, TOR: { id: 141, color: '#134A8E' }, WSH: { id: 120, color: '#AB0003' }
};
export const RIVALRY_PAIRS = [['NYY','BOS'],['NYY','BAL'],['NYY','TB'],['NYY','TOR'],['NYY','HOU'],['BOS','BAL'],['BOS','TB'],['BOS','TOR'],['BAL','TB'],['BAL','WAS'],['TB','TOR'],['CLE','CWS'],['CLE','DET'],['CWS','DET'],['MIN','CWS'],['MIN','CLE'],['DET','MIN'],['HOU','TEX'],['LAA','SEA'],['LAA','OAK'],['SEA','OAK'],['NYM','PHI'],['NYM','ATL'],['PHI','ATL'],['NYM','MIA'],['PHI','MIA'],['ATL','MIA'],['PHI','PIT'],['CHC','STL'],['MIL','STL'],['PIT','STL'],['CIN','PIT'],['MIL','CHC'],['CIN','CHC'],['LAD','SF'],['LAD','SD'],['SF','SD'],['COL','ARI'],['LAD','COL'],['SF','COL'],['SD','ARI'],['LAD','ARI'],['CWS','CHC'],['NYY','NYM'],['MIA','TB'],['TOR','DET'],['TOR','SEA'],['TOR','BOS'],['TOR','NYY'],['DET','TOR'],['WAS','PHI'],['OAK','SF'],['LAA','LAD'],['ARI','TEX'],['COL','SEA']];
