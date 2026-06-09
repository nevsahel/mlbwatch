const NBA_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const NBA_WATCHABILITY_CONFIG = {
  caps: { teamQuality: 10, playoff: 15, context: 35, liveSituation: 55, finalSituation: 30 },
  context: { rivalry: 8, upset: 10 },
  bases: { preview: 25, live: 35, final: 25 },
  scaling: { previewContext: 1.0, liveContext: 0.7, finalContext: 0.6 },
  live: {
    diff: { tied: 25, oneToThree: 20, fourToSix: 12, sevenToTen: 5, elevenPlus: -5 },
    period: { fourth: 15, overtime: 25, lateFourth: 15 }
  },
  final: {
    diff: { tied: 25, oneToThree: 15, fourToSix: 5 },
    overtime: 10
  }
};
const NBA_TEAM_DATA = {
  ATL: { id: 1, color: '#E03A3E', name: 'Hawks' },
  BOS: { id: 2, color: '#007A33', name: 'Celtics' },
  BKN: { id: 3, color: '#000000', name: 'Nets' },
  CHA: { id: 4, color: '#1D1160', name: 'Hornets' },
  CHI: { id: 5, color: '#CE1141', name: 'Bulls' },
  CLE: { id: 6, color: '#860038', name: 'Cavaliers' },
  DAL: { id: 7, color: '#00538C', name: 'Mavericks' },
  DEN: { id: 8, color: '#0E2240', name: 'Nuggets' },
  DET: { id: 9, color: '#C8102E', name: 'Pistons' },
  GSW: { id: 10, color: '#1D428A', name: 'Warriors' },
  HOU: { id: 11, color: '#CE1141', name: 'Rockets' },
  IND: { id: 12, color: '#FDB927', name: 'Pacers' },
  LAC: { id: 13, color: '#C8102E', name: 'Clippers' },
  LAL: { id: 14, color: '#552583', name: 'Lakers' },
  MEM: { id: 15, color: '#5D76A9', name: 'Grizzlies' },
  MIA: { id: 16, color: '#98002E', name: 'Heat' },
  MIL: { id: 17, color: '#00471B', name: 'Bucks' },
  MIN: { id: 18, color: '#0C2340', name: 'Timberwolves' },
  NOP: { id: 19, color: '#0C2340', name: 'Pelicans' },
  NYK: { id: 20, color: '#006BB6', name: 'Knicks' },
  OKC: { id: 21, color: '#007AC1', name: 'Thunder' },
  ORL: { id: 22, color: '#0077C0', name: 'Magic' },
  PHI: { id: 23, color: '#006BB6', name: '76ers' },
  PHX: { id: 24, color: '#1D1160', name: 'Suns' },
  POR: { id: 25, color: '#E03A3E', name: 'Trail Blazers' },
  SAC: { id: 26, color: '#5A2D81', name: 'Kings' },
  SAS: { id: 27, color: '#C4CED4', name: 'Spurs' },
  TOR: { id: 28, color: '#CE1141', name: 'Raptors' },
  UTA: { id: 29, color: '#002B5C', name: 'Jazz' },
  WAS: { id: 30, color: '#002B5C', name: 'Wizards' }
};
const NBA_RIVALRY_PAIRS = [['LAL','BOS'], ['LAL','LAC'], ['GSW','SAC'], ['NYK','BKN'], ['PHI','BOS'], ['CHI','DET'], ['DAL','SAS'], ['HOU','DAL'], ['MIA','NYK'], ['MIL','CHI'], ['PHX','LAL'], ['OKC','GSW']];
