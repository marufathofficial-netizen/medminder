import { BadRequestException, Body, Controller, Post } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { z } from 'zod'
import { APP_URL, Mailer, Me, PrismaService, Public, limit, parse, passwordSchema, rand, sha } from './common'

/** Jewel - Module 1 feature 12: password reset and change password via email link. */
@Controller('auth')
export class PasswordController {
  constructor(private db: PrismaService, private mail: Mailer) {}

  @Public() @Post('forgot')
  async forgot(@Body() b: any) {
    const { email } = parse(z.object({ email: z.string().trim().email() }), b)
    limit('forgot:' + email.toLowerCase(), 5, 3600e3)
    const u = await this.db.user.findUnique({ where: { email: email.toLowerCase() } })
    if (u) {
      const t = rand()
      await this.db.user.update({ where: { id: u.id }, data: { resetToken: sha(t), resetExpires: new Date(Date.now() + 3600e3) } })
      await this.mail.send(u.email, 'Reset your MedMinder password', `Hi ${u.name},\n\nWe received a request to reset your MedMinder password. Click this link to choose a new one: ${APP_URL()}/reset?token=${t}\n\nThis link expires in 1 hour. If you did not ask for this, ignore this email - your password stays the same.`)
    }
    return { message: 'If an account exists for that email, we sent a password reset link. It is valid for 1 hour.' }
  }

  @Public() @Post('reset')
  async reset(@Body() b: any) {
    const d = parse(z.object({ token: z.string(), password: passwordSchema }), b)
    const u = await this.db.user.findFirst({ where: { resetToken: sha(d.token) } })
    if (!u || !u.resetExpires || u.resetExpires < new Date()) throw new BadRequestException('Reset link is invalid or expired')
    await this.db.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(d.password, 10), resetToken: null, resetExpires: null } })
    await this.db.refreshToken.deleteMany({ where: { userId: u.id } })
    this.mail.send(u.email, 'Your MedMinder password was changed', `Hi ${u.name},\n\nYour password was just changed. If this was you, no action is needed.\n\nIf it was not you, reset your password immediately: ${APP_URL()}/forgot`).catch(() => null)
    return { message: 'Password updated. You can log in now.' }
  }

  @Post('change-password')
  async change(@Me() u: any, @Body() b: any) {
    const d = parse(z.object({ current: z.string(), password: passwordSchema }), b)
    if (!(await bcrypt.compare(d.current, u.passwordHash))) throw new BadRequestException('Current password is incorrect')
    await this.db.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(d.password, 10) } })
    await this.db.refreshToken.deleteMany({ where: { userId: u.id } })
    return { message: 'Password changed. Please log in again on other devices.' }
  }
}
