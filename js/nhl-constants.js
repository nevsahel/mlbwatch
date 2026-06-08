const NHL_API = 'https://api-web.nhle.com/v1';

const NHL_WATCHABILITY_CONFIG = {
  caps: {
    teamQuality: 10,
    playoff: 15,
    context: 35,
    liveSituation: 55,
    finalSituation: 30
  },
  context: {
    rivalry: 8,
    upset: 10
  },
  bases: {
    preview: 25,
    live: 35,
    final: 25
  },
  scaling: {
    previewContext: 1.0,
    liveContext: 0.7,
    finalContext: 0.6
  },
  live: {
    diff: {
      tied: 25,
      oneGoal: 18,
      twoGoal: 8,
      threeGoal: 2,
      fourPlus: -5
    },
    period: {
      third: 15,
      overtime: 25,
      lateThird: 10 // added if < 5 mins left
    },
    strength: {
      powerPlay: 8,
      emptyNet: 12
    }
  },
  final: {
    diff: {
      tied: 25, // shootout/OT final
      oneGoal: 15,
      twoGoal: 5
    },
    overtime: 10
  }
};

const NHL_TEAM_DATA = {
  ANA: { id: 24, color: '#F47A38' },
  BOS: { id: 6,  color: '#FFB81C' },
  BUF: { id: 7,  color: '#003087' },
  CGY: { id: 20, color: '#C8102E' },
  CAR: { id: 12, color: '#CC0000' },
  CHI: { id: 16, color: '#CF0A2C' },
  COL: { id: 21, color: '#6F263D' },
  CBJ: { id: 29, color: '#002654' },
  DAL: { id: 25, color: '#006847' },
  DET: { id: 17, color: '#CE1126' },
  EDM: { id: 22, color: '#FF4C00' },
  FLA: { id: 13, color: '#041E42' },
  LAK: { id: 26, color: '#A2AAAD' },
  MIN: { id: 30, color: '#154734' },
  MTL: { id: 8,  color: '#AF1E2D' },
  NSH: { id: 18, color: '#FFB81C' },
  NJD: { id: 1,  color: '#CE1126' },
  NYI: { id: 2,  color: '#00539B' },
  NYR: { id: 3,  color: '#0038A8' },
  OTT: { id: 9,  color: '#C52032' },
  PHI: { id: 4,  color: '#F74902' },
  PIT: { id: 5,  color: '#FCB514' },
  SJS: { id: 28, color: '#006D75' },
  SEA: { id: 55, color: '#99D9D9' },
  STL: { id: 19, color: '#002F87' },
  TBL: { id: 14, color: '#002868' },
  TOR: { id: 10, color: '#00205B' },
  VAN: { id: 23, color: '#00205B' },
  VGK: { id: 54, color: '#B4975A' },
  WSH: { id: 15, color: '#041E42' },
  WPG: { id: 52, color: '#041E42' },
  UTA: { id: 59, color: '#71AFE2' }
};

const NHL_RIVALRY_PAIRS = [
  ['MTL','TOR'], ['MTL','BOS'], ['TOR','OTT'],
  ['CGY','EDM'], ['NYR','NYI'], ['NYR','NJD'],
  ['PHI','PIT'], ['LAK','SJS'], ['LAK','ANA'],
  ['CHI','STL'], ['DET','CHI'], ['WSH','PIT'],
  ['EDM','VAN'], ['SEA','VAN'], ['FLA','TBL'],
  ['COL','DET'], ['DAL','NSH'], ['BOS','BUF']
];
