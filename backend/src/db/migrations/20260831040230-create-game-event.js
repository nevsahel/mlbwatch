'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('GameEvents', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      providerEventId: {
        type: Sequelize.STRING,
        unique: true
      },
      gameId: {
        type: Sequelize.UUID
      },
      type: {
        type: Sequelize.STRING
      },
      timestamp: {
        type: Sequelize.DATE
      },
      inning: {
        type: Sequelize.INTEGER
      },
      description: {
        type: Sequelize.TEXT
      },
      relevantPlayers: {
        type: Sequelize.JSON
      },
      relevantTeams: {
        type: Sequelize.JSON
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
    await queryInterface.dropTable('GameEvents');
  }
};