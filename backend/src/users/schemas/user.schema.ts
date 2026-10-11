import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  PATIENT = 'patient',
  CAREGIVER = 'caregiver',
  DOCTOR = 'doctor',
  ADMIN = 'admin',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true, enum: UserRole, default: UserRole.PATIENT })
  role: UserRole;

  // IANA timezone name, e.g. "Asia/Dhaka". Used to convert dose times.
  @Prop({ required: true, default: 'UTC' })
  timezone: string;

  @Prop({ default: true })
  isActive: boolean;

  // --- Email verification (feature 1-1) ---
  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ select: false })
  emailVerificationTokenHash?: string;

  @Prop({ select: false })
  emailVerificationExpires?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);