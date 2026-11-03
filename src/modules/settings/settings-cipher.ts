import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { AppConfig } from '../../config/configuration';

/** Prefix stamped on every encrypted payload, so rotation is detectable. */
const CIPHER_PREFIX = 'enc:v1';

/** Deterministic scrypt salt for this feature's key derivation. */
const KEY_SALT = 'codebot:settings:cipher:v1';

export interface SecretCipher {
  /** AES-256-GCM encrypt → `enc:v1:{iv}:{tag}:{ciphertext}`. */
  encrypt(plaintext: string): string;
  /**
   * Decrypt an `enc:v1:` payload. Non-prefixed payloads pass through unchanged
   * (defensive fallback); payloads that fail to decrypt (rotated/corrupt)
   * return null so callers treat the value as unset.
   */
  decrypt(payload: string | null | undefined): string | null;
  /** API-safe masked preview: `sk-…f3ak`; short values → `••••`; null-safe. */
  mask(plaintext: string | null | undefined): string | null;
}

/**
 * Creates the settings cipher. Key material: `SETTINGS_ENCRYPTION_KEY` when
 * provided, otherwise derived deterministically from the required
 * `BETTER_AUTH_SECRET` (zero-configuration dev default — set an explicit key
 * before production secret storage matters).
 */
export const createSecretCipher = (appConfig: {
  settings: { encryptionKey: string };
  betterAuthSecret: string;
}): SecretCipher => {
  const material = appConfig.settings.encryptionKey || appConfig.betterAuthSecret;
  const key = scryptSync(material, KEY_SALT, 32);

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [
        CIPHER_PREFIX,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        ciphertext.toString('base64'),
      ].join(':');
    },
    decrypt(payload: string | null | undefined): string | null {
      if (!payload) return null;
      if (!payload.startsWith(`${CIPHER_PREFIX}:`)) return payload;
      try {
        const parts = payload.split(':');
        const iv = Buffer.from(parts[2], 'base64');
        const tag = Buffer.from(parts[3], 'base64');
        const ciphertext = Buffer.from(parts[4], 'base64');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        return null; // rotated key or corrupt payload → treat as unset
      }
    },
    mask(plaintext: string | null | undefined): string | null {
      if (!plaintext) return null;
      if (plaintext.length <= 8) return '••••';
      return `${plaintext.slice(0, 3)}…${plaintext.slice(-4)}`;
    },
  };
};

/** The fields stored encrypted at rest (everything except cloud name). */
export const SECRET_SETTING_FIELDS = [
  'openRouterApiKey',
  'cloudinaryApiKey',
  'cloudinaryApiSecret',
] as const;

export const isSecretSettingField = (field: string): boolean =>
  (SECRET_SETTING_FIELDS as readonly string[]).includes(field);

/** Placeholder used to keep imports honest where AppConfig shape is needed. */
export type SettingsCipherConfig = Pick<AppConfig, 'settings' | 'betterAuthSecret'>;
