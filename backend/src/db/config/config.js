require('dotenv').config({ path: require('path').resolve(__dirname, '../../../../.env') });

module.exports = {
  development: {
    dialect: process.env.DB_DIALECT || 'sqlite',
    storage: process.env.DB_STORAGE || './backend/database.sqlite',
    logging: false
  },
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false
  },
  production: {
    dialect: process.env.DB_DIALECT || 'sqlite',
    storage: process.env.DB_STORAGE || './backend/database.sqlite',
    logging: false
  }
};
