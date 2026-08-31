'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class TeamStatistic extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      TeamStatistic.belongsTo(models.Team, { foreignKey: 'teamId', as: 'team' });
      TeamStatistic.belongsTo(models.Game, { foreignKey: 'gameId', as: 'game' });
    }
  }
  TeamStatistic.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    teamId: DataTypes.UUID,
    gameId: DataTypes.UUID,
    category: DataTypes.STRING,
    value: DataTypes.FLOAT
  }, {
    sequelize,
    modelName: 'TeamStatistic',
  });
  return TeamStatistic;
};