import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument } from './schemas/user.schema';
import { User, UserDocument, UserRole } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({
      email: email.toLowerCase().trim(),
    });
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id);
  }

  async create(data: {
    name: string;
    email: string;
    password: string;
  }): Promise<UserDocument> {
    const user = new this.userModel({
      name: data.name,
      email: data.email,
      password: data.password,
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  async create(userData: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }): Promise<UserDocument> {
    const user = new this.userModel({
      ...userData,
      email: userData.email.toLowerCase(),
    });

    return user.save();
  }

  async setRefreshTokenHash(
    userId: string,
    refreshTokenHash: string,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      refreshTokenHash,
    });
  }

  async clearRefreshTokenHash(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      refreshTokenHash: null,
  // --- Email verification (feature 1-1) ---

  async setVerificationToken(
    userId: string,
    tokenHash: string,
    expires: Date,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpires: expires,
      },
    });
  }

  // Returns the user only if the token matches and has not expired.
  async findByVerificationTokenHash(
    tokenHash: string,
  ): Promise<UserDocument | null> {
    return this.userModel.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { isEmailVerified: true },
      $unset: { emailVerificationTokenHash: '', emailVerificationExpires: '' },
    });
  }
}