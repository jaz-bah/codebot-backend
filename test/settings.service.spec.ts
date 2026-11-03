import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * SettingsService unit tests against a hand-rolled DataSource stub (same
 * style as the todos/… service specs) — verifies singleton upsert scoping,
 * encryption-at-rest boundaries, masked views and the never-return-plaintext
 * contract, without a real DB.
 */

interface SettingLike {
  id?: string;
  userId: string;
  openRouterApiKey: string | null;
  cloudinaryCloudName: string | null;
  cloudinaryApiKey: string | null;
  cloudinaryApiSecret: string | null;
  [k: string]: unknown;
}

class FakeRepo {
  settings: SettingLike[] = [];
  failNextCreate = false;
  saved: unknown[] = [];
  deletes: unknown[] = [];

  getRepository(): FakeRepo {
    return this;
  }
  async findOneBy(criteria: Partial<SettingLike>): Promise<SettingLike | undefined> {
    return this.settings.find((s) => s.userId === criteria.userId);
  }
  create(input: Partial<SettingLike>): SettingLike {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      // Simulate the DB rejecting the concurrent duplicate insert.
      throw new Error('duplicate key value violates unique constraint "idx_setting_user_id"');
    }
    return { ...(input as SettingLike) };
  }
  async save(input: SettingLike): Promise<SettingLike> {
    if (!input.id) {
      // Initial insert path (save of a created row without an id).
      input.id = `gen-${this.settings.length + 1}`;
      input.createdAt = new Date();
      input.updatedAt = new Date();
      this.settings.push(input);
    } else {
      input.updatedAt = new Date();
    }
    this.saved.push({ ...input });
    return input;
  }
  async delete(criteria: unknown): Promise<{ affected: number }> {
    const c = criteria as { userId?: string };
    const before = this.settings.length;
    this.settings = this.settings.filter((s) => s.userId !== c.userId);
    this.deletes.push(criteria);
    return { affected: before - this.settings.length };
  }
}

const APP_CONFIG_LIKE = {
  settings: { encryptionKey: 'unit-test-encryption-key-32b!!' },
  betterAuthSecret: 'unit-better-auth-secret'.repeat(3),
};

const makeService = (repo: FakeRepo) =>
  new SettingsService(
    {
      isInitialized: true,
      initialize: async () => undefined,
      getRepository: () => repo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transaction: async (fn: any) => fn(repo),
    } as never,
    APP_CONFIG_LIKE as never,
  );

const KEY_A = 'unitsk-or-v1-1111222233334444';
const KEY_B = 'cloudinary-key-7777888899990000';
const SECRET_C = 'cloudinary-api-secret-aaaa4444bbbb8888';

describe('SettingsService — singleton upsert (scoped by userId)', () => {
  it('creates the singleton row on first update and stores ENCRYPTED values', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    const view = await svc.update('u1', {
      openRouterApiKey: KEY_A,
      cloudinaryCloudName: 'my-cloud',
      cloudinaryApiKey: KEY_B,
      cloudinaryApiSecret: SECRET_C,
    } as never);

    expect(repo.settings).toHaveLength(1);
    const row = repo.settings[0];
    expect(row.userId).toBe('u1');
    // Encrypted at rest — no plaintext anywhere in the stored row.
    const storedJson = JSON.stringify(row);
    expect(storedJson.includes(KEY_A)).toBe(false);
    expect(storedJson.includes(KEY_B)).toBe(false);
    expect(storedJson.includes(SECRET_C)).toBe(false);
    expect(row.openRouterApiKey).toMatch(/^enc:v1:/);
    expect(row.cloudinaryApiKey).toMatch(/^enc:v1:/);
    // Cloud name is not secret → plain text at rest.
    expect(row.cloudinaryCloudName).toBe('my-cloud');
    // API response: masked, never plaintext.
    const viewJson = JSON.stringify(view);
    expect(viewJson.includes(KEY_A)).toBe(false);
    expect(viewJson.includes(KEY_B)).toBe(false);
    expect(viewJson.includes(SECRET_C)).toBe(false);
    expect(view.openRouterApiKey).toMatch(/^uni…4444$/);
    expect(view.cloudinaryCloudName).toBe('my-cloud');
  });

  it('upserts the SAME row on subsequent updates (no duplicates)', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    await svc.update('u1', { openRouterApiKey: KEY_A } as never);
    await svc.update('u1', { cloudinaryCloudName: 'second-cloud' } as never);

    expect(repo.settings).toHaveLength(1);
    const view = await svc.getSettingsView('u1');
    expect(view.cloudinaryCloudName).toBe('second-cloud');
    // The first patch persisted (partial update semantics).
    expect(view.openRouterApiKey).toMatch(/…4444/);
  });

  it('handles the concurrent first-create race (unique violation → reload + update)', async () => {
    const repo = new FakeRepo();
    // Pre-seed the row that "another transaction" just inserted (with id + fields).
    repo.settings.push({
      id: 'race-existing',
      userId: 'u1',
      openRouterApiKey: null,
      cloudinaryCloudName: null,
      cloudinaryApiKey: null,
      cloudinaryApiSecret: null,
    });
    repo.failNextCreate = true;
    const svc = makeService(repo);
    const view = await svc.update('u1', { cloudinaryCloudName: 'racy' } as never);
    expect(view.cloudinaryCloudName).toBe('racy');
    expect(repo.settings.filter((s) => s.userId === 'u1')).toHaveLength(1);
  });

  it('empty patch → 400', async () => {
    const svc = makeService(new FakeRepo());
    await expect(svc.update('u1', {} as never)).rejects.toMatchObject({ status: 400 });
  });

  it('explicit null clears a stored credential (others survive)', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    await svc.update('u1', { openRouterApiKey: KEY_A, cloudinaryApiKey: KEY_B } as never);
    const view = await svc.update('u1', { openRouterApiKey: null } as never);
    expect(view.openRouterApiKey).toBeNull();
    expect(view.cloudinaryApiKey).toMatch(/…0000|…/);
    const row = repo.settings[0];
    expect(row.openRouterApiKey).toBeNull();
  });
});

