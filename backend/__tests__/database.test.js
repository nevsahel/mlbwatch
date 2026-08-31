const { sequelize, Team, Player, Venue, Game, GameState, GameEvent, Lineup, PlayerStatistic, TeamStatistic, Prediction } = require('../src/db/models');

describe('Database Models', () => {
  beforeAll(async () => {
    // Synchronize models with the in-memory database
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('Database connection and model instantiation', async () => {
    await expect(sequelize.authenticate()).resolves.not.toThrow();

    expect(Team).toBeDefined();
    expect(Player).toBeDefined();
    expect(Venue).toBeDefined();
    expect(Game).toBeDefined();
    expect(GameState).toBeDefined();
    expect(GameEvent).toBeDefined();
    expect(Lineup).toBeDefined();
    expect(PlayerStatistic).toBeDefined();
    expect(TeamStatistic).toBeDefined();
    expect(Prediction).toBeDefined();
  });

  test('Core entities basic CRUD operations', async () => {
    const venue = await Venue.create({ name: 'Test Venue' });
    expect(venue.id).toBeDefined();
    expect(venue.name).toBe('Test Venue');

    const team = await Team.create({ name: 'Test Team' });
    expect(team.id).toBeDefined();

    const player = await Player.create({ firstName: 'John', lastName: 'Doe', teamId: team.id });
    expect(player.id).toBeDefined();
    expect(player.teamId).toBe(team.id);
  });

  test('GameEvent enforces unique providerEventId constraint', async () => {
    const game = await Game.create({ status: 'Live' });

    // First insertion should succeed
    const event1 = await GameEvent.create({
      providerEventId: 'event-123',
      gameId: game.id,
      type: 'strike'
    });

    expect(event1.id).toBeDefined();

    // Second insertion with same providerEventId should throw a UniqueConstraintError
    await expect(GameEvent.create({
      providerEventId: 'event-123',
      gameId: game.id,
      type: 'ball'
    })).rejects.toThrow();
  });
});
