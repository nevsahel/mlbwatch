'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class GameEvent extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      GameEvent.belongsTo(models.Game, { foreignKey: 'gameId', as: 'game' });
      GameEvent.hasOne(models.Prediction, { foreignKey: 'eventId', as: 'prediction' });
    }
  }
  GameEvent.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    providerEventId: {
      type: DataTypes.STRING,
      unique: true
    },
    gameId: DataTypes.UUID,
    type: DataTypes.STRING,
    timestamp: DataTypes.DATE,
    inning: DataTypes.INTEGER,
    description: DataTypes.TEXT,
    relevantPlayers: DataTypes.JSON,
    relevantTeams: DataTypes.JSON
  }, {
    sequelize,
    modelName: 'GameEvent',
  });
  return GameEvent;
};