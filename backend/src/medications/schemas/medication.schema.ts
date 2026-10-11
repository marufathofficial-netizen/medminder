import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const MEDICATION_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'drops',
  'inhaler',
  'other',
] as const;

export type MedicationDocument = HydratedDocument<Medication>;

// Field names follow Maruf's Core Data Model Proposal (section 5.2).
// When his schema PR is merged, replace this file with his version.
@Schema({ timestamps: true })
export class Medication {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  patientId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  dosage?: string;

  @Prop({ type: String, enum: MEDICATION_FORMS, default: 'other' })
  form: string;

  @Prop()
  instructions?: string;

  @Prop()
  notes?: string;

  @Prop()
  photoUrl?: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const MedicationSchema = SchemaFactory.createForClass(Medication);
MedicationSchema.index({ patientId: 1, isActive: 1 });