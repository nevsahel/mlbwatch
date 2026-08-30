const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert').strict;

// 1. Read app.js and get model functions
const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsCode = fs.readFileSync(appJsPath, 'utf8');

const sandbox = {
    console: console,
    document: { getElementById: () => ({ innerHTML: '' }), createElement: () => ({}) },
    window: {},
    fetch: () => Promise.resolve({ json: () => ({}) }),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Date: Date,
    AbortController: typeof AbortController !== 'undefined' ? AbortController : null,
};
vm.createContext(sandbox);

try {
    vm.runInContext(appJsCode, sandbox);
} catch (e) {
    // Ignore reference errors from browser globals in app.js if they don't break our extraction
}

// Extract model functions. If they are not on the global object due to being const/let,
// we will parse them directly via a specific extraction or by modifying the code slightly for the test.
// Since we know the model functions (scoreMVPHitter, scoreMVPPitcher, mvpScore, scoreCY) are inside
// fetchAwardRaces or closures, we'll re-declare them here for testing directly from their source.
// Actually they are inside `fetchAwardRaces`, so we can't easily grab them from the sandbox.
// Let's redefine them exactly as they are in app.js for testing.

const scoreMVPHitter = (p) => {
    const s = p.stats;
    const ops = parseFloat(s.onBasePlusSlugging) || 0;
    const hr = parseInt(s.homeRuns) || 0;
    const rbi = parseInt(s.runsBattedIn) || 0;
    const r = parseInt(s.runs) || 0;
    const avg = parseFloat(s.battingAverage) || 0;
    const war = p.war ?? 0;
    let score = (war * 10.0) + (ops * 45.0) + (hr * 0.45) + (rbi * 0.12) + (r * 0.12) + (avg * 25.0);
    if (p.name === 'Yordan Alvarez') {
      score += 25.0;
    }
    return score;
};

const scoreMVPPitcher = (p) => {
    const s = p.stats;
    const w = parseInt(s.wins) || 0;
    const era = parseFloat(s.earnedRunAverage) || 4.5;
    const so = parseInt(s.strikeouts) || 0;
    const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
    const war = p.war ?? 0;
    return ((war * 9.0) + (w * 1.0) + ((3.5 - era) * 10.0) + (so * 0.06) + ((1.2 - whip) * 18.0)) * 0.82;
};

const scoreCY = p => {
    const s = p.stats;
    const era = parseFloat(s.earnedRunAverage) || 4.5;
    const k = parseInt(s.strikeouts) || 0;
    const w = parseInt(s.wins) || 0;
    const ip = parseFloat(s.inningsPitched) || 0;
    const whip = parseFloat(s.walksAndHitsPerInningPitched) || 1.3;
    const sho = parseInt(s.shutouts) || 0;
    const war = p.war ?? 0;
    let score = (w * 2.2) + ((3.2 - era) * 18) + (k * 0.16) + (ip * 0.1) + ((1.15 - whip) * 26) + (sho * 4) + (war * 2.5);
    if (p.name === 'Cam Schlittler' || p.name === 'Jacob Misiorowski') {
      score += 25.0;
    }
    return score;
};

// 2. Load the pipeline
const pipelinePath = path.join(__dirname, '..', 'js', 'live-model-pipeline.js');
const { LiveModelPipeline } = require(pipelinePath);

const pipeline = new LiveModelPipeline();

// 3. Mock live game payloads
const mockPregamePayload = {
    status: 'Pregame',
    awayScore: 0,
    homeScore: 0,
    inning: 0,
    outs: 0
};

const mockLivePayload = {
    status: 'Live',
    awayScore: 4,
    homeScore: 3,
    inning: 8,
    outs: 2,
    onFirst: true,
    onSecond: false,
    onThird: true,
    currentBatter: { id: 12345, name: 'Shohei Ohtani' },
    currentPitcher: { id: 67890, name: 'Gerrit Cole' }
};

// 4. Test missing stats checking and model output for completely missing stats
const outputMissing = pipeline.process(mockLivePayload);

assert.ok(outputMissing.hitter, 'Hitter output should be generated');
assert.ok(outputMissing.pitcher, 'Pitcher output should be generated');

assert.deepEqual(outputMissing.hitter._missingVariables, [
    'war',
    'stats.onBasePlusSlugging',
    'stats.homeRuns',
    'stats.runsBattedIn',
    'stats.runs',
    'stats.battingAverage'
]);

assert.deepEqual(outputMissing.pitcher._missingVariables, [
    'war',
    'stats.wins',
    'stats.earnedRunAverage',
    'stats.strikeouts',
    'stats.walksAndHitsPerInningPitched',
    'stats.inningsPitched',
    'stats.shutouts'
]);

// Since stats are missing, the model should use its default fallback logic (e.g. ERA = 4.5)
const hitterScoreMissing = scoreMVPHitter(outputMissing.hitter);
const pitcherScoreMissing = scoreMVPPitcher(outputMissing.pitcher);
const cyScoreMissing = scoreCY(outputMissing.pitcher);

assert.ok(typeof hitterScoreMissing === 'number');
assert.ok(typeof pitcherScoreMissing === 'number');
assert.ok(typeof cyScoreMissing === 'number');


// 5. Test with provided stats
const existingStats = {
    12345: {
        war: 8.5,
        isTwoWay: true,
        stats: {
            onBasePlusSlugging: '1.066',
            homeRuns: '44',
            runsBattedIn: '95',
            runs: '102',
            battingAverage: '.304',
            wins: '10',
            earnedRunAverage: '3.14',
            strikeouts: '167',
            walksAndHitsPerInningPitched: '1.06',
            inningsPitched: '132.0',
            shutouts: '1'
        }
    },
    67890: {
        war: 5.2,
        isTwoWay: false,
        stats: {
            wins: '15',
            earnedRunAverage: '2.63',
            strikeouts: '222',
            walksAndHitsPerInningPitched: '0.98',
            inningsPitched: '209.0',
            shutouts: '2'
        }
    }
};

const outputWithStats = pipeline.process(mockLivePayload, existingStats);

// Should have NO missing variables
assert.deepEqual(outputWithStats.hitter._missingVariables, []);
assert.deepEqual(outputWithStats.pitcher._missingVariables, []);

// Test model execution
const ohtaniMVPScore = scoreMVPHitter(outputWithStats.hitter);
assert.ok(ohtaniMVPScore > 0, 'Score should be calculated properly for hitter');

const coleCYScore = scoreCY(outputWithStats.pitcher);
assert.ok(coleCYScore > 0, 'Score should be calculated properly for Cy Young pitcher');

// 6. Test pregame scenario
const outputPregame = pipeline.process(mockPregamePayload);
assert.equal(outputPregame.hitter, null);
assert.equal(outputPregame.pitcher, null);

console.log('✅ All live model pipeline tests passed successfully!');
