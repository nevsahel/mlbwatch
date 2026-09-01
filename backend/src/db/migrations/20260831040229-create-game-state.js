'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('GameStates', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      gameId: {
        type: Sequelize.UUID
      },
      scoreHome: {
        type: Sequelize.INTEGER
      },
      scoreAway: {
        type: Sequelize.INTEGER
      },
      inning: {
        type: Sequelize.INTEGER
      },
      inningHalf: {
        type: Sequelize.STRING
      },
      outs: {
        type: Sequelize.INTEGER
      },
      balls: {
        type: Sequelize.INTEGER
      },
      strikes: {
        type: Sequelize.INTEGER
      },
      currentBatterId: {
        type: Sequelize.UUID
      },
      currentPitcherId: {
        type: Sequelize.UUID
      },
      runnerOnFirstId: {
        type: Sequelize.UUID
      },
      runnerOnSecondId: {
        type: Sequelize.UUID
      },
      runnerOnThirdId: {
        type: Sequelize.UUID
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('GameStates');
  }
};