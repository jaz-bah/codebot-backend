import * as nodemailer from 'nodemailer';
import { MailService } from '../src/modules/mail/mail.service';
import { AppConfig } from '../src/config/configuration';

describe('MailService', () => {
  const readTemplate = (name: string): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'modules', 'mail', 'templates', name), 'utf8');
  };

  it('verify-email template contains all required placeholders', () => {
    const html = readTemplate('verify-email.html');
    expect(html.length).toBeGreaterThan(200);
    expect(html).toContain('{{NAME}}');
    expect(html).toContain('{{VERIFY_URL}}');
  });

  it('reset-password template contains all required placeholders (Phase 3 consumes this)', () => {
    const html = readTemplate('reset-password.html');
    expect(html.length).toBeGreaterThan(200);
    expect(html).toContain('{{NAME}}');
    expect(html).toContain('{{RESET_URL}}');
  });

  it('renders and sends verification email with correct to/subject/link', async () => {
    const appConfig: AppConfig = {
      nodeEnv: 'development',
      port: 3000,
      appUrl: 'http://localhost:3000',
      databaseUrl: '',
      betterAuthSecret: 'x'.repeat(40),
      corsOriginUrls: ['http://localhost:5173'],
      adminEmails: [],
      smtp: { host: '', port: 587, user: '', pass: '', from: 'backend-app <no-reply@localhost>' },
      oauth: { googleClientId: '', googleClientSecret: '', githubClientId: '', githubClientSecret: '' },
      throttle: { ttlMs: 60000, limit: 100 },
      settings: { encryptionKey: '' },
    };
    const service = new MailService(appConfig);
    service.onModuleInit();

    const captured: Array<Record<string, unknown>> = [];
    jest
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      .spyOn((service as any).transporter, 'sendMail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (msg: any) => {
        captured.push(msg as Record<string, unknown>);
        return { messageId: 'test-1' };
      });

    const ok = await service.sendVerificationEmail(
      { email: 'user@example.com', name: 'User01' },
      'http://localhost:3000/api/auth/verify-email?token=abc123',
    );

    expect(ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]['to']).toBe('user@example.com');
    expect(captured[0]['subject']).toBe('Verify your email');
    expect(String(captured[0]['html'])).toContain('http://localhost:3000/api/auth/verify-email?token=abc123');
    expect(String(captured[0]['html'])).toContain('User01');
    expect(String(captured[0]['html'])).not.toContain('{{VERIFY_URL}}');
  });

  it('dev fallback (no SMTP_HOST) uses JSON transport and still renders non-empty html', async () => {
    const appConfig: AppConfig = {
      nodeEnv: 'development',
      port: 3000,
      appUrl: 'http://localhost:3000',
      databaseUrl: '',
      betterAuthSecret: 'x'.repeat(40),
      corsOriginUrls: [],
      adminEmails: [],
      smtp: { host: '', port: 587, user: '', pass: '', from: '' },
      oauth: { googleClientId: '', googleClientSecret: '', githubClientId: '', githubClientSecret: '' },
      throttle: { ttlMs: 60000, limit: 100 },
      settings: { encryptionKey: '' },
    };
    const service = new MailService(appConfig);
    service.onModuleInit();

    const captured: Array<Record<string, unknown>> = [];
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn((service as any).transporter, 'sendMail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (msg: any) => {
        captured.push(msg as Record<string, unknown>);
        return {};
      });

    const ok = await service.sendResetPassword(
      { email: 'reset@example.com', name: '' },
      'http://localhost:3000/api/auth/reset-password?token=xyz',
    );
    expect(ok).toBe(true);
    expect(String(captured[0]['to'])).toBe('reset@example.com');
    const html = String(captured[0]['html']);
    expect(html.length).toBeGreaterThan(200);
    expect(html).toContain('http://localhost:3000/api/auth/reset-password?token=xyz');
    expect(html).not.toContain('{{RESET_URL}}');
  });

  it('send() retries once then reports failure without throwing (FR-9)', async () => {
    const appConfig: AppConfig = {
      nodeEnv: 'development',
      port: 3000,
      appUrl: 'http://localhost:3000',
      databaseUrl: '',
      betterAuthSecret: 'x'.repeat(40),
      corsOriginUrls: [],
      adminEmails: [],
      smtp: { host: 'smtp.test', port: 587, user: '', pass: '', from: '' },
      oauth: { googleClientId: '', googleClientSecret: '', githubClientId: '', githubClientSecret: '' },
      throttle: { ttlMs: 60000, limit: 100 },
      settings: { encryptionKey: '' },
    };
    const service = new MailService(appConfig);
    service.onModuleInit();

    let calls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn((service as any).transporter, 'sendMail').mockImplementation(async () => {
      calls += 1;
      throw new Error('smtp down');
    });

    await expect(
      service.send({ to: 'f@example.com', subject: 's', html: '<p>x</p>', text: 'x' }),
    ).resolves.toBe(false);
    expect(calls).toBe(2); // initial + one retry, then give up silently
    void nodemailer; // keep import if tree-shaken elsewhere
  });
});
