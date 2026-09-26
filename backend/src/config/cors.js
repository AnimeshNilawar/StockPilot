/**
 * CORS origin policy.
 *
 * The `cors` package treats a plain string `origin` as a value to echo back
 * verbatim: it never compares it against the incoming `Origin` header. That
 * looks like an allow-list but is not one — every response carries the same
 * `Access-Control-Allow-Origin`, so the browser rejects the response the moment
 * the SPA is opened on any other origin (`127.0.0.1` instead of `localhost`, a
 * LAN address, a tunnel). The only symptom is an opaque
 * "NetworkError when attempting to fetch resource" in the console.
 *
 * So the decision is made here, per request, and a disallowed origin is answered
 * without the allow header rather than with a 500.
 */
const { env } = require('../config/env');

/** Loopback and private-range hosts are fine in development, any port. */
const LOCAL_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/;

const parseOrigins = (value) =>
  (value || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const configuredOrigins = [
  ...new Set(
    [env.FRONTEND_URL, ...parseOrigins(env.FRONTEND_URLS)].map((o) => o.replace(/\/+$/, '')),
  ),
];

const isAllowed = (origin) => {
  if (!origin) return true; // curl, health checks and other non-browser callers
  const candidate = origin.replace(/\/+$/, '');
  if (configuredOrigins.includes(candidate)) return true;
  if (env.NODE_ENV === 'production') return false;

  // Local development: any port on a loopback or private address, so `127.0.0.1`,
  // the LAN IP, and the Vite preview port all work without reconfiguring.
  try {
    return LOCAL_HOST.test(new URL(candidate).hostname);
  } catch {
    return false;
  }
};

const corsOptions = {
  origin(origin, callback) {
    // `false` omits the header, which is how CORS says "denied". Throwing here
    // would surface as a 500 and tell the caller nothing useful.
    callback(null, isAllowed(origin));
  },
  credentials: true, // required for the httpOnly refresh cookie
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  exposedHeaders: ['Idempotent-Replay'],
  maxAge: 600,
  optionsSuccessStatus: 204,
};

module.exports = { corsOptions, isAllowed, configuredOrigins, LOCAL_HOST };
