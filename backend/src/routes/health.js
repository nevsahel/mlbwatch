const express = require('express');
const router = express.Router();
const { sequelize } = require('../db/models');

router.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/database', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({ status: 'ok', message: 'Database connection has been established successfully.' });
  } catch (error) {
    res.status(503).json({ status: 'unavailable', message: 'Unable to connect to the database.', error: error.message });
  }
});

module.exports = router;
