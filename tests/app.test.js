// Mock global functions before requiring app.js
global.loadPrefs = () => ({});
global.TEAM_DATA = {};
global.RIVALRY_PAIRS = [];
global.todayET = () => '2023-01-01';
global.localStorage = { getItem: () => null, setItem: () => {} };
global.window = {
  location: { search: '' },
  lastExpandData: {},
  activeDetailsTabs: {},
  lastMilestones: [],
  innerWidth: 1024,
  matchMedia: () => ({ matches: false }),
  document: { title: '' },
  history: { pushState: () => {}, replaceState: () => {} },
  requestAnimationFrame: (cb) => cb(),
  cancelAnimationFrame: () => {},
  addEventListener: () => {}
};
const mockElement = {
  classList: { add: ()=>{}, remove: ()=>{} },
  style: {},
  setAttribute: ()=>{},
  addEventListener: ()=>{},
  click: ()=>{}
};
global.document = {
  getElementById: () => mockElement,
  createElement: () => mockElement,
  querySelectorAll: () => []
};
global.navigator = { serviceWorker: undefined };
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

const assert = require('assert');
const { clamp } = require('../app.js');

try {
  // Test normal values
  assert.strictEqual(clamp(50), 50);
  assert.strictEqual(clamp(0), 0);
  assert.strictEqual(clamp(100), 100);

  // Test values below 0
  assert.strictEqual(clamp(-1), 0);
  assert.strictEqual(clamp(-100), 0);
  assert.strictEqual(clamp(-0.5), 0); // Math.round(-0.5) is -0, which is maxed to 0

  // Test values above 100
  assert.strictEqual(clamp(101), 100);
  assert.strictEqual(clamp(1000), 100);

  // Test decimal values
  assert.strictEqual(clamp(50.4), 50);
  assert.strictEqual(clamp(50.5), 51);
  assert.strictEqual(clamp(99.9), 100);

  console.log('All clamp tests passed!');
} catch (error) {
  console.error('Test failed:', error.message);
  process.exit(1);
}
