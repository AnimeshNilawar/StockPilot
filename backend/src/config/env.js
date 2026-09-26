const { z } = require('zod');
require('dotenv').config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  DATABASE_URL: z.string().url().optional(),
  // The canonical browser origin of the SPA.
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  // Extra browser origins, comma separated, for when the SPA is reached on
  // another hostname or IP (a LAN address, a tunnel, a preview domain).
  FRONTEND_URLS: z.string().optional(),

  // Password reset OTP delivery.
  OTP_DELIVERY_MODE: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_SECURE: z.string().transform((val) => val === 'true').default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('Invalid environment variables:', _env.error.format());
  process.exit(1);
}

module.exports = {
  env: _env.data,
};
