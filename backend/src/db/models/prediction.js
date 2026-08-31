'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Prediction extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Prediction.belongsTo(models.Game, { foreignKey: 'gameId', as: 'game' });
      Prediction.belongsTo(models.GameEvent, { foreignKey: 'eventId', as: 'event' });
    }
  }
  Prediction.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    gameId: DataTypes.UUID,
    modelVersion: DataTypes.STRING,
    timestamp: DataTypes.DATE,
    eventId: DataTypes.UUID,
    modelOutput: DataTypes.JSON,
    probabilities: DataTypes.JSON
  }, {
    sequelize,
    modelName: 'Prediction',
  });
  return Prediction;
};