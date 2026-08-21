// Mock globals
global.loadPrefs = () => ({});
global.todayET = () => '2023-01-01';
global.NBA_RIVALRY_PAIRS = [];
global.escapeHTML = (s) => s;
global.window = {};
global.document = {
  getElementById: () => ({ style: {}, addEventListener: () => {}, innerHTML: '' }),
  createElement: () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, setAttribute: () => {}, appendChild: () => {}, innerHTML: '' }),
  querySelector: () => null,
  querySelectorAll: () => []
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

const { getNBASeason } = require('../js/nba-app.js');

describe('getNBASeason', () => {
  it('returns the next year for months >= October (9)', () => {
    // Edge case: Exactly beginning of October (month index 9)
    expect(getNBASeason('2023-10-01')).toBe(2024);
    // Middle of season
    expect(getNBASeason('2023-11-15')).toBe(2024);
    // End of year
    expect(getNBASeason('2023-12-31')).toBe(2024);
  });

  it('returns the current year for months < October', () => {
    // Beginning of year
    expect(getNBASeason('2024-01-01')).toBe(2024);
    // Middle of year
    expect(getNBASeason('2024-04-15')).toBe(2024);
    // Edge case: Exactly end of September (month index 8)
    expect(getNBASeason('2024-09-30')).toBe(2024);
  });
});
