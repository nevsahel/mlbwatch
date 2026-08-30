const assert = require('assert').strict;
const { MLBProvider } = require('../js/providers/mlb-provider.js');

// Mock fetch globally
let lastFetchUrl = '';
let fetchMockResponse = {};
let fetchMockStatus = 200;

global.fetch = async (url) => {
    lastFetchUrl = url;
    return {
        ok: fetchMockStatus === 200,
        status: fetchMockStatus,
        statusText: fetchMockStatus === 200 ? 'OK' : 'Error',
        json: async () => fetchMockResponse
    };
};

describe('MLBProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new MLBProvider();
        lastFetchUrl = '';
        fetchMockResponse = {};
        fetchMockStatus = 200;
    });

    it('should initialize with default config', () => {
        assert.equal(provider.baseUrl, 'https://statsapi.mlb.com/api/v1');
    });

    it('should fetch and normalize scheduled games', async () => {
        fetchMockResponse = {
            dates: [{
                games: [
                    {
                        gamePk: 123,
                        gameDate: '2023-08-01T19:00:00Z',
                        status: { abstractGameState: 'Scheduled' },
                        teams: {
                            away: { team: { id: 111 }, score: 0 },
                            home: { team: { id: 147 }, score: 0 }
                        }
                    }
                ]
            }]
        };

        const games = await provider.getScheduledGames('2023-08-01');
        assert.equal(games.length, 1);
        assert.equal(games[0].id, 123);
        assert.equal(games[0].status, 'Scheduled');
        assert.equal(games[0].awayTeamId, 111);
        assert.equal(games[0].homeTeamId, 147);
        assert.ok(lastFetchUrl.includes('/schedule'));
    });

    it('should filter live games', async () => {
        fetchMockResponse = {
            dates: [{
                games: [
                    { gamePk: 1, status: { abstractGameState: 'Live' } },
                    { gamePk: 2, status: { abstractGameState: 'Final' } },
                    { gamePk: 3, status: { abstractGameState: 'In Progress' } }
                ]
            }]
        };

        const liveGames = await provider.getLiveGames('2023-08-01');
        assert.equal(liveGames.length, 2);
        assert.equal(liveGames[0].id, 1);
        assert.equal(liveGames[1].id, 3);
    });

    it('should fetch and normalize game state', async () => {
        fetchMockResponse = {
            gameData: {
                game: { pk: 716766 },
                status: { abstractGameState: 'Live' }
            },
            liveData: {
                linescore: {
                    currentInning: 5,
                    isTopInning: true,
                    outs: 2,
                    teams: { away: { runs: 3 }, home: { runs: 2 } },
                    offense: { first: true, batter: { id: 660271, fullName: 'Shohei Ohtani' } },
                    defense: { pitcher: { id: 592332 } } // missing fullName, should use fallback or 'Unknown'
                },
                boxscore: {
                    teams: {
                        away: { players: { 'ID660271': { person: { fullName: 'Shohei Ohtani' } } } },
                        home: { players: { 'ID592332': { person: { fullName: 'Kevin Gausman' } } } }
                    }
                }
            }
        };

        const state = await provider.getGameState(716766);
        assert.equal(state.gameId, 716766);
        assert.equal(state.status, 'Live');
        assert.equal(state.pregameState, false);
        assert.equal(state.currentInning, 5);
        assert.equal(state.outs, 2);
        assert.equal(state.score.away, 3);
        assert.equal(state.baseRunners.first, true);
        assert.equal(state.baseRunners.second, false);
        assert.equal(state.currentBatter.name, 'Shohei Ohtani');
        assert.equal(state.currentPitcher.name, 'Kevin Gausman'); // resolved from boxscore
    });

    it('should fetch and normalize play-by-play events', async () => {
        fetchMockResponse = {
            liveData: {
                plays: {
                    allPlays: [
                        {
                            result: { event: 'Home Run', description: 'Aaron Judge homers.', rbi: 1 },
                            matchup: { batter: { id: 592450 }, pitcher: { id: 12345 } },
                            about: { isScoringPlay: true, inning: 1, isTopInning: true }
                        }
                    ]
                }
            }
        };

        const plays = await provider.getPlayByPlay(123);
        assert.equal(plays.length, 1);
        assert.equal(plays[0].event, 'Home Run');
        assert.equal(plays[0].rbi, 1);
        assert.equal(plays[0].batterId, 592450);
        assert.equal(plays[0].isScoringPlay, true);
    });

    it('should fetch and normalize player info', async () => {
        fetchMockResponse = {
            people: [
                { id: 123, fullName: 'Mike Trout', primaryPosition: { code: '8', abbreviation: 'CF' }, isTwoWayPlayer: false, active: true }
            ]
        };

        const player = await provider.getPlayerInfo(123);
        assert.equal(player.id, 123);
        assert.equal(player.name, 'Mike Trout');
        assert.equal(player.isPitcher, false);
        assert.equal(player.isTwoWay, false);
        assert.equal(player.active, true);
    });

    it('should fetch and normalize team info', async () => {
        fetchMockResponse = {
            teams: [
                { id: 147, name: 'New York Yankees', abbreviation: 'NYY', league: { id: 103 } }
            ]
        };

        const team = await provider.getTeamInfo(147);
        assert.equal(team.id, 147);
        assert.equal(team.abbreviation, 'NYY');
        assert.equal(team.leagueId, 103);
    });

    it('should fetch and normalize player stats', async () => {
        fetchMockResponse = {
            people: [
                {
                    id: 123,
                    fullName: 'Some Player',
                    stats: [
                        {
                            group: { displayName: 'hitting' },
                            type: { displayName: 'season' },
                            splits: [{ stat: { homeRuns: 40, ops: '1.050' } }]
                        }
                    ]
                }
            ]
        };

        const statsList = await provider.getStats([123], 'hitting', 'season');
        assert.equal(statsList.length, 1);
        assert.equal(statsList[0].id, 123);
        assert.equal(statsList[0].group, 'hitting');
        assert.equal(statsList[0].stats.homeRuns, 40);
        assert.equal(statsList[0].stats.onBasePlusSlugging, '1.050');
    });
});
