const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

// Simple mock for localStorage
let store = {};
global.localStorage = {
  getItem: (key) => store[key] || null,
  setItem: (key, value) => { store[key] = value; },
  clear: () => { store = {}; }
};

// Mock document for other functions in core.js
global.document = {
  createElement: () => ({ appendChild: () => {}, setAttribute: () => {}, style: {}, remove: () => {} }),
  getElementById: () => null
};

// Load core.js into the global context
const path = require('path');
const coreCode = fs.readFileSync(path.join(__dirname, '../utils/core.js'), 'utf8');
vm.runInThisContext(coreCode);

function runTests() {
  console.log('🧪 Running savePrefs tests...');

  let passed = 0;
  let failed = 0;

  function runTest(name, testFn) {
    global.localStorage.clear(); // Reset state before each test
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

  // 1. Empty state
  runTest('Should save new preferences when localStorage is empty', () => {
    savePrefs({ theme: 'dark' });
    const stored = global.localStorage.getItem('mlbWatchPrefsV1');
    assert.strictEqual(stored, '{"theme":"dark"}');
  });

  // 2. Merging state
  runTest('Should merge new preferences with existing ones', () => {
    global.localStorage.setItem('mlbWatchPrefsV1', '{"theme":"dark"}');
    savePrefs({ font: 'large' });
    const stored = global.localStorage.getItem('mlbWatchPrefsV1');
    assert.strictEqual(stored, '{"theme":"dark","font":"large"}');
  });

  // 3. Overwriting state
  runTest('Should overwrite existing preference keys with new ones', () => {
    global.localStorage.setItem('mlbWatchPrefsV1', '{"theme":"dark","font":"large"}');
    savePrefs({ theme: 'light' });
    const stored = global.localStorage.getItem('mlbWatchPrefsV1');
    assert.strictEqual(stored, '{"theme":"light","font":"large"}');
  });

  // 4. Corrupted state
  runTest('Should gracefully handle corrupted JSON in localStorage', () => {
    global.localStorage.setItem('mlbWatchPrefsV1', '{invalid json');
    savePrefs({ theme: 'dark' });
    const stored = global.localStorage.getItem('mlbWatchPrefsV1');
    assert.strictEqual(stored, '{"theme":"dark"}');
  });

  // 5. Default parameter
  runTest('Should keep existing preferences when called without arguments', () => {
    global.localStorage.setItem('mlbWatchPrefsV1', '{"theme":"dark"}');
    savePrefs();
    const stored = global.localStorage.getItem('mlbWatchPrefsV1');
    assert.strictEqual(stored, '{"theme":"dark"}');
  });

  // 6. LocalStorage throwing error
  runTest('Should not throw if localStorage.setItem throws', () => {
    // Override setItem to throw
    const originalSetItem = global.localStorage.setItem;
    global.localStorage.setItem = () => { throw new Error('Quota exceeded'); };

    // Should not throw exception
    assert.doesNotThrow(() => {
      savePrefs({ theme: 'dark' });
    });

    // Restore
    global.localStorage.setItem = originalSetItem;
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
