'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class GameState extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      GameState.belongsTo(models.Game, { foreignKey: 'gameId', as: 'game' });
      GameState.belongsTo(models.Player, { foreignKey: 'currentBatterId', as: 'currentBatter' });
      GameState.belongsTo(models.Player, { foreignKey: 'currentPitcherId', as: 'currentPitcher' });
      GameState.belongsTo(models.Player, { foreignKey: 'runnerOnFirstId', as: 'runnerOnFirst' });
      GameState.belongsTo(models.Player, { foreignKey: 'runnerOnSecondId', as: 'runnerOnSecond' });
      GameState.belongsTo(models.Player, { foreignKey: 'runnerOnThirdId', as: 'runnerOnThird' });
    }
  }
  GameState.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    gameId: DataTypes.UUID,
    scoreHome: DataTypes.INTEGER,
    scoreAway: DataTypes.INTEGER,
    inning: DataTypes.INTEGER,
    inningHalf: DataTypes.STRING,
    outs: DataTypes.INTEGER,
    balls: DataTypes.INTEGER,
    strikes: DataTypes.INTEGER,
    currentBatterId: DataTypes.UUID,
    currentPitcherId: DataTypes.UUID,
    runnerOnFirstId: DataTypes.UUID,
    runnerOnSecondId: DataTypes.UUID,
    runnerOnThirdId: DataTypes.UUID
  }, {
    sequelize,
    modelName: 'GameState',
  });
  return GameState;
};