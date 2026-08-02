const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert').strict;

// Read the utils/core.js file
const coreJsPath = path.join(__dirname, '..', '..', 'utils', 'core.js');
const coreJsCode = fs.readFileSync(coreJsPath, 'utf8');

// Function to run a specific test case
function runTest(testName, setupMock, testExecution) {
    console.log(`Running test: ${testName}...`);

    // Create a mock for localStorage
    const localStorageMock = {
        getItem: setupMock()
    };

    // Create a fresh sandbox for each test
    const sandbox = {
        localStorage: localStorageMock,
        console: console,
        document: {}, // loadPrefs doesn't need document, but some other functions in core.js might during eval
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Date: Date,
        AbortController: typeof AbortController !== 'undefined' ? AbortController : null,
        fetch: () => {}
    };

    vm.createContext(sandbox);

    try {
        // Execute the core.js script in the sandbox
        vm.runInContext(coreJsCode, sandbox);

        // Execute the specific test logic
        testExecution(sandbox);
        console.log(`✅ Passed: ${testName}`);
    } catch (error) {
        console.error(`❌ Failed: ${testName}`);
        console.error(error);
        process.exit(1);
    }
}

// 1. Test happy path: when valid JSON is stored
runTest(
    'loadPrefs - returns parsed object for valid JSON',
    () => (key) => {
        assert.equal(key, 'mlbWatchPrefsV1');
        return '{"theme": "dark", "volume": 50}';
    },
    (sandbox) => {
        const result = sandbox.loadPrefs();
        // Since loadPrefs creates an object in a different vm context, we need to compare properties or stringify
        assert.equal(JSON.stringify(result), JSON.stringify({ theme: 'dark', volume: 50 }));
    }
);

// 2. Test missing data: when localStorage returns null (or empty string)
runTest(
    'loadPrefs - returns empty object when localStorage has no item',
    () => (key) => {
        assert.equal(key, 'mlbWatchPrefsV1');
        return null;
    },
    (sandbox) => {
        const result = sandbox.loadPrefs();
        assert.equal(JSON.stringify(result), JSON.stringify({}));
    }
);

// 3. Test invalid JSON: try-catch should handle parsing errors
runTest(
    'loadPrefs - returns empty object for invalid JSON',
    () => (key) => {
        assert.equal(key, 'mlbWatchPrefsV1');
        return '{ invalid json }';
    },
    (sandbox) => {
        const result = sandbox.loadPrefs();
        assert.equal(JSON.stringify(result), JSON.stringify({}));
    }
);

// 4. Test storage exceptions: localStorage.getItem itself throws
runTest(
    'loadPrefs - returns empty object when localStorage throws an error',
    () => (key) => {
        assert.equal(key, 'mlbWatchPrefsV1');
        throw new Error('Access denied to localStorage');
    },
    (sandbox) => {
        const result = sandbox.loadPrefs();
        assert.equal(JSON.stringify(result), JSON.stringify({}));
    }
);

console.log('🎉 All loadPrefs tests passed successfully!');
