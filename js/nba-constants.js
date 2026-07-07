const NBA_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const NBA_SUMMARY_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const NBA_STANDINGS_API = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const NBA_LEADERS_BASE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons';
const NBA_LEADERS_API = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2025/types/2/leaders';

const NBA_LEADER_DEFS = [
  { name: 'pointsPerGame', label: 'PPG' },
  { name: 'assistsPerGame', label: 'APG' },
  { name: 'reboundsPerGame', label: 'RPG' },
  { name: 'stealsPerGame', label: 'SPG' },
  { name: 'blocksPerGame', label: 'BPG' },
  { name: '3PointsMadePerGame', label: '3PM/G' },
  { name: 'doubleDouble', label: 'Double-Double' },
  { name: 'tripleDouble', label: 'Triple-Double' },
  { name: 'fieldGoalPercentage', label: 'FG%' },
  { name: '3PointPct', label: '3P%' },
  { name: 'avgTurnovers', label: 'TOV/G' }
];

const SEASON_PTS_MILESTONES = [500, 1000, 1500, 2000, 2500, 2800, 3000];
const SEASON_AST_MILESTONES = [200, 400, 600, 700, 800, 900, 1000, 1164];
const SEASON_REB_MILESTONES = [400, 600, 800, 1000, 1200, 1400, 1500];
const SEASON_3PM_MILESTONES = [100, 150, 200, 250, 300, 350, 400, 402];
const SEASON_STL_MILESTONES = [50, 100, 150, 180, 200, 225];
const SEASON_BLK_MILESTONES = [50, 100, 150, 200, 250, 300, 383];

const CAREER_PTS_MILESTONES = [20000, 25000, 30000, 35000, 40000, 40474, 44149];
const CAREER_AST_MILESTONES = [5000, 7500, 10000, 11000, 12000, 15806];
const CAREER_REB_MILESTONES = [5000, 7500, 10000, 12000, 15000, 16279, 23924];
const CAREER_3PM_MILESTONES = [1000, 1500, 2000, 2500, 3000, 3500, 4000];

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
  GS: { id: 10, color: '#1D428A', name: 'Warriors' },
  HOU: { id: 11, color: '#CE1141', name: 'Rockets' },
  IND: { id: 12, color: '#FDB927', name: 'Pacers' },
  LAC: { id: 13, color: '#C8102E', name: 'Clippers' },
  LAL: { id: 14, color: '#552583', name: 'Lakers' },
  MEM: { id: 15, color: '#5D76A9', name: 'Grizzlies' },
  MIA: { id: 16, color: '#98002E', name: 'Heat' },
  MIL: { id: 17, color: '#00471B', name: 'Bucks' },
  MIN: { id: 18, color: '#0C2340', name: 'Timberwolves' },
  NO: { id: 19, color: '#0C2340', name: 'Pelicans' },
  NY: { id: 20, color: '#006BB6', name: 'Knicks' },
  OKC: { id: 21, color: '#007AC1', name: 'Thunder' },
  ORL: { id: 22, color: '#0077C0', name: 'Magic' },
  PHI: { id: 23, color: '#006BB6', name: '76ers' },
  PHX: { id: 24, color: '#1D1160', name: 'Suns' },
  POR: { id: 25, color: '#E03A3E', name: 'Trail Blazers' },
  SA: { id: 27, color: '#C4CED4', name: 'Spurs' },
  SAC: { id: 26, color: '#5A2D81', name: 'Kings' },
  TOR: { id: 28, color: '#CE1141', name: 'Raptors' },
  UTAH: { id: 29, color: '#002B5C', name: 'Jazz' },
  WSH: { id: 30, color: '#002B5C', name: 'Wizards' }
};
const NBA_RIVALRY_PAIRS = [['LAL','BOS'], ['LAL','LAC'], ['GS','SAC'], ['NY','BKN'], ['PHI','BOS'], ['CHI','DET'], ['DAL','SA'], ['HOU','DAL'], ['MIA','NY'], ['MIL','CHI'], ['PHX','LAL'], ['OKC','GS']];

const NBA_MILESTONE_DEFS = [
  { api: 'points', label: 'Points', milestones: SEASON_PTS_MILESTONES, icon: '🏀', lookahead: 150 },
  { api: 'assists', label: 'Assists', milestones: SEASON_AST_MILESTONES, icon: '🪄', lookahead: 50 },
  { api: 'totalRebounds', label: 'Rebounds', milestones: SEASON_REB_MILESTONES, icon: '👐', lookahead: 100 },
  { api: 'threePointFieldGoalsMade', label: '3PM', milestones: SEASON_3PM_MILESTONES, icon: '🎯', lookahead: 40 },
  { api: 'steals', label: 'Steals', milestones: SEASON_STL_MILESTONES, icon: '🧤', lookahead: 15 },
  { api: 'blocks', label: 'Blocks', milestones: SEASON_BLK_MILESTONES, icon: '🚫', lookahead: 15 }
];

const NBA_MILESTONE_META = {
  'Points': { scope: 'season', major: [1500, 2000], historic: [2500, 3000] },
  'Assists': { scope: 'season', major: [600, 800], historic: [1000] },
  'Rebounds': { scope: 'season', major: [800, 1000], historic: [1200, 1500] },
  '3PM': { scope: 'season', major: [250, 300], historic: [350, 400] },
  'Steals': { scope: 'season', major: [150, 180], historic: [200] },
  'Blocks': { scope: 'season', major: [150, 200], historic: [300] }
};
