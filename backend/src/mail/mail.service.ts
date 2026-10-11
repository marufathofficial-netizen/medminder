import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporterPromise?: Promise<nodemailer.Transporter>;

  constructor(private readonly config: ConfigService) {}

  private getTransporter() {
    if (!this.transporterPromise) {
      this.transporterPromise = this.createTransporter();
    }
    return this.transporterPromise;
  }

  private async createTransporter(): Promise<nodemailer.Transporter> {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      return nodemailer.createTransport({
        host,
        port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }

    // Development fallback: create a free temporary Ethereal test inbox.
    // Emails are NOT delivered to real people; we log a preview link instead.
    const account = await nodemailer.createTestAccount();
    this.logger.log(
      `SMTP_HOST not set. Using a temporary Ethereal test account (${account.user}).`,
    );
    return nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    });
  }

  // Generic sender, also used by password reset.
  async send(to: string, subject: string, html: string) {
    const transporter = await this.getTransporter();
    const info = await transporter.sendMail({
      from:
        this.config.get<string>('MAIL_FROM') ??
        'MedMinder <no-reply@medminder.local>',
      to,
      subject,
      html,
    });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      this.logger.log(`Preview email: ${preview}`);
    }
  }

  // Email verification (feature 1-1).
  async sendVerificationEmail(to: string, name: string, link: string) {
    await this.send(
      to,
      'Verify your MedMinder email',
      `<p>Hi ${escapeHtml(name)},</p>
<p>Please verify your email by clicking the link below:</p>
<p><a href="${link}">Verify my email</a></p>
<p>The link expires in 24 hours.</p>`,
    );
  }
}