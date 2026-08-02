const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

// Mock browser globals required by app.js and its dependencies
global.window = {
  location: { search: '' },
  addEventListener: () => {}
};
global.localStorage = {
  getItem: () => null,
  setItem: () => {}
};
global.document = {
  getElementById: () => ({
    addEventListener: () => {},
    appendChild: () => {},
    setAttribute: () => {},
    style: {},
    classList: { add: ()=>{}, remove: ()=>{} },
    innerHTML: '',
    textContent: '',
    value: ''
  }),
  createElement: () => ({ style: {}, classList: { add: ()=>{}, remove: ()=>{} } }),
  querySelector: () => null,
  querySelectorAll: () => []
};
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
global.navigator = { userAgent: 'node' };
global.console = console;

// Load dependencies and app.js into the global context
const coreCode = fs.readFileSync(path.join(__dirname, '../utils/core.js'), 'utf8');
const perfCode = fs.readFileSync(path.join(__dirname, '../utils/performance.js'), 'utf8');
const constantsCode = fs.readFileSync(path.join(__dirname, '../js/constants.js'), 'utf8');
const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

vm.runInThisContext(coreCode);
vm.runInThisContext(perfCode);
vm.runInThisContext(constantsCode);
vm.runInThisContext(appCode);

function runTests() {
  console.log('🧪 Running countRunsFromDescription tests...');

  let passed = 0;
  let failed = 0;

  function runTest(name, testFn) {
    try {
      testFn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`❌ FAIL: ${name}`);
      console.error(e.stack);
      failed++;
    }
  }

  runTest('Should return 1 for an empty string', () => {
    assert.strictEqual(countRunsFromDescription(''), 1);
  });

  runTest('Should return 1 when no arguments are passed', () => {
    assert.strictEqual(countRunsFromDescription(), 1);
  });

  runTest('Should return 1 when there are no " scores" matches', () => {
    assert.strictEqual(countRunsFromDescription('Aaron Judge homers (40) on a fly ball to left field.'), 1);
  });

  runTest('Should return 2 when there is one " scores" match', () => {
    assert.strictEqual(countRunsFromDescription('Juan Soto homers (30) on a fly ball to right field. Gleyber Torres scores.'), 2);
  });

  runTest('Should return 3 when there are two " scores" matches', () => {
    assert.strictEqual(countRunsFromDescription('Giancarlo Stanton homers on a fly ball. Torres scores. Soto scores.'), 3);
  });

  runTest('Should return 4 for a grand slam (three " scores" matches)', () => {
    assert.strictEqual(countRunsFromDescription('Grand slam! Player A scores. Player B scores. Player C scores.'), 4);
  });

  runTest('Should be case-insensitive when matching " scores"', () => {
    assert.strictEqual(countRunsFromDescription('Player hits a home run. Player A SCORES. Player B Scores.'), 3);
  });

  runTest('Should not match "scores" if it lacks a leading space', () => {
    // If the word "scores" is part of another word or lacks a leading space
    assert.strictEqual(countRunsFromDescription('The boxscores are updated.'), 1);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
