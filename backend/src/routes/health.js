const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/database', (req, res) => {
  res.status(503).json({ status: 'unavailable', message: 'Database check not yet implemented.' });
});

module.exports = router;
