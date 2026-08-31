'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Lineup extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Lineup.belongsTo(models.Game, { foreignKey: 'gameId', as: 'game' });
      Lineup.belongsTo(models.Team, { foreignKey: 'teamId', as: 'team' });
      Lineup.belongsTo(models.Player, { foreignKey: 'playerId', as: 'player' });
    }
  }
  Lineup.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    gameId: DataTypes.UUID,
    teamId: DataTypes.UUID,
    playerId: DataTypes.UUID,
    battingOrder: DataTypes.INTEGER,
    position: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Lineup',
  });
  return Lineup;
};