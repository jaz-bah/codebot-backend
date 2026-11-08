import * as Joi from 'joi';

/**
 * Validates process env at boot. Fails fast — the process exits non-zero when
 * any required variable is missing or malformed (PRD FR-8).
 */
export const envValidationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  // Public base URL of THIS API (BetterAuth baseURL / OAuth issuer / mail links).
  // Must stay on the backend — Google's redirect_uri is registered against it.
  APP_URL: Joi.string().uri().required(),
  // Where users are redirected AFTER sign-in / verify / reset. Lives on the
  // frontend (vercel.app) — separate from APP_URL, which is the backend.
  // Without this, BetterAuth falls back to the baseURL origin and lands users
  // on the backend domain (the "redirected to backend URL" bug).
  FRONTEND_URL: Joi.string().uri().required(),

  // Database (Neon Postgres, pooled URL, SSL)
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  // BetterAuth
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  CORS_ORIGIN_URLS: Joi.string().default('http://localhost:5173'),

  // First-admin bootstrap
  ADMIN_EMAIL: Joi.string().allow('').default(''),

  // SMTP (optional in Phase 0; required from Phase 1 onwards at runtime of auth flows)
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().allow('').default(''),

  // OAuth (Phase 2 — optional until then)
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GITHUB_CLIENT_ID: Joi.string().allow('').default(''),
  GITHUB_CLIENT_SECRET: Joi.string().allow('').default(''),

  // Rate limiting (Phase 3)
  THROTTLE_TTL_MS: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(100),

  // User-settings credential encryption (optional — derived from
  // BETTER_AUTH_SECRET when unset; set an explicit key before production).
  SETTINGS_ENCRYPTION_KEY: Joi.string().allow('').default(''),
});
