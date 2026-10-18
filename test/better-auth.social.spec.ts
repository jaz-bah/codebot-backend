import { buildSocialProviders } from '../src/modules/auth/social-providers';
import { OAuthConfig } from '../src/config/configuration';

describe('buildSocialProviders (Phase 2)', () => {
  const oauth = (partial: Partial<OAuthConfig>): OAuthConfig => ({
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    ...partial,
  });

  it('registers google when both Google creds present', () => {
    const providers = buildSocialProviders(
      oauth({
        googleClientId: 'g-id.apps.googleusercontent.com',
        googleClientSecret: 'g-secret',
      }),
    );
    expect(providers.google).toEqual({
      clientId: 'g-id.apps.googleusercontent.com',
      clientSecret: 'g-secret',
    });
    expect(providers.github).toBeUndefined();
  });

  it('registers github when both GITHUB creds present', () => {
    const providers = buildSocialProviders(
      oauth({ githubClientId: 'gh-id', githubClientSecret: 'gh-secret' }),
    );
    expect(providers.github).toEqual({ clientId: 'gh-id', clientSecret: 'gh-secret' });
    expect(providers.google).toBeUndefined();
  });

  it('stays email-only when creds are missing/empty (dev default)', () => {
    expect(buildSocialProviders(oauth({}))).toEqual({});
  });

  it('requires BOTH id and secret — partial creds are ignored', () => {
    expect(
      buildSocialProviders(oauth({ googleClientId: 'only-id' })).google,
    ).toBeUndefined();
    expect(
      buildSocialProviders(oauth({ githubClientSecret: 'only-secret' })).github,
    ).toBeUndefined();
  });
});
