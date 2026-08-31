const config = require('../src/config/env');

describe('Configuration', () => {
  it('should export env, port, and isDevelopment properties', () => {
    expect(config).toHaveProperty('env');
    expect(config).toHaveProperty('port');
    expect(config).toHaveProperty('isDevelopment');
  });
});
