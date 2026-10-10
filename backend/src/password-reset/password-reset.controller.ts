import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { PasswordResetService } from './password-reset.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './dto/password-reset.dto';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password-reset.dto';

@Controller('auth')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  // TEMPORARY until Oni's JWT guard is merged:
  // read the logged-in user's id from the x-user-id header.
  // Later, take it from the JWT instead.
  private currentUserId(userId?: string) {
    if (!userId || !isValidObjectId(userId)) {
      throw new BadRequestException(
        'x-user-id header (valid 24-char ObjectId) is required',
      );
    }
    return userId;
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto,
  ) {
    return this.service.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ) {
    return this.service.resetPassword(dto.token, dto.newPassword);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @Headers('x-user-id') userId: string,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ) {
    return this.service.changePassword(
      this.currentUserId(userId),
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
