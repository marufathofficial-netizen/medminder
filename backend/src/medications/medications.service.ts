import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Medication } from './schemas/medication.schema';
import { CreateMedicationDto, UpdateMedicationDto } from './dto/medication.dto';

@Injectable()
export class MedicationsService {
  constructor(
    @InjectModel(Medication.name) private readonly model: Model<Medication>,
  ) {}

  create(patientId: string, dto: CreateMedicationDto) {
    const id = new Types.ObjectId(patientId);
    return this.model.create({ ...dto, patientId: id, createdBy: id });
  }

  findAll(patientId: string) {
    return this.model
      .find({ patientId, isActive: true })
      .sort({ createdAt: -1 });
  }

  async findOne(patientId: string, id: string) {
    this.assertValidId(id);
    const med = await this.model.findOne({ _id: id, patientId, isActive: true });
    if (!med) throw new NotFoundException('Medication not found');
    return med;
  }

  async update(patientId: string, id: string, dto: UpdateMedicationDto) {
    this.assertValidId(id);
    const med = await this.model.findOneAndUpdate(
      { _id: id, patientId, isActive: true },
      dto,
      { new: true },
    );
    if (!med) throw new NotFoundException('Medication not found');
    return med;
  }

  // Soft delete: dose history (DoseEvent) still points to this medication
  async remove(patientId: string, id: string) {
    this.assertValidId(id);
    const med = await this.model.findOneAndUpdate(
      { _id: id, patientId, isActive: true },
      { isActive: false },
      { new: true },
    );
    if (!med) throw new NotFoundException('Medication not found');
    return { deleted: true };
  }

  private assertValidId(id: string) {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Medication not found');
    }
  }
}
