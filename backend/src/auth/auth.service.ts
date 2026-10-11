import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { UserDocument, UserRole } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

// Only these roles can be chosen at registration.
// Doctor and admin accounts must be assigned by an admin.
const SELF_REGISTER_ROLES: UserRole[] = [UserRole.PATIENT, UserRole.CAREGIVER];
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  async register(
    name: string,
    email: string,
    password: string,
  ) {
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    role?: string,
  ) {
    const cleanName = (name ?? '').trim();
    const cleanEmail = (email ?? '').trim().toLowerCase();

    if (!cleanName) {
      throw new BadRequestException('Name is required');
    }
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      throw new BadRequestException('A valid email is required');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const userRole = (role as UserRole) || UserRole.PATIENT;
    if (!SELF_REGISTER_ROLES.includes(userRole)) {
      throw new BadRequestException('Role must be patient or caregiver');
    }

    const existingUser = await this.usersService.findByEmail(cleanEmail);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.usersService.create({
      name,
      email,
      password: hashedPassword,
    });

    return this.createTokenResponse(user);
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const passwordMatches = await bcrypt.compare(
      password,
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      role: userRole,
    });

    await this.sendVerificationEmail(user);

    // No login token yet: the account must be verified first.
    return {
      message:
        'Registration successful. Please check your email to verify your account.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async verifyEmail(token: string) {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Verification token is required');
    }

    const user = await this.usersService.findByVerificationTokenHash(
      this.hashToken(token),
    );

    if (!user) {
      throw new BadRequestException('Invalid or expired verification link');
    }

    await this.usersService.markEmailVerified(user._id.toString());

    return { message: 'Email verified. You can now log in.' };
  }

  async resendVerification(email: string) {
    // Same response whether or not the account exists,
    // so this endpoint cannot be used to discover registered emails.
    const response = {
      message:
        'If that account exists and is not verified, a new email has been sent.',
    };

    const user = await this.usersService.findByEmail(email ?? '');
    if (user && !user.isEmailVerified) {
      await this.sendVerificationEmail(user);
    }

    return response;
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email ?? '');

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      password ?? '',
      user.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.createTokenResponse(user);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<{
        sub: string;
        email: string;
        role: string;
      }>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      });

      const user = await this.usersService.findById(payload.sub);

      if (!user || !user.isActive || !user.refreshTokenHash) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokenMatches = await bcrypt.compare(
        refreshToken,
        user.refreshTokenHash,
      );

      if (!tokenMatches) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.createTokenResponse(user);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string) {
    await this.usersService.clearRefreshTokenHash(userId);

    return {
      message: 'Logged out successfully',
    };
  }

  private async createTokenResponse(user: UserDocument) {
    const payload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      expiresIn: '7d',
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await this.usersService.setRefreshTokenHash(
      user._id.toString(),
      refreshTokenHash,
    );

    return {
      accessToken,
      refreshToken,
    if (!user.isEmailVerified) {
      throw new ForbiddenException(
        'Please verify your email before logging in',
      );
    }

    const accessToken = this.jwtService.sign({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    return {
      message: 'Login successful',
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  private async sendVerificationEmail(user: UserDocument): Promise<void> {
    const token = randomBytes(32).toString('hex');

    // Only a hash is stored, so a database leak cannot be used to verify accounts.
    await this.usersService.setVerificationToken(
      user._id.toString(),
      this.hashToken(token),
      new Date(Date.now() + VERIFICATION_TTL_MS),
    );

    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    const link = `${frontendUrl}/verify-email?token=${token}`;

    try {
      await this.mailService.sendVerificationEmail(user.email, user.name, link);
    } catch (error) {
      // Registration still succeeds; the user can request a new email.
      this.logger.error(
        `Could not send verification email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}