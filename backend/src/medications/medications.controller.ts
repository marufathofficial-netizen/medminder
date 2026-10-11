import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { MedicationsService } from './medications.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createMedicationSchema,
  updateMedicationSchema,
} from './dto/medication.dto';
import type {
  CreateMedicationDto,
  UpdateMedicationDto,
} from './dto/medication.dto';

@Controller('medications')
export class MedicationsController {
  constructor(private readonly service: MedicationsService) {}

  // TEMPORARY until the auth module is merged:
  // read the user id from the x-user-id header. Later, take it from the JWT.
  private patientId(userId?: string) {
    if (!userId || !isValidObjectId(userId)) {
      throw new BadRequestException(
        'x-user-id header (valid 24-char ObjectId) is required',
      );
    }
    return userId;
  }

  @Post()
  create(
    @Headers('x-user-id') userId: string,
    @Body(new ZodValidationPipe(createMedicationSchema))
    dto: CreateMedicationDto,
  ) {
    return this.service.create(this.patientId(userId), dto);
  }

  @Get()
  findAll(@Headers('x-user-id') userId: string) {
    return this.service.findAll(this.patientId(userId));
  }

  @Get(':id')
  findOne(@Headers('x-user-id') userId: string, @Param('id') id: string) {
    return this.service.findOne(this.patientId(userId), id);
  }

  @Patch(':id')
  update(
    @Headers('x-user-id') userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMedicationSchema))
    dto: UpdateMedicationDto,
  ) {
    return this.service.update(this.patientId(userId), id, dto);
  }

  @Delete(':id')
  remove(@Headers('x-user-id') userId: string, @Param('id') id: string) {
    return this.service.remove(this.patientId(userId), id);
  }
}