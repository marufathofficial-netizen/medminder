import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

// TEMPORARY STUB so password reset can run before the team's User schema
// is merged. Field names follow Maruf's Core Data Model Proposal (section 5.1).
// When his User schema is merged: delete this file and import his instead.
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string; // bcrypt hash

  @Prop({
    type: String,
    enum: ['patient', 'caregiver', 'doctor', 'admin'],
    default: 'patient',
  })
  role: string;

  @Prop({ default: 'UTC' })
  timezone: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isEmailVerified: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
