export interface MailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface OAuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  githubClientId: string;
  githubClientSecret: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  appUrl: string;
  // Where users land after auth (frontend origin). Separate from appUrl, which
  // must stay on the backend (OAuth redirect_uri, mail links, baseURL).
  frontendUrl: string;
  databaseUrl: string;
  betterAuthSecret: string;
  corsOriginUrls: string[];
  adminEmails: string[];
  smtp: MailConfig;
  oauth: OAuthConfig;
  throttle: { ttlMs: number; limit: number };
  settings: { encryptionKey: string };
}

/** Typed configuration factory loaded once by ConfigModule. */
export const configuration = (): AppConfig => {
  const env = process.env;
  return {
    nodeEnv: (env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
    port: Number(env.PORT ?? 3000),
    appUrl: env.APP_URL ?? 'http://localhost:3000',
    frontendUrl: env.FRONTEND_URL ?? 'http://localhost:5173',
    databaseUrl: env.DATABASE_URL ?? '',
    betterAuthSecret: env.BETTER_AUTH_SECRET ?? '',
    corsOriginUrls: (env.CORS_ORIGIN_URLS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adminEmails: (env.ADMIN_EMAIL ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    smtp: {
      host: env.SMTP_HOST ?? '',
      port: Number(env.SMTP_PORT ?? 587),
      user: env.SMTP_USER ?? '',
      pass: env.SMTP_PASS ?? '',
      from: env.SMTP_FROM ?? '',
    },
    oauth: {
      googleClientId: env.GOOGLE_CLIENT_ID ?? '',
      googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
      githubClientId: env.GITHUB_CLIENT_ID ?? '',
      githubClientSecret: env.GITHUB_CLIENT_SECRET ?? '',
    },
    throttle: {
      ttlMs: Number(env.THROTTLE_TTL_MS ?? 60000),
      limit: Number(env.THROTTLE_LIMIT ?? 100),
    },
    // User-settings credential encryption. Falls back to a key derived from
    // BETTER_AUTH_SECRET when unset (see settings-cipher.ts).
    settings: {
      encryptionKey: env.SETTINGS_ENCRYPTION_KEY ?? '',
    },
  };
};
