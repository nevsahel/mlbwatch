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

const SEASON_GP_MILESTONES = [50, 60, 70, 82];
const SEASON_GS_MILESTONES = [50, 60, 70, 82];
const SEASON_PTS_MILESTONES = [500, 1000, 1500, 2000, 2500, 3000, 4029];
const SEASON_REB_MILESTONES = [250, 500, 750, 1000, 1250, 2149];
const SEASON_AST_MILESTONES = [250, 500, 750, 1000, 1164];
const SEASON_STL_MILESTONES = [100, 150, 200, 250, 301];
const SEASON_BLK_MILESTONES = [100, 150, 200, 250, 300, 456];
const SEASON_FGM_MILESTONES = [250, 500, 750, 1000, 1597];
const SEASON_FGA_MILESTONES = [500, 1000, 1500, 2000, 3159];
const SEASON_3PM_MILESTONES = [100, 200, 300, 400, 402, 500];
const SEASON_3PA_MILESTONES = [250, 500, 750, 1000, 1024];
const SEASON_FTM_MILESTONES = [250, 500, 750, 840];
const SEASON_FTA_MILESTONES = [250, 500, 750, 1000, 1363];
const SEASON_OREB_MILESTONES = [100, 200, 300, 400, 587];
const SEASON_DREB_MILESTONES = [250, 500, 750, 1000, 1111];
const SEASON_DD_MILESTONES = [10, 25, 50, 75, 81];
const SEASON_TD_MILESTONES = [10, 20, 30, 40, 42];

const CAREER_GP_MS = [250, 500, 750, 1000, 1250, 1500, 1611];
const CAREER_GS_MS = [250, 500, 750, 1000, 1250, 1560];
const CAREER_PTS_MS = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 42184];
const CAREER_REB_MS = [2500, 5000, 7500, 10000, 12500, 15000, 23924];
const CAREER_AST_MS = [2500, 5000, 7500, 10000, 12500, 15000, 15806];
const CAREER_STL_MS = [500, 1000, 1500, 2000, 2500, 3000, 3265];
const CAREER_BLK_MS = [500, 1000, 1500, 2000, 2500, 3000, 3830];
const CAREER_FGM_MS = [2500, 5000, 7500, 10000, 12500, 15000, 15837];
const CAREER_FGA_MS = [5000, 10000, 15000, 20000, 25000, 30000, 31307];
const CAREER_3PM_MS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4058];
const CAREER_3PA_MS = [1000, 2500, 5000, 7500, 9589];
const CAREER_FTM_MS = [1000, 2500, 5000, 7500, 10000, 10311];
const CAREER_FTA_MS = [2500, 5000, 7500, 10000, 12500, 13188];
const CAREER_OREB_MS = [500, 1000, 2000, 3000, 4000, 6731];
const CAREER_DREB_MS = [2500, 5000, 7500, 10000, 12500, 14968];
const CAREER_DD_MS = [100, 250, 500, 750, 968];
const CAREER_TD_MS = [25, 50, 75, 100, 150, 200, 203];

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
  { api: 'gamesPlayed', label: 'GP', milestones: SEASON_GP_MILESTONES, icon: '📅' },
  { api: 'gamesStarted', label: 'GS', milestones: SEASON_GS_MILESTONES, icon: '🏁' },
  { api: 'points', label: 'PTS', milestones: SEASON_PTS_MILESTONES, icon: '🏀' },
  { api: 'totalRebounds', label: 'REB', milestones: SEASON_REB_MILESTONES, icon: '👐' },
  { api: 'assists', label: 'AST', milestones: SEASON_AST_MILESTONES, icon: '🪄' },
  { api: 'steals', label: 'STL', milestones: SEASON_STL_MILESTONES, icon: '🧤' },
  { api: 'blocks', label: 'BLK', milestones: SEASON_BLK_MILESTONES, icon: '🚫' },
  { api: 'fieldGoalsMade', label: 'FGM', milestones: SEASON_FGM_MILESTONES, icon: '🏹' },
  { api: 'fieldGoalsAttempted', label: 'FGA', milestones: SEASON_FGA_MILESTONES, icon: '🏀' },
  { api: 'threePointFieldGoalsMade', label: '3PM', milestones: SEASON_3PM_MILESTONES, icon: '🎯' },
  { api: 'threePointFieldGoalsAttempted', label: '3PA', milestones: SEASON_3PA_MILESTONES, icon: '☄️' },
  { api: 'freeThrowsMade', label: 'FTM', milestones: SEASON_FTM_MILESTONES, icon: '🎯' },
  { api: 'freeThrowsAttempted', label: 'FTA', milestones: SEASON_FTA_MILESTONES, icon: '🏀' },
  { api: 'offensiveRebounds', label: 'OREB', milestones: SEASON_OREB_MILESTONES, icon: '💪' },
  { api: 'defensiveRebounds', label: 'DREB', milestones: SEASON_DREB_MILESTONES, icon: '🛡️' },
  { api: 'doubleDouble', label: 'Double-Doubles', milestones: SEASON_DD_MILESTONES, icon: '👥' },
  { api: 'tripleDouble', label: 'Triple-Doubles', milestones: SEASON_TD_MILESTONES, icon: '🎩' }
];

const NBA_MILESTONE_META = {
  'GP': { scope: 'season', major: SEASON_GP_MILESTONES },
  'GS': { scope: 'season', major: SEASON_GS_MILESTONES },
  'PTS': { scope: 'season', major: SEASON_PTS_MILESTONES },
  'REB': { scope: 'season', major: SEASON_REB_MILESTONES },
  'AST': { scope: 'season', major: SEASON_AST_MILESTONES },
  'STL': { scope: 'season', major: SEASON_STL_MILESTONES },
  'BLK': { scope: 'season', major: SEASON_BLK_MILESTONES },
  'FGM': { scope: 'season', major: SEASON_FGM_MILESTONES },
  'FGA': { scope: 'season', major: SEASON_FGA_MILESTONES },
  '3PM': { scope: 'season', major: SEASON_3PM_MILESTONES },
  '3PA': { scope: 'season', major: SEASON_3PA_MILESTONES },
  'FTM': { scope: 'season', major: SEASON_FTM_MILESTONES },
  'FTA': { scope: 'season', major: SEASON_FTA_MILESTONES },
  'OREB': { scope: 'season', major: SEASON_OREB_MILESTONES },
  'DREB': { scope: 'season', major: SEASON_DREB_MILESTONES },
  'Double-Doubles': { scope: 'season', major: SEASON_DD_MILESTONES },
  'Triple-Doubles': { scope: 'season', major: SEASON_TD_MILESTONES },

  'Career GP': { scope: 'career', major: CAREER_GP_MS },
  'Career GS': { scope: 'career', major: CAREER_GS_MS },
  'Career PTS': { scope: 'career', major: CAREER_PTS_MS },
  'Career REB': { scope: 'career', major: CAREER_REB_MS },
  'Career AST': { scope: 'career', major: CAREER_AST_MS },
  'Career STL': { scope: 'career', major: CAREER_STL_MS },
  'Career BLK': { scope: 'career', major: CAREER_BLK_MS },
  'Career FGM': { scope: 'career', major: CAREER_FGM_MS },
  'Career FGA': { scope: 'career', major: CAREER_FGA_MS },
  'Career 3PM': { scope: 'career', major: CAREER_3PM_MS },
  'Career 3PA': { scope: 'career', major: CAREER_3PA_MS },
  'Career FTM': { scope: 'career', major: CAREER_FTM_MS },
  'Career FTA': { scope: 'career', major: CAREER_FTA_MS },
  'Career OREB': { scope: 'career', major: CAREER_OREB_MS },
  'Career DREB': { scope: 'career', major: CAREER_DREB_MS },
  'Career Double-Doubles': { scope: 'career', major: CAREER_DD_MS },
  'Career Triple-Doubles': { scope: 'career', major: CAREER_TD_MS }
};

const NBA_CAREER_MILESTONE_DEFS = [
  { api: 'gamesPlayed', label: 'GP', milestones: CAREER_GP_MS, icon: '📅', lookahead: 100 },
  { api: 'gamesStarted', label: 'GS', milestones: CAREER_GS_MS, icon: '🏁', lookahead: 100 },
  { api: 'points', label: 'PTS', milestones: CAREER_PTS_MS, icon: '🏀', lookahead: 1000 },
  { api: 'totalRebounds', label: 'REB', milestones: CAREER_REB_MS, icon: '👐', lookahead: 500 },
  { api: 'assists', label: 'AST', milestones: CAREER_AST_MS, icon: '🪄', lookahead: 500 },
  { api: 'steals', label: 'STL', milestones: CAREER_STL_MS, icon: '🧤', lookahead: 200 },
  { api: 'blocks', label: 'BLK', milestones: CAREER_BLK_MS, icon: '🚫', lookahead: 200 },
  { api: 'fieldGoalsMade', label: 'FGM', milestones: CAREER_FGM_MS, icon: '🏹', lookahead: 500 },
  { api: 'threePointFieldGoalsMade', label: '3PM', milestones: CAREER_3PM_MS, icon: '🎯', lookahead: 200 },
  { api: 'freeThrowsMade', label: 'FTM', milestones: CAREER_FTM_MS, icon: '🎯', lookahead: 500 },
  { api: 'doubleDouble', label: 'Double-Doubles', milestones: CAREER_DD_MS, icon: '👥', lookahead: 50 },
  { api: 'tripleDouble', label: 'Triple-Doubles', milestones: CAREER_TD_MS, icon: '🎩', lookahead: 20 }
];
