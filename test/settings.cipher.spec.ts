import { createSecretCipher } from '../src/modules/settings/settings-cipher';

const cfgWithKey = (key: string) => ({ settings: { encryptionKey: key }, betterAuthSecret: 'fallback-secret'.repeat(5) });

describe('settings cipher — encrypt/decrypt round trip (AES-256-GCM)', () => {
  it('round-trips plaintext exactly (code-safe characters preserved)', () => {
    const cipher = createSecretCipher(cfgWithKey('k'.repeat(48)));
    const plain = 'sk-or-v1-Ab$1C_ø/== special';
    const encrypted = cipher.encrypt(plain);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(cipher.decrypt(encrypted)).toBe(plain);
  });

  it('produces non-deterministic ciphertexts (random IV per call)', () => {
    const cipher = createSecretCipher(cfgWithKey('k'.repeat(48)));
    const a = cipher.encrypt('same-plaintext');
    const b = cipher.encrypt('same-plaintext');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same-plaintext');
    expect(cipher.decrypt(b)).toBe('same-plaintext');
  });

  it('never stores plaintext in the encrypted payload', () => {
    const cipher = createSecretCipher(cfgWithKey('k'.repeat(48)));
    const encrypted = cipher.encrypt('openrouter-super-secret-key');
    expect(encrypted.includes('openrouter')).toBe(false);
  });
});

describe('settings cipher — key handling', () => {
  it('derives from BETTER_AUTH_SECRET when no explicit key is set (dev fallback)', () => {
    const secret = 'shared-better-auth-secret-value';
    const a = createSecretCipher({ settings: { encryptionKey: '' }, betterAuthSecret: secret });
    const b = createSecretCipher({ settings: { encryptionKey: '' }, betterAuthSecret: secret });
    const payload = a.encrypt('hello');
    expect(b.decrypt(payload)).toBe('hello');
  });

  it('an explicit SETTINGS_ENCRYPTION_KEY wins over the fallback derivation (different material → null)', () => {
    const withExplicit = createSecretCipher({
      settings: { encryptionKey: 'explicit-key-32-chars-long!!!!' },
      betterAuthSecret: 'unrelated-better-auth-secret',
    });
    const withFallback = createSecretCipher({
      settings: { encryptionKey: '' },
      betterAuthSecret: 'unrelated-better-auth-secret',
    });
    const payload = withExplicit.encrypt('text');
    // Key material differs (explicit ≠ fallback secret) → cannot decrypt.
    expect(withFallback.decrypt(payload)).toBeNull();
    expect(withExplicit.decrypt(payload)).toBe('text');
  });

  it('another key cannot decrypt (returns null, treated as unset)', () => {
    const cipherA = createSecretCipher(cfgWithKey('a'.repeat(48)));
    const cipherB = createSecretCipher(cfgWithKey('b'.repeat(48)));
    const payload = cipherA.encrypt('secret');
    expect(cipherB.decrypt(payload)).toBeNull();
  });

  it('tampered payloads fail authentication and decrypt to null', () => {
    const cipher = createSecretCipher(cfgWithKey('k'.repeat(48)));
    const payload = cipher.encrypt('secret');
    const parts = payload.split(':');
    parts[4] = Buffer.from('tampered').toString('base64');
    expect(cipher.decrypt(parts.join(':'))).toBeNull();
  });

  it('non-prefixed payload passes through (defensive fallback)', () => {
    const cipher = createSecretCipher(cfgWithKey('k'.repeat(48)));
    expect(cipher.decrypt('legacy-plain')).toBe('legacy-plain');
    expect(cipher.decrypt(null)).toBeNull();
    expect(cipher.decrypt(undefined)).toBeNull();
  });
});

describe('settings cipher — masking', () => {
  const cipher = createSecretCipher(cfgWithKey('k'.repeat(48)));

  it('masks long secrets as first3…last4', () => {
    expect(cipher.mask('sk-or-v1-abcdefghijklmn')).toBe('sk-…klmn');
  });

  it('masks short secrets without leaking characters', () => {
    expect(cipher.mask('abcd1234')).toBe('••••');
    expect(cipher.mask('abc8')).toBe('••••');
  });

  it('null/empty → null', () => {
    expect(cipher.mask(null)).toBeNull();
    expect(cipher.mask(undefined)).toBeNull();
    expect(cipher.mask('')).toBeNull();
  });
});
