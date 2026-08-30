/**
 * MLB Data Provider
 * Connects the external MLB data provider (statsapi.mlb.com) to our normalized data model.
 * All provider-specific code and API URLs are isolated here.
 * Provider-specific JSON structures are mapped to normalized application-level objects.
 */

class MLBProvider {
    constructor(config = {}) {
        // Use environment variables for API credentials if available (e.g., node environment)
        const env = (typeof process !== 'undefined' && process.env) ? process.env : {};

        // Base API URL
        this.baseUrl = config.baseUrl || env.MLB_API_BASE_URL || 'https://statsapi.mlb.com/api/v1';
        this.baseV1_1Url = config.baseV1_1Url || env.MLB_API_V1_1_URL || 'https://statsapi.mlb.com/api/v1.1';

        // Any auth if required by provider (statsapi is currently public, but keeping for architecture)
        this.apiKey = config.apiKey || env.MLB_API_KEY || null;
    }

    /**
     * Helper to perform fetch requests
     */
    async _fetch(url) {
        const headers = {};
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        // Use global fetch (browser or Node 18+)
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`MLBProvider fetch failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Retrieve scheduled MLB games for a given date
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {Promise<Array>} Array of normalized game objects
     */
    async getScheduledGames(date) {
        const url = `${this.baseUrl}/schedule?sportId=1&date=${date}`;
        const data = await this._fetch(url);

        return this._normalizeGames(data.dates?.[0]?.games || []);
    }

    /**
     * Retrieve live MLB games for a given date
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {Promise<Array>} Array of normalized live game objects
     */
    async getLiveGames(date) {
        const games = await this.getScheduledGames(date);
        return games.filter(g => g.status === 'In Progress' || g.status === 'Live');
    }

    /**
     * Retrieve game state for a specific game
     * @param {number|string} gameId
     * @returns {Promise<Object>} Normalized game state
     */
    async getGameState(gameId) {
        const url = `${this.baseV1_1Url}/game/${gameId}/feed/live`;
        const data = await this._fetch(url);
        return this._normalizeGameState(data);
    }

    /**
     * Retrieve play-by-play events for a specific game
     * @param {number|string} gameId
     * @returns {Promise<Array>} Array of normalized play events
     */
    async getPlayByPlay(gameId) {
        const url = `${this.baseV1_1Url}/game/${gameId}/feed/live`;
        const data = await this._fetch(url);

        const plays = data.liveData?.plays?.allPlays || [];
        return plays.map(p => this._normalizePlay(p));
    }

    /**
     * Retrieve relevant player information
     * @param {number|string} playerId
     * @returns {Promise<Object>} Normalized player object
     */
    async getPlayerInfo(playerId) {
        const url = `${this.baseUrl}/people/${playerId}`;
        const data = await this._fetch(url);

        const person = data.people?.[0] || {};
        return this._normalizePlayer(person);
    }

    /**
     * Retrieve relevant team information
     * @param {number|string} teamId
     * @returns {Promise<Object>} Normalized team object
     */
    async getTeamInfo(teamId) {
        const url = `${this.baseUrl}/teams/${teamId}`;
        const data = await this._fetch(url);

        const team = data.teams?.[0] || {};
        return this._normalizeTeam(team);
    }

    /**
     * Retrieve any statistics required by the existing MLB model
     * @param {Array<number|string>} personIds
     * @param {string} group (e.g., 'hitting', 'pitching')
     * @param {string} type (e.g., 'season', 'career')
     * @param {string} endDate (optional)
     * @returns {Promise<Array>} Array of normalized player stat objects
     */
    async getStats(personIds, group, type, endDate) {
        if (!personIds || personIds.length === 0) return [];

        let url = `${this.baseUrl}/people?personIds=${personIds.join(',')}&hydrate=stats(group=[${group}],type=[${type}]`;
        if (endDate) {
            url += `,endDate=${endDate}`;
        }
        url += `)`;

        const data = await this._fetch(url);
        const people = data.people || [];

        return people.map(p => this._normalizePlayerStats(p, group, type));
    }

    // --- Normalization Methods (Isolating provider-specific JSON) ---

    _normalizeGames(gamesData) {
        return gamesData.map(g => ({
            id: g.gamePk,
            gameDate: g.gameDate,
            status: g.status?.abstractGameState,
            awayTeamId: g.teams?.away?.team?.id,
            homeTeamId: g.teams?.home?.team?.id,
            awayScore: g.teams?.away?.score || 0,
            homeScore: g.teams?.home?.score || 0
        }));
    }

    _normalizeGameState(feedData) {
        const liveData = feedData.liveData || {};
        const linescore = liveData.linescore || {};
        const boxscore = liveData.boxscore || {};

        const pregameState = feedData.gameData?.status?.abstractGameState === 'Pregame' || feedData.gameData?.status?.abstractGameState === 'Scheduled';

        return {
            gameId: feedData.gameData?.game?.pk,
            status: feedData.gameData?.status?.abstractGameState,
            pregameState: pregameState,
            currentInning: linescore.currentInning || 0,
            isTopInning: linescore.isTopInning || false,
            outs: linescore.outs || 0,
            score: {
                away: linescore.teams?.away?.runs || 0,
                home: linescore.teams?.home?.runs || 0
            },
            baseRunners: {
                first: !!linescore.offense?.first,
                second: !!linescore.offense?.second,
                third: !!linescore.offense?.third
            },
            currentBatter: this._extractMatchupPlayer(linescore.offense?.batter, boxscore),
            currentPitcher: this._extractMatchupPlayer(linescore.defense?.pitcher, boxscore)
        };
    }

    _extractMatchupPlayer(playerRef, boxscore) {
        if (!playerRef || !playerRef.id) return null;

        // Attempt to enrich with name from boxscore if available
        let name = playerRef.fullName;
        if (!name) {
            const allPlayers = { ...boxscore.teams?.away?.players, ...boxscore.teams?.home?.players };
            const playerDetails = allPlayers[`ID${playerRef.id}`];
            if (playerDetails) {
                name = playerDetails.person?.fullName;
            }
        }

        return {
            id: playerRef.id,
            name: name || 'Unknown'
        };
    }

    _normalizePlay(playData) {
        return {
            event: playData.result?.event,
            description: playData.result?.description,
            rbi: playData.result?.rbi || 0,
            batterId: playData.matchup?.batter?.id,
            pitcherId: playData.matchup?.pitcher?.id,
            isScoringPlay: playData.about?.isScoringPlay || false,
            inning: playData.about?.inning,
            isTopInning: playData.about?.isTopInning
        };
    }

    _normalizePlayer(personData) {
        return {
            id: personData.id,
            name: personData.fullName,
            primaryPosition: personData.primaryPosition?.abbreviation,
            isPitcher: personData.primaryPosition?.code === '1',
            isTwoWay: personData.isTwoWayPlayer || false,
            active: personData.active
        };
    }

    _normalizeTeam(teamData) {
        return {
            id: teamData.id,
            name: teamData.name,
            abbreviation: teamData.abbreviation,
            leagueId: teamData.league?.id
        };
    }

    _normalizePlayerStats(personData, group, type) {
        const statsArray = personData.stats || [];
        const matchingStatGroup = statsArray.find(s => s.group?.displayName === group && s.type?.displayName === type);

        const rawSplits = matchingStatGroup?.splits?.[0]?.stat || {};

        // Return a clean object decoupled from the API's specific nesting
        return {
            id: personData.id,
            name: personData.fullName,
            group: group,
            stats: {
                // Hitting
                homeRuns: rawSplits.homeRuns || 0,
                runsBattedIn: rawSplits.rbi || 0,
                runs: rawSplits.runs || 0,
                battingAverage: rawSplits.avg || '0.000',
                onBasePlusSlugging: rawSplits.ops || '0.000',

                // Pitching
                wins: rawSplits.wins || 0,
                earnedRunAverage: rawSplits.era || '0.00',
                strikeouts: rawSplits.strikeOuts || 0,
                walksAndHitsPerInningPitched: rawSplits.whip || '0.00',
                inningsPitched: rawSplits.inningsPitched || '0.0',
                shutouts: rawSplits.shutouts || 0
            }
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MLBProvider };
}
