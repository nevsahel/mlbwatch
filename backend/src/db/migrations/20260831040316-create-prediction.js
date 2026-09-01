'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Predictions', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      gameId: {
        type: Sequelize.UUID
      },
      modelVersion: {
        type: Sequelize.STRING
      },
      timestamp: {
        type: Sequelize.DATE
      },
      eventId: {
        type: Sequelize.UUID
      },
      modelOutput: {
        type: Sequelize.JSON
      },
      probabilities: {
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
    await queryInterface.dropTable('Predictions');
  }
};