const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');

/**
 * CORS regression tests.
 *
 * The original config passed a bare string to `cors({ origin })`, which the
 * library echoes back unconditionally instead of comparing against the
 * request's `Origin`. The allow-list looked correct in review and every other
 * test passed, yet the SPA broke with an opaque "NetworkError" the moment it was
 * opened on any origin other than the configured one. These tests pin the
 * behaviour that actually matters to a browser.
 */
describe('CORS', () => {
  const preflight = (origin) =>
    request(app)
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

  it('reflects the configured frontend origin', async () => {
    const res = await preflight('http://localhost:5173');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('allows credentialed requests, which the refresh cookie requires', async () => {
    const res = await preflight('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('permits the custom headers the API uses', async () => {
    const res = await preflight('http://localhost:5173');
    const allowed = res.headers['access-control-allow-headers'].toLowerCase();
    expect(allowed).toContain('authorization');
    expect(allowed).toContain('idempotency-key');
    expect(allowed).toContain('content-type');
  });

  it('exposes Idempotent-Replay so the SPA can read it', async () => {
    const res = await preflight('http://localhost:5173');
    expect(res.headers['access-control-expose-headers'].toLowerCase()).toContain(
      'idempotent-replay',
    );
  });

  // 127.0.0.1 and localhost are different origins to a browser even though they
  // resolve to the same host, and this is how the app is usually opened.
  it('allows a loopback alias in development', async () => {
    const res = await preflight('http://127.0.0.1:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });

  it('allows a private LAN address in development', async () => {
    const res = await preflight('http://192.168.1.7:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://192.168.1.7:5173');
  });

  it('omits the allow header for an unrelated public origin', async () => {
    const res = await preflight('https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not treat a public host that merely contains an allowed one as allowed', async () => {
    const res = await preflight('https://localhost:5173.evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('tolerates a trailing slash on the origin', async () => {
    const res = await preflight('http://localhost:5173/');
    // Allowed, though the header echoes the origin exactly as the browser sent
    // it. Real browsers never include the trailing slash.
    expect(res.headers['access-control-allow-origin']).toBeTruthy();
  });

  it('still serves non-browser callers that send no Origin', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('exposes every replay header the controllers actually emit', () => {
    // The exposed list and the controllers drifted apart once: receipts and
    // deliveries emitted `Idempotent-Replayed` while only `Idempotent-Replay` was
    // exposed, so a browser was blocked from reading the very header that tells
    // the SPA a request was a replay. Asserting the config on its own cannot catch
    // that, because the config is self-consistent either way.
    const { exposedHeaders } = require('../src/config/cors').corsOptions;
    const dir = path.join(__dirname, '..', 'src', 'controllers');
    const emitted = new Set();

    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const [, name] of source.matchAll(/res\.set\('(Idempotent-[^']+)'/g)) {
        emitted.add(name);
      }
    }

    expect(emitted.size).toBeGreaterThan(0);
    for (const name of emitted) {
      expect(exposedHeaders).toContain(name);
    }
  });
});