describe('SettingsService — views and internal decryption', () => {
  const dto = {
    openRouterApiKey: KEY_A,
    cloudinaryCloudName: 'my-cloud',
    cloudinaryApiKey: KEY_B,
    cloudinaryApiSecret: SECRET_C,
  };

  it('view masks configured secrets; nulls when unset', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    const emptyView = await svc.getSettingsView('u1');
    expect(emptyView).toMatchObject({
      openRouterApiKey: null,
      cloudinaryCloudName: null,
      cloudinaryApiKey: null,
      cloudinaryApiSecret: null,
      updatedAt: null,
    });

    await svc.update('u1', dto as never);
    const view = await svc.getSettingsView('u1');
    expect(view.openRouterApiKey).toBe('uni…4444');
    expect(view.updatedAt).toBeInstanceOf(Date);
  });

  it('internal decryption (future server-side use) returns plaintext masked only internally', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    await svc.update('u1', dto as never);
    const internal = await svc.getDecryptedSettings('u1');
    expect(internal.openRouterApiKey).toBe(KEY_A);
    expect(internal.cloudinaryApiKey).toBe(KEY_B);
    expect(internal.cloudinaryApiSecret).toBe(SECRET_C);
    expect(internal.cloudinaryCloudName).toBe('my-cloud');
  });

  it('scopes every read/write by userId (isolation)', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    await svc.update('u1', { openRouterApiKey: KEY_A } as never);
    const other = await svc.getSettingsView('u2');
    expect(other.openRouterApiKey).toBeNull();
    // The internal hook is scoped too.
    await expect(svc.getDecryptedSettings('u2').then((s) => s.openRouterApiKey)).resolves.toBeNull();
  });
});

describe('SettingsService — getCloudinaryCredentials (internal consumption)', () => {
  it('returns the decrypted trio only when ALL three values are configured', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    // Nothing configured → null
    await expect(svc.getCloudinaryCredentials('u1')).resolves.toBeNull();
    // Partial config (no api secret) → null
    await svc.update('u1', { cloudinaryCloudName: 'my-cloud', cloudinaryApiKey: KEY_B } as never);
    await expect(svc.getCloudinaryCredentials('u1')).resolves.toBeNull();
    // Complete → decrypted plaintext trio (for the uploads module)
    await svc.update('u1', { cloudinaryApiSecret: SECRET_C } as never);
    await expect(svc.getCloudinaryCredentials('u1')).resolves.toEqual({
      cloudName: 'my-cloud',
      apiKey: KEY_B,
      apiSecret: SECRET_C,
    });
  });
});

describe('SettingsService — reset', () => {
  it('deletes the singleton row scoped by userId', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    await svc.update('u1', { openRouterApiKey: KEY_A } as never);
    const result = await svc.reset('u1');
    expect(result).toEqual({ reset: true });
    expect(repo.deletes).toContainEqual({ userId: 'u1' });
    const view = await svc.getSettingsView('u1');
    expect(view.openRouterApiKey).toBeNull();
  });

  it('reset of another user\u2019s data removes nothing', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    await svc.update('u1', { openRouterApiKey: KEY_A } as never);
    await svc.reset('u2');
    expect(await svc.getSettingsView('u1').then((v) => v.openRouterApiKey)).toMatch(/…4444$/);
  });
});
