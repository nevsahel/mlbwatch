'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Games', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      providerId: {
        type: Sequelize.STRING
      },
      venueId: {
        type: Sequelize.UUID
      },
      homeTeamId: {
        type: Sequelize.UUID
      },
      awayTeamId: {
        type: Sequelize.UUID
      },
      status: {
        type: Sequelize.STRING
      },
      scheduledStart: {
        type: Sequelize.DATE
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
    await queryInterface.dropTable('Games');
  }
};