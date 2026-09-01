const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/__tests__/database.test.js');
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/afterAll\(async \(\) => \{\n    await sequelize.close\(\);\n  \}\);\n\ndescribe\('Database Idempotency', \(\) => \{\n  beforeAll\(async \(\) => \{\n    await sequelize.sync\(\{ force: true \}\);\n  \}\);\n\n  afterAll\(async \(\) => \{\n    await sequelize.close\(\);\n  \}\);/, `describe('Database Idempotency', () => {`);
content = content.replace(/describe\('Database Idempotency', \(\) => \{/, `  test('GameEvent enforces unique providerEventId constraint', async () => {
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
  });`);
// Let's rewrite the file entirely to be safe
