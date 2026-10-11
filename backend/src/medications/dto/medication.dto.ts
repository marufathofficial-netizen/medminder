import { z } from 'zod';
import { MEDICATION_FORMS } from '../schemas/medication.schema';

export const createMedicationSchema = z.object({
  name: z.string().trim().min(1),
  dosage: z.string().trim().optional(),
  form: z.enum(MEDICATION_FORMS).optional(),
  instructions: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const updateMedicationSchema = createMedicationSchema.partial();

export type CreateMedicationDto = z.infer<typeof createMedicationSchema>;
export type UpdateMedicationDto = z.infer<typeof updateMedicationSchema>;
