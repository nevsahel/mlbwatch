'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Team extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Team.hasMany(models.Player, { foreignKey: 'teamId', as: 'players' });
      Team.hasMany(models.Game, { foreignKey: 'homeTeamId', as: 'homeGames' });
      Team.hasMany(models.Game, { foreignKey: 'awayTeamId', as: 'awayGames' });
      Team.hasMany(models.Lineup, { foreignKey: 'teamId', as: 'lineups' });
      Team.hasMany(models.TeamStatistic, { foreignKey: 'teamId', as: 'teamStats' });
    }
  }
  Team.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    providerId: DataTypes.STRING,
    name: DataTypes.STRING,
    abbreviation: DataTypes.STRING,
    locationName: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Team',
  });
  return Team;
};