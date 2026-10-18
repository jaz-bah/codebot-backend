import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { APP_CONFIG } from '../../config/app-config.token';
import { AppConfig } from '../../config/configuration';

/**
 * Minimal email interface BetterAuth callbacks hand us.
 */
export interface MailUser {
  email: string;
  name: string;
}

/**
 * Sends transactional mail. Never throws at call sites (FR-9: a mail failure
 * logs a warning, retries once, and does not break the auth flow).
 *
 * Transport selection:
 * - `SMTP_HOST` configured → real SMTP (port 465 → secure TLS implicit)
 * - otherwise → nodemailer JSON transport (dev/logs only)
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly appConfig: AppConfig) {}

  onModuleInit(): void {
    const { host, port, user, pass } = this.appConfig.smtp;
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: this.appConfig.smtp.port,
          secure: this.appConfig.smtp.port === 465,
          auth: user ? { user, pass } : undefined,
        })
      : nodemailer.createTransport({ jsonTransport: true });
  }

  /**
   * Fire-safe send with a single retry. Resolves true when delivered.
   * In non-production, sends are ALSO appended to `.mail-capture.jsonl` so
   * scripted E2E can read verification/reset links without an inbox.
   */
  async send(input: { to: string; subject: string; html: string; text: string; url?: string }): Promise<boolean> {
    if (this.appConfig.nodeEnv !== 'production') {
      try {
        appendFileSync(
          join(process.cwd(), '.mail-capture.jsonl'),
          `${JSON.stringify({ at: new Date().toISOString(), to: input.to, subject: input.subject, url: input.url })}\n`,
        );
      } catch {
        /* capture must never break mail */
      }
    }
    const attempt = async (): Promise<boolean> => {
      try {
        await this.transporter.sendMail({
          from: this.appConfig.smtp.from || 'backend-app <no-reply@localhost>',
          ...input,
        });
        return true;
      } catch (err) {
        this.logger.warn(`mail send failed temporarily: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    };

    if (await attempt()) return true;
    if (await attempt()) {
      this.logger.log(`mail delivered on retry to ${input.to}`);
      return true;
    }
    this.logger.error(`mail permanently failed to ${input.to} (${input.subject}) — auth flow continues (FR-9)`);
    return false;
  }

  private render(templateName: string, vars: Record<string, string>): { html: string; text: string } {
    const fill = (raw: string): string =>
      Object.entries(vars).reduce(
        (acc, [key, value]) => acc.split(`{{${key}}}`).join(value),
        raw,
      );
    return {
      html: fill(readFileSync(join(__dirname, 'templates', `${templateName}.html`), 'utf8')),
      text: fill(readFileSync(join(__dirname, 'templates', `${templateName}.txt`), 'utf8')),
    };
  }

  /** BetterAuth `emailVerification.sendVerificationEmail` callback target. */
  sendVerificationEmail(user: MailUser, url: string): Promise<boolean> {
    const { html, text } = this.render('verify-email', {
      NAME: user.name || 'there',
      VERIFY_URL: url,
    });
    this.logger.debug(`sendVerificationEmail → ${user.email} url=${url}`);
    return this.send({ to: user.email, subject: 'Verify your email', html, text, url });
  }

  /** BetterAuth `emailAndPassword.sendResetPassword` callback target (Phase 3 activates). */
  sendResetPassword(user: MailUser, url: string): Promise<boolean> {
    const { html, text } = this.render('reset-password', {
      NAME: user.name || 'there',
      RESET_URL: url,
    });
    this.logger.debug(`sendResetPassword → ${user.email} url=${url}`);
    return this.send({ to: user.email, subject: 'Reset your password', html, text, url });
  }
}
