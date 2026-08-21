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

  console.log('\n🧪 Running loadPrefs tests...');

  runTest('loadPrefs: Should load valid JSON from localStorage', () => {
    global.localStorage.setItem('mlbWatchPrefsV1', '{"theme":"dark"}');
    const prefs = loadPrefs();
    assert.deepEqual(prefs, { theme: 'dark' });
  });

  runTest('loadPrefs: Should return empty object when localStorage is empty', () => {
    // localStorage is cleared before each test
    const prefs = loadPrefs();
    assert.deepEqual(prefs, {});
  });

  runTest('loadPrefs: Should return empty object when localStorage contains invalid JSON', () => {
    global.localStorage.setItem('mlbWatchPrefsV1', '{invalid json');
    const prefs = loadPrefs();
    assert.deepEqual(prefs, {});
  });

  runTest('loadPrefs: Should return empty object and not throw if localStorage.getItem throws', () => {
    const originalGetItem = global.localStorage.getItem;
    global.localStorage.getItem = () => { throw new Error('SecurityError: access denied'); };

    let prefs;
    assert.doesNotThrow(() => {
      prefs = loadPrefs();
    });
    assert.deepEqual(prefs, {});

    // Restore
    global.localStorage.getItem = originalGetItem;
  });

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

  console.log('\n🧪 Running writeCache tests...');

  // 7. Write to cache
  runTest('Should write cache with savedAt timestamp and DATA_CACHE_PREFIX', () => {
    const data = { scores: [1, 2, 3] };
    const now = Date.now();

    // Mock Date.now() to control the timestamp
    const originalDateNow = Date.now;
    Date.now = () => now;

    writeCache('scores', data);
    const stored = global.localStorage.getItem('mlbWatchCache:scores');
    assert.strictEqual(stored, JSON.stringify({ savedAt: now, data }));

    // Restore Date.now()
    Date.now = originalDateNow;
  });

  // 8. writeCache LocalStorage throwing error
  runTest('writeCache should not throw if localStorage.setItem throws', () => {
    const originalSetItem = global.localStorage.setItem;
    global.localStorage.setItem = () => { throw new Error('Quota exceeded'); };

    assert.doesNotThrow(() => {
      writeCache('scores', { data: 1 });
    });

    global.localStorage.setItem = originalSetItem;
  });


  console.log('\n🧪 Running readCache tests...');

  // 9. Read valid cache
  runTest('Should return parsed JSON when valid cache exists', () => {
    global.localStorage.setItem('mlbWatchCache:validKey', '{"data":"test"}');
    const result = readCache('validKey');
    assert.deepEqual(result, { data: 'test' });
  });

  // 10. Read non-existent cache
  runTest('Should return null when cache does not exist', () => {
    const result = readCache('missingKey');
    assert.strictEqual(result, null);
  });

  // 11. Read invalid JSON cache
  runTest('Should return null and catch error when cache contains invalid JSON', () => {
    global.localStorage.setItem('mlbWatchCache:invalidKey', '{invalid');
    const result = readCache('invalidKey');
    assert.strictEqual(result, null);
  });

  // 12. LocalStorage throwing error
  runTest('Should return null if localStorage.getItem throws', () => {
    const originalGetItem = global.localStorage.getItem;
    global.localStorage.getItem = () => { throw new Error('Access denied'); };

    const result = readCache('someKey');
    assert.strictEqual(result, null);

    global.localStorage.getItem = originalGetItem;
  });


  console.log('\n🧪 Running isRivalry tests...');
  runTest('Should return true for a valid rivalry regardless of order', () => {
    const mockSet = new Set(['BOS-LAL', 'NYK-PHI']);
    assert.strictEqual(isRivalry('BOS', 'LAL', mockSet), true);
    assert.strictEqual(isRivalry('LAL', 'BOS', mockSet), true);
  });

  runTest('Should return false for non-rivalry teams', () => {
    const mockSet = new Set(['BOS-LAL']);
    assert.strictEqual(isRivalry('LAL', 'NYK', mockSet), false);
    assert.strictEqual(isRivalry('NYK', 'BOS', mockSet), false);
  });

  runTest('Should return false when rivalrySet is empty', () => {
    const mockSet = new Set();
    assert.strictEqual(isRivalry('BOS', 'LAL', mockSet), false);
  });

  runTest('Should handle empty string inputs gracefully', () => {
    const mockSet = new Set(['-LAL', '-BOS']);
    assert.strictEqual(isRivalry('', 'LAL', mockSet), true);
    assert.strictEqual(isRivalry('LAL', '', mockSet), true);
    assert.strictEqual(isRivalry('BOS', '', mockSet), true);
    assert.strictEqual(isRivalry('', '', mockSet), false);
  });

  runTest('Should handle identical team inputs (self-rivalry)', () => {
    const mockSet = new Set(['BOS-BOS']);
    assert.strictEqual(isRivalry('BOS', 'BOS', mockSet), true);
    const mockSet2 = new Set(['BOS-LAL']);
    assert.strictEqual(isRivalry('BOS', 'BOS', mockSet2), false);
  });

  console.log('\n🧪 Running escapeHTML tests...');

  runTest('Should properly escape special characters', () => {
    assert.strictEqual(escapeHTML('1 & 2 < 3 > 0 "quote" \'apostrophe\''), '1 &amp; 2 &lt; 3 &gt; 0 &quot;quote&quot; &#39;apostrophe&#39;');
  });

  runTest('Should handle null, undefined, and empty strings', () => {
    assert.strictEqual(escapeHTML(null), '');
    assert.strictEqual(escapeHTML(undefined), '');
    assert.strictEqual(escapeHTML(''), '');
  });

  runTest('Should handle strings with no special characters', () => {
    assert.strictEqual(escapeHTML('Hello World! 123'), 'Hello World! 123');
  });

  runTest('Should cast non-string types to string', () => {
    assert.strictEqual(escapeHTML(123), '123');
    assert.strictEqual(escapeHTML(true), 'true');
    assert.strictEqual(escapeHTML(false), 'false');
    // For arrays and objects, String() conversion happens
    assert.strictEqual(escapeHTML([1, 2]), '1,2');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
