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
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: Number(this.config.getOrThrow<string>('SMTP_PORT')),
      secure: false,
      auth: {
        user: this.config.getOrThrow<string>('SMTP_USER'),
        pass: this.config.getOrThrow<string>('SMTP_PASS'),
      },
    });
  }

  async sendVerificationEmail(to: string, name: string, link: string) {
    const info = await this.transporter.sendMail({
      from: this.config.getOrThrow<string>('MAIL_FROM'),
      to,
      subject: 'Verify your MedMinder email',
      text: `Hi ${name},\n\nPlease verify your email by opening this link:\n${link}\n\nThe link expires in 24 hours.`,
      html: `<p>Hi ${escapeHtml(name)},</p>
<p>Please verify your email by clicking the link below:</p>
<p><a href="${link}">Verify my email</a></p>
<p>The link expires in 24 hours.</p>`,
    });

    // With Ethereal, emails are not delivered. This link shows the email in your browser.
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      this.logger.log(`Email preview: ${preview}`);
    }
  }
}