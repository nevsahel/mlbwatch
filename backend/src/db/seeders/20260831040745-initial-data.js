'use strict';
const { v4: uuidv4 } = require('uuid');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const venueId = uuidv4();
    const yankeesId = uuidv4();
    const redSoxId = uuidv4();
    const gameId = uuidv4();

    await queryInterface.bulkInsert('Venues', [{
      id: venueId,
      providerId: 'v-1',
      name: 'Yankee Stadium',
      city: 'Bronx',
      state: 'NY',
      createdAt: new Date(),
      updatedAt: new Date()
    }], {});

    await queryInterface.bulkInsert('Teams', [
      {
        id: yankeesId,
        providerId: 't-147',
        name: 'New York Yankees',
        abbreviation: 'NYY',
        locationName: 'Bronx',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: redSoxId,
        providerId: 't-111',
        name: 'Boston Red Sox',
        abbreviation: 'BOS',
        locationName: 'Boston',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});

    await queryInterface.bulkInsert('Players', [
      {
        id: uuidv4(),
        providerId: 'p-1',
        firstName: 'Aaron',
        lastName: 'Judge',
        fullName: 'Aaron Judge',
        position: 'RF',
        teamId: yankeesId,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: uuidv4(),
        providerId: 'p-2',
        firstName: 'Rafael',
        lastName: 'Devers',
        fullName: 'Rafael Devers',
        position: '3B',
        teamId: redSoxId,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});

    await queryInterface.bulkInsert('Games', [{
      id: gameId,
      providerId: 'g-1',
      venueId: venueId,
      homeTeamId: yankeesId,
      awayTeamId: redSoxId,
      status: 'Scheduled',
      scheduledStart: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('Games', null, {});
    await queryInterface.bulkDelete('Players', null, {});
    await queryInterface.bulkDelete('Teams', null, {});
    await queryInterface.bulkDelete('Venues', null, {});
  }
};
