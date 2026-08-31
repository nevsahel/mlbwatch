'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class PlayerStatistic extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      PlayerStatistic.belongsTo(models.Player, { foreignKey: 'playerId', as: 'player' });
      PlayerStatistic.belongsTo(models.Game, { foreignKey: 'gameId', as: 'game' });
    }
  }
  PlayerStatistic.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    playerId: DataTypes.UUID,
    gameId: DataTypes.UUID,
    category: DataTypes.STRING,
    value: DataTypes.FLOAT
  }, {
    sequelize,
    modelName: 'PlayerStatistic',
  });
  return PlayerStatistic;
};