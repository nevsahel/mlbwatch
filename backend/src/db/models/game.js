'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Game extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Game.belongsTo(models.Venue, { foreignKey: 'venueId', as: 'venue' });
      Game.belongsTo(models.Team, { foreignKey: 'homeTeamId', as: 'homeTeam' });
      Game.belongsTo(models.Team, { foreignKey: 'awayTeamId', as: 'awayTeam' });
      Game.hasOne(models.GameState, { foreignKey: 'gameId', as: 'gameState' });
      Game.hasMany(models.GameEvent, { foreignKey: 'gameId', as: 'events' });
      Game.hasMany(models.Lineup, { foreignKey: 'gameId', as: 'lineups' });
      Game.hasMany(models.PlayerStatistic, { foreignKey: 'gameId', as: 'playerStats' });
      Game.hasMany(models.TeamStatistic, { foreignKey: 'gameId', as: 'teamStats' });
      Game.hasMany(models.Prediction, { foreignKey: 'gameId', as: 'predictions' });
    }
  }
  Game.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    providerId: DataTypes.STRING,
    venueId: DataTypes.UUID,
    homeTeamId: DataTypes.UUID,
    awayTeamId: DataTypes.UUID,
    status: DataTypes.STRING,
    scheduledStart: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'Game',
  });
  return Game;
};