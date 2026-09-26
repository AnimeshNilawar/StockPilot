const request = require('supertest');
const app = require('../src/app');

describe('API Health Check', () => {
  it('GET /api/v1/health should return 200 and success status', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'ok',
      },
    });
  });

  it('GET /api/v1/unknown-route should return 404', async () => {
    const response = await request(app).get('/api/v1/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: 'Route not found',
      code: 'NOT_FOUND',
    });
  });
});
