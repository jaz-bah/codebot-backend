import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Setting } from '../../database/typeorm/entities/setting.entity';
import { APP_CONFIG } from '../../config/app-config.token';
import type { AppConfig } from '../../config/configuration';
import type { UpdateSettingsDto } from './dto/update-settings.dto';
import {
  createSecretCipher,
  isSecretSettingField,
  SecretCipher,
  SECRET_SETTING_FIELDS,
} from './settings-cipher';

/** DI token for the shared TypeORM DataSource (domain tables). */
export const SETTINGS_DATA_SOURCE = 'SETTINGS_DATA_SOURCE';

/**
 * API shape: secrets are masked previews (never plaintext), the non-secret
 * cloud name is returned as-is. Null ⇒ not configured.
 */
export interface SettingsView {
  openRouterApiKey: string | null;
  cloudinaryCloudName: string | null;
  cloudinaryApiKey: string | null;
  cloudinaryApiSecret: string | null;
  updatedAt: Date;
}

/** Server-internal decryption of every stored credential (never exposed via API). */
export interface DecryptedSettings {
  openRouterApiKey: string | null;
  cloudinaryCloudName: string | null;
  cloudinaryApiKey: string | null;
  cloudinaryApiSecret: string | null;
}

/**
 * Singleton settings row per user (unique index on user_id). Ownership is
 * enforced by scoping every read/write to the session user; secrets are
 * encrypted at rest and only ever leave this service masked.
 */
@Injectable()
export class SettingsService {
  private readonly cipher: SecretCipher;

  constructor(
    @Inject(SETTINGS_DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.cipher = createSecretCipher(appConfig);
  }

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  // ── READ (masked view) ─────────────────────────────────────────────────────

  async getSettingsView(userId: string): Promise<SettingsView> {
    const row = await (await this.ready())
      .getRepository(Setting)
      .findOneBy({ userId } as never);
    return this.toView(row);
  }

  // ── UPSERT (partial update, encrypted secrets) ──────────────────────────────

  async update(userId: string, dto: UpdateSettingsDto): Promise<SettingsView> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const ds = await this.ready();
    return ds.transaction<SettingsView>(async (em) => {
      const repo = em.getRepository(Setting);
      let row = await repo.findOneBy({ userId } as never);
      if (!row) {
        try {
          row = await repo.save(
            repo.create({
              userId,
              openRouterApiKey: null,
              cloudinaryCloudName: null,
              cloudinaryApiKey: null,
              cloudinaryApiSecret: null,
            } as never) as unknown as Setting,
          );
        } catch {
          // Lost a concurrent first-create race (unique user_id) → reload.
          row = await repo.findOneBy({ userId } as never);
          if (!row) throw new NotFoundException(`Settings not found`);
        }
      }

      for (const [key, value] of Object.entries(dto)) {
        if (isSecretSettingField(key)) {
          (row as unknown as Record<string, unknown>)[key] = value == null ? null : this.cipher.encrypt(value);
        } else {
          (row as unknown as Record<string, unknown>)[key] = value ?? null;
        }
      }

      await repo.save(row as never);
      return this.toView(row);
    });
  }

  // ── RESET (delete the singleton row) ───────────────────────────────────────

  async reset(userId: string): Promise<{ reset: boolean }> {
    const repo = (await this.ready()).getRepository(Setting);
    await repo.delete({ userId } as never);
    return { reset: true };
  }

  // ── INTERNAL USE ("we will use them later") ────────────────────────────────

  /**
   * Server-internal decryption hook for future consumers (e.g. an AI module
   * that needs the OpenRouter key). NEVER return this from a controller.
   */
  async getDecryptedSettings(userId: string): Promise<DecryptedSettings> {
    const row = await (await this.ready()).getRepository(Setting).findOneBy({ userId } as never);
    return {
      openRouterApiKey: this.cipher.decrypt(
        (row as unknown as Record<string, string | null> | undefined)?.openRouterApiKey ?? null,
      ),
      cloudinaryCloudName: (row as unknown as Record<string, string | null> | undefined)?.cloudinaryCloudName ?? null,
      cloudinaryApiKey: this.cipher.decrypt(
        (row as unknown as Record<string, string | null> | undefined)?.cloudinaryApiKey ?? null,
      ),
      cloudinaryApiSecret: this.cipher.decrypt(
        (row as unknown as Record<string, string | null> | undefined)?.cloudinaryApiSecret ?? null,
      ),
    };
  }

  // ── CREDENTIAL ACCESS (for other modules, e.g. uploads) ─────────────────────

  /**
   * Decrypted Cloudinary credentials for server-side use (e.g. file uploads).
   * Returns null when any of the three required values is unset. NEVER expose
   * through a controller — this is for internal service consumption only.
   */
  async getCloudinaryCredentials(
    userId: string,
  ): Promise<{ cloudName: string; apiKey: string; apiSecret: string } | null> {
    const row = await (await this.ready()).getRepository(Setting).findOneBy({ userId } as never);
    const r = row as unknown as Record<string, string | null> | undefined;
    const cloudName = r?.cloudinaryCloudName ?? null;
    const apiKey = this.cipher.decrypt(r?.cloudinaryApiKey ?? null);
    const apiSecret = this.cipher.decrypt(r?.cloudinaryApiSecret ?? null);
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
  }

  // ── mapping ─────────────────────────────────────────────────────────────────

  private toView(row: Setting | null): SettingsView {
    const r = row as unknown as Record<string, string | null | Date> | null;
    const out: Record<string, unknown> = {};
    for (const field of SECRET_SETTING_FIELDS) {
      out[field] = this.cipher.mask(this.cipher.decrypt((r?.[field] as string) ?? null));
    }
    out.cloudinaryCloudName = r?.cloudinaryCloudName ?? null;
    out.updatedAt = r?.updatedAt ?? null;
    return out as unknown as SettingsView;
  }
}
