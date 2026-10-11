import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/schemas/user.schema';
import { PasswordResetToken } from './schemas/password-reset-token.schema';
import { MailService } from '../mail/mail.service';
import { generateToken, hashToken } from './token.util';

const TOKEN_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes
const BCRYPT_ROUNDS = 12;
const GENERIC_MESSAGE =
  'If an account with that email exists, a password reset link has been sent.';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(PasswordResetToken.name)
    private readonly tokens: Model<PasswordResetToken>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // Always returns the same message so attackers cannot discover which
  // emails have accounts.
  async forgotPassword(email: string) {
    try {
      const user = await this.users.findOne({ email, isActive: true });
      if (user) {
        // Invalidate any older unused links for this user
        await this.tokens.deleteMany({
          userId: user._id,
          usedAt: { $exists: false },
        });

        const token = generateToken();
        await this.tokens.create({
          userId: user._id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
        });

        const frontend =
          this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
        const link = `${frontend}/reset-password?token=${token}`;

        await this.mail.send(
          user.email,
          'Reset your MedMinder password',
          `<p>Hello ${user.name},</p>
           <p>We received a request to reset your MedMinder password.
           Click the link below to choose a new one. It expires in 30 minutes.</p>
           <p><a href="${link}">Reset my password</a></p>
           <p>If you did not ask for this, you can ignore this email.</p>`,
        );
      }
    } catch (err) {
      // Never reveal failures to the caller (it would leak whether the email exists)
      this.logger.error('forgotPassword failed', err as Error);
    }
    return { message: GENERIC_MESSAGE };
  }

  async resetPassword(token: string, newPassword: string) {
    // Atomically mark the token as used, so it can never be used twice
    const record = await this.tokens.findOneAndUpdate(
      {
        tokenHash: hashToken(token),
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { usedAt: new Date() },
    );
    if (!record) {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const result = await this.users.updateOne(
      { _id: record.userId },
      { password: hash },
    );
    if (result.matchedCount === 0) {
      throw new NotFoundException('Account not found.');
    }

    // Remove any other outstanding links for this user
    await this.tokens.deleteMany({ userId: record.userId });
    return { message: 'Your password has been reset. You can now log in.' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.users
      .findOne({ _id: userId, isActive: true })
      .select('+password');
    if (!user) throw new NotFoundException('Account not found.');

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      throw new UnauthorizedException('Your current password is incorrect.');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'New password must be different from the current one.',
      );
    }

    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await user.save();
    return { message: 'Your password has been changed.' };
  }
}
