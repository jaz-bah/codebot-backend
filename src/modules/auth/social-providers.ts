import { AppConfig } from '../../config/configuration';

/**
 * Social providers (Google/GitHub) are registered only when BOTH id and
 * secret are present, so envs without OAuth creds keep the instance
 * email-only (PRD FR-3 / D5). Consumed by better-auth.instance.ts.
 */
export function buildSocialProviders(oauth: AppConfig['oauth']): {
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
} {
  const providers: {
    google?: { clientId: string; clientSecret: string };
    github?: { clientId: string; clientSecret: string };
  } = {};

  if (oauth.googleClientId && oauth.googleClientSecret) {
    providers.google = {
      clientId: oauth.googleClientId,
      clientSecret: oauth.googleClientSecret,
    };
  }
  if (oauth.githubClientId && oauth.githubClientSecret) {
    providers.github = {
      clientId: oauth.githubClientId,
      clientSecret: oauth.githubClientSecret,
    };
  }

  return providers;
}
