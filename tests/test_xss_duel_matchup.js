const fs = require('fs');
const assert = require('assert');

// Read app.js
const appJsContent = fs.readFileSync('app.js', 'utf8');

// Find the section corresponding to the duel matchup
const match = appJsContent.match(/<div class="duel-title">([^<]+)<\/div>/);
assert(match, "Could not find duel-title in app.js");

// Validate that the variables are wrapped in escapeHTML
const duelTitleContent = match[1];
assert(duelTitleContent.includes('${escapeHTML(g.awayTeam)} @ ${escapeHTML(g.homeTeam)}'), "duel-title does not contain escaped variables");

const batterNameMatch = appJsContent.match(/<div class="duel-player-name">\$\{escapeHTML\(g\.currentBatter\.name\)\}<\/div>/);
assert(batterNameMatch, "batter name is not escaped");

const batterStatsMatch = appJsContent.match(/<div class="duel-player-stats">\$\{escapeHTML\(g\.currentBatter\.avg\)\}\/\$\{escapeHTML\(g\.currentBatter\.ops\)\}<\/div>/);
assert(batterStatsMatch, "batter stats are not escaped");

const pitcherNameMatch = appJsContent.match(/<div class="duel-player-name">\$\{escapeHTML\(g\.currentPitcher\.name\)\}<\/div>/);
assert(pitcherNameMatch, "pitcher name is not escaped");

const pitcherStatsMatch = appJsContent.match(/<div class="duel-player-stats">\$\{escapeHTML\(g\.currentPitcher\.era\)\} ERA<\/div>/);
assert(pitcherStatsMatch, "pitcher stats are not escaped");

console.log("XSS mitigation test passed!");
