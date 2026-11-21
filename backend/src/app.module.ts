import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { AdminController, LibraryController } from './admin'
import { AllergiesController } from './allergies'
import { AuthController } from './auth'
import { Access, AuthGuard, Mailer, PrismaService } from './common'
import { HealthController } from './health'
import { LinksController } from './links'
import { DosesController, MedsController, PrescriptionsController, Rx, RxVerifyController } from './meds'
import { NotificationsController } from './notifications'
import { ReportsController } from './reports'
import { Engine, Gateway, Notifier, Seed, Sync } from './services'
import { ProfileController, UsersController } from './users'

if (!process.env.JWT_SECRET) console.warn('WARNING: JWT_SECRET is not set. Using an insecure development secret.')

@Module({
  imports: [JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'dev-insecure-secret', signOptions: { expiresIn: '15m' } })],
  controllers: [AuthController, UsersController, ProfileController, LinksController, MedsController, PrescriptionsController, RxVerifyController, AllergiesController, DosesController, HealthController, ReportsController, NotificationsController, LibraryController, AdminController],
  providers: [PrismaService, Mailer, Access, Gateway, Notifier, Sync, Rx, Engine, Seed, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
