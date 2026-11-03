import {
  buildUsernameBase,
  ensureUniqueUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '../src/modules/auth/username-generator';

/**
 * Unit tests for the auto-username recipe — deterministic base derivation
 * (email → name → fallback, sanitized to the BetterAuth username plugin's
 * rule) and DB-backed uniqueness (first FREE candidate wins, suffix draws
 * after).
 */

/** Kysely-shaped fake: select('username').where('username', 'in', x).execute(). */
const dbWithTaken = (taken: string[], rows?: string[]) => ({
  selectFrom: () => ({
    select: () => ({
      where: (_col: string, _op: string, values: string[]) => ({
        execute: async () => (rows ?? taken.filter((t) => values.includes(t))).map((u) => ({ username: u })),
      }),
    }),
  }),
});

describe('buildUsernameBase', () => {
  it('derives the handle from the email local-part', () => {
    expect(buildUsernameBase({ email: 'john.doe@example.com', name: 'John Doe' })).toBe('john.doe');
  });

  it('falls back to the display name when no email is given', () => {
    expect(buildUsernameBase({ name: 'Jane Doe' })).toBe('jane_doe');
  });

  it('squashes runs of disallowed characters and trims edges', () => {
    expect(buildUsernameBase({ name: '!!A..B@@@!c' })).toBe('a..b_c');
    expect(buildUsernameBase({ name: '---___---' })).toBe('user');
  });

  it('pads handles that would start shorter than the plugin minimum', () => {
    const base = buildUsernameBase({ email: 'a@b.com' });
    expect(base.length).toBeGreaterThanOrEqual(USERNAME_MIN_LENGTH);
    expect(USERNAME_PATTERN.test(base)).toBe(true);
    expect(buildUsernameBase({ name: 'z' })).toBe('user_z');
  });

  it('truncates to the plugin maximum (30 chars)', () => {
    const longEmail = `${'x'.repeat(60)}@example.com`;
    expect(buildUsernameBase({ email: longEmail }).length).toBe(USERNAME_MAX_LENGTH);
    expect(USERNAME_PATTERN.test(buildUsernameBase({ email: longEmail }))).toBe(true);
  });

  it('handles completely unusable input', () => {
    expect(buildUsernameBase({})).toBe('user');
  });
});

describe('ensureUniqueUsername', () => {
  it('returns the clean base when it is free', async () => {
    const db = dbWithTaken(['someone-else']);
    expect(await ensureUniqueUsername(db as never, { email: 'jane@x.io' })).toBe('jane');
  });

  it('falls back to a plugin-pattern suffix when the base is taken', async () => {
    const db = dbWithTaken(['jane']);
    const name = await ensureUniqueUsername(db as never, { email: 'jane@x.io' });
    expect(name).toMatch(/^jane_[a-z2-9]{3}$/);
    expect(USERNAME_PATTERN.test(name)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
  });

  it('returns a value from its own candidate list (never falls back off-pattern)', async () => {
    let candidates: string[] = [];
    const db = {
      selectFrom: () => ({
        select: () => ({
          where: (_col: string, _op: string, values: string[]) => ({
            execute: async () => {
              candidates = values;
              return [{ username: values[0] }]; // base taken, suffixes free
            },
          }),
        }),
      }),
    };
    const name = await ensureUniqueUsername(db as never, { email: 'jane@x.io' });
    expect(candidates).toContain(name);
    expect(USERNAME_PATTERN.test(name)).toBe(true);
  });

  it('truncates the base so base + suffix stays within 30 chars', async () => {
    const long = 'x'.repeat(28);
    const db = dbWithTaken([long]);
    const name = await ensureUniqueUsername(db as never, { email: `${long}@x.io` });
    expect(USERNAME_PATTERN.test(name)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
  });

  it('rejects when every attempt collides (caller decides fail-safe)', async () => {
    // Whatever candidates the generator draws, the DB reports ALL of them taken.
    const dbAllTaken = {
      selectFrom: () => ({
        select: () => ({
          where: (_col: string, _op: string, values: string[]) => ({
            execute: async () => values.map((u) => ({ username: u })),
          }),
        }),
      }),
    };
    await expect(ensureUniqueUsername(dbAllTaken as never, { email: 'jane@x.io' })).rejects.toThrow(
      /unique username/,
    );
  });
});
