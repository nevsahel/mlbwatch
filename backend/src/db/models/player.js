'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Player extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Player.belongsTo(models.Team, { foreignKey: 'teamId', as: 'team' });
      Player.hasMany(models.Lineup, { foreignKey: 'playerId', as: 'lineups' });
      Player.hasMany(models.PlayerStatistic, { foreignKey: 'playerId', as: 'stats' });
    }
  }
  Player.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    providerId: DataTypes.STRING,
    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    fullName: DataTypes.STRING,
    position: DataTypes.STRING,
    teamId: DataTypes.UUID
  }, {
    sequelize,
    modelName: 'Player',
  });
  return Player;
};