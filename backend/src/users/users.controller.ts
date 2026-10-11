import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { UserRole } from './schemas/user.schema';

@Controller('users')
export class UsersController {
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() request: Request) {
    return request.user;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PATIENT)
  @Get('patient-area')
  getPatientArea(@Req() request: Request) {
    return {
      message: 'Patient access granted',
      user: request.user,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CAREGIVER)
  @Get('caregiver-area')
  getCaregiverArea(@Req() request: Request) {
    return {
      message: 'Caregiver access granted',
      user: request.user,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DOCTOR)
  @Get('doctor-area')
  getDoctorArea(@Req() request: Request) {
    return {
      message: 'Doctor access granted',
      user: request.user,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin-area')
  getAdminArea(@Req() request: Request) {
    return {
      message: 'Admin access granted',
      user: request.user,
    };
  }
}