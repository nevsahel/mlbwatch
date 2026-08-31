const request = require('supertest');
const express = require('express');
const errorHandler = require('../src/middleware/errorHandler');

describe('Error Handling Middleware', () => {
  let app;

  beforeAll(() => {
    // Silence console.error for tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    console.error.mockRestore();
  });

  beforeEach(() => {
    app = express();

    app.get('/error', (req, res, next) => {
      const err = new Error('Test Error');
      err.statusCode = 400;
      next(err);
    });

    app.get('/unhandled', (req, res, next) => {
      const err = new Error('Unhandled Error');
      next(err);
    });

    app.use(errorHandler);
  });

  it('should handle custom status codes and messages', async () => {
    const res = await request(app).get('/error');
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toHaveProperty('message', 'Test Error');
  });

  it('should fallback to 500 status code', async () => {
    const res = await request(app).get('/unhandled');
    expect(res.statusCode).toEqual(500);
    expect(res.body.error).toHaveProperty('message', 'Unhandled Error');
  });
});
