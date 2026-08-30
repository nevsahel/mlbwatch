/**
 * Data pipeline for feeding live MLB game state to the existing MVP/CY models.
 *
 * Sports data provider -> provider adapter -> normalized MLB game state -> model input adapter -> existing MLB model
 */

class MlbProviderAdapter {
    /**
     * Normalizes a raw live game payload into a standard MLB game state.
     * @param {Object} rawData The raw game data from the provider.
     * @returns {Object} The normalized MLB game state.
     */
    normalize(rawData) {
        // Extract basic game state properties
        const pregameState = rawData.status === 'Pregame' || rawData.status === 'Scheduled';
        const currentInning = rawData.inning || 0;
        const outs = rawData.outs || 0;
        const score = {
            away: rawData.awayScore || 0,
            home: rawData.homeScore || 0
        };
        const baseRunners = {
            first: !!rawData.onFirst,
            second: !!rawData.onSecond,
            third: !!rawData.onThird
        };
        const currentBatter = rawData.currentBatter || null;
        const currentPitcher = rawData.currentPitcher || null;

        return {
            pregameState,
            currentInning,
            outs,
            score,
            baseRunners,
            currentBatter,
            currentPitcher
        };
    }
}

class ModelInputAdapter {
    /**
     * Converts normalized live-game data into exactly the format required by the existing model.
     * Checks for missing variables rather than inventing or approximating them.
     * @param {Object} normalizedState The normalized live game state.
     * @param {Object} existingStats The existing season-to-date stats for players (optional).
     * @returns {Object} Objects structured for the model, one for hitter and one for pitcher (if applicable).
     */
    adapt(normalizedState, existingStats = {}) {
        const hitterModelInput = this._createModelObject(normalizedState.currentBatter, false, existingStats);
        const pitcherModelInput = this._createModelObject(normalizedState.currentPitcher, true, existingStats);

        return {
            hitter: hitterModelInput,
            pitcher: pitcherModelInput
        };
    }

    _createModelObject(player, isPitcher, existingStats) {
        if (!player) return null;

        const modelObj = {
            id: player.id,
            name: player.name || 'Unknown',
            isPitcher: isPitcher,
            isTwoWay: false,
            stats: {},
            war: null,
            _missingVariables: [] // Explicitly list missing required variables
        };

        const existingPlayerStats = existingStats[player.id] || { stats: {} };
        const s = existingPlayerStats.stats || {};

        // Copy over what we have
        modelObj.stats = { ...s };
        if (existingPlayerStats.war !== undefined) {
            modelObj.war = existingPlayerStats.war;
        }
        if (existingPlayerStats.isTwoWay !== undefined) {
            modelObj.isTwoWay = existingPlayerStats.isTwoWay;
        }

        // Check for missing model-specific requirements
        this._checkMissingVariables(modelObj, isPitcher);

        return modelObj;
    }

    _checkMissingVariables(modelObj, isPitcher) {
        if (modelObj.war === null || modelObj.war === undefined) {
            modelObj._missingVariables.push('war');
        }

        const requiredHitterStats = [
            'onBasePlusSlugging',
            'homeRuns',
            'runsBattedIn',
            'runs',
            'battingAverage'
        ];

        const requiredPitcherStats = [
            'wins',
            'earnedRunAverage',
            'strikeouts',
            'walksAndHitsPerInningPitched',
            'inningsPitched',
            'shutouts'
        ];

        const requiredStats = isPitcher ? requiredPitcherStats : requiredHitterStats;
        if (modelObj.isTwoWay) {
            // Check both if two-way
            requiredHitterStats.concat(requiredPitcherStats).forEach(stat => {
                if (modelObj.stats[stat] === undefined || modelObj.stats[stat] === null) {
                    modelObj._missingVariables.push(`stats.${stat}`);
                }
            });
        } else {
            requiredStats.forEach(stat => {
                if (modelObj.stats[stat] === undefined || modelObj.stats[stat] === null) {
                    modelObj._missingVariables.push(`stats.${stat}`);
                }
            });
        }
    }
}

class LiveModelPipeline {
    constructor() {
        this.providerAdapter = new MlbProviderAdapter();
        this.inputAdapter = new ModelInputAdapter();
    }

    /**
     * Process raw game data and return model-ready inputs.
     * @param {Object} rawData
     * @param {Object} existingStats
     * @returns {Object} Contains hitter and pitcher inputs for the model.
     */
    process(rawData, existingStats = {}) {
        const normalized = this.providerAdapter.normalize(rawData);
        return this.inputAdapter.adapt(normalized, existingStats);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MlbProviderAdapter,
        ModelInputAdapter,
        LiveModelPipeline
    };
}
