import { updateSettingsSchema } from '../src/modules/settings/dto/update-settings.dto';

/** Same contract as JoiValidationPipe (abortEarly off, unknown keys stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: object) => { error?: any; value: any } }, value: unknown) =>
  schema.validate(value, { abortEarly: false, allowUnknown: false, stripUnknown: true, convert: true });

describe('updateSettingsSchema', () => {
  it('accepts any subset of fields', () => {
    for (const body of [
      { openRouterApiKey: 'sk-or-v1-abcdef123456' },
      { cloudinaryCloudName: 'my-cloud' },
      { cloudinaryApiKey: '123456789012345' },
      { cloudinaryApiSecret: 'abcdef0123456789-' },
      { openRouterApiKey: null },
      { cloudinaryCloudName: null },
    ]) {
      const { error, value } = validate(updateSettingsSchema, body);
      expect(error).toBeUndefined();
      expect(Object.keys(value)).toContain(Object.keys(body)[0]);
    }
    // empty patch stays empty → service rejects it as 400
    expect(Object.keys(validate(updateSettingsSchema, {}).value)).toHaveLength(0);
  });

  it('trims values', () => {
    const { value } = validate(updateSettingsSchema, {
      openRouterApiKey: '  sk-or-v1-trimmed  ',
      cloudinaryCloudName: '  my-cloud  ',
    });
    expect(value.openRouterApiKey).toBe('sk-or-v1-trimmed');
    expect(value.cloudinaryCloudName).toBe('my-cloud');
  });

  it('rejects secrets shorter than 4 chars or oversized', () => {
    expect(validate(updateSettingsSchema, { openRouterApiKey: 'abc' }).error).toBeDefined();
    expect(validate(updateSettingsSchema, { openRouterApiKey: 'x'.repeat(513) }).error).toBeDefined();
    expect(validate(updateSettingsSchema, { cloudinaryApiSecret: 'x'.repeat(513) }).error).toBeDefined();
  });

  it('rejects bad cloud names and non-string values', () => {
    expect(validate(updateSettingsSchema, { cloudinaryCloudName: '' }).error).toBeDefined();
    expect(validate(updateSettingsSchema, { cloudinaryCloudName: 'x'.repeat(256) }).error).toBeDefined();
    expect(validate(updateSettingsSchema, { openRouterApiKey: '' }).error).toBeDefined();
    expect(validate(updateSettingsSchema, { openRouterApiKey: 12345 }).error).toBeDefined();
  });

  it('strips unknown keys (no arbitrary credential injection)', () => {
    const stripped = validate(updateSettingsSchema, {
      openRouterApiKey: 'sk-or-v1-okkey-123',
      awsSecretKey: 'nope',
    });
    expect(stripped.error).toBeUndefined();
    expect((stripped.value as Record<string, unknown>).awsSecretKey).toBeUndefined();
  });
});
