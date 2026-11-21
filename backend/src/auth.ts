import { BadRequestException, Body, Controller, ForbiddenException, Post, Req, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import { z } from 'zod'
import { APP_URL, Access, Mailer, Me, PrismaService, Public, limit, parse, passwordSchema, publicUser, rand, sha, tzSchema } from './common'

@Controller('auth')
export class AuthController {
  constructor(private db: PrismaService, private jwt: JwtService, private mail: Mailer, private acc: Access) {}

  private async sendVerify(u: any) {
    const t = rand()
    await this.db.user.update({ where: { id: u.id }, data: { verifyToken: sha(t), verifyExpires: new Date(Date.now() + 24 * 3600e3) } })
    await this.mail.send(u.email, 'Verify your MedMinder account', `Hi ${u.name},\n\nVerify your email: ${APP_URL()}/verify?token=${t}\n\nThis link expires in 24 hours.`)
  }

  private async issue(u: any) {
    const refresh = rand()
    await this.db.refreshToken.create({ data: { userId: u.id, tokenHash: sha(refresh), expiresAt: new Date(Date.now() + 7 * 864e5) } })
    return { accessToken: this.jwt.sign({ sub: u.id, role: u.role }), refreshToken: refresh, user: publicUser(u) }
  }

  @Public() @Post('register')
  async register(@Req() req: any, @Body() b: any) {
    limit('reg:' + req.ip, 10, 3600e3)
    const d = parse(z.object({ email: z.string().trim().email(), password: passwordSchema, name: z.string().trim().min(1).max(100), role: z.enum(['PATIENT', 'CAREGIVER', 'DOCTOR']).default('PATIENT'), timezone: tzSchema.default('UTC') }), b)
    const email = d.email.toLowerCase()
    if (!this.mail.enabled && process.env.MAIL_CONSOLE !== 'true') throw new BadRequestException('Email sending is not configured on the server (SMTP settings missing).')
    const passwordHash = await bcrypt.hash(d.password, 10)
    const existing = await this.db.user.findUnique({ where: { email } })
    let u: any
    if (existing) {
      // an unconfirmed sign-up can be redone (new details + new confirmation email); a confirmed one cannot
      if (existing.emailVerified) throw new BadRequestException('This email is already registered. Please log in or use "Forgot password".')
      u = await this.db.user.update({ where: { id: existing.id }, data: { name: d.name, role: d.role, timezone: d.timezone, passwordHash } })
    } else {
      u = await this.db.user.create({ data: { email, name: d.name, role: d.role, timezone: d.timezone, passwordHash, channels: ['INAPP', 'EMAIL'] } })
      await this.acc.log(u.id, 'REGISTER')
    }
    try { await this.sendVerify(u) } catch { throw new BadRequestException('We could not send the confirmation email. Please check the address and try again.') }
    return { message: `We sent a confirmation email to ${email}. Click the link in it to activate your account (the link is valid for 24 hours).` }
  }

  @Public() @Post('verify')
  async verify(@Body() b: any) {
    const { token } = parse(z.object({ token: z.string() }), b)
    const u = await this.db.user.findFirst({ where: { verifyToken: sha(token) } })
    if (!u) throw new BadRequestException('Invalid or already used verification link')
    if (!u.verifyExpires || u.verifyExpires < new Date()) throw new BadRequestException('Verification link expired. Please request a new one.')
    await this.db.user.update({ where: { id: u.id }, data: { emailVerified: true, verifyToken: null, verifyExpires: null } })
    this.mail.send(u.email, 'Welcome to MedMinder - thank you for joining', `Hi ${u.name},\n\nThank you for creating your MedMinder account. Your email is now confirmed and your account is ready.\n\nLog in here: ${APP_URL()}/login\n\nWith MedMinder you can set up your medications, get reminders, and share your progress with caregivers and doctors you choose.`).catch((e) => console.error('welcome mail failed:', e.message))
    return { message: 'Email confirmed. Thank you! A welcome email is on its way. You can now log in.' }
  }

  @Public() @Post('resend')
  async resend(@Body() b: any) {
    const { email } = parse(z.object({ email: z.string().trim().email() }), b)
    limit('resend:' + email.toLowerCase(), 5, 3600e3)
    const u = await this.db.user.findUnique({ where: { email: email.toLowerCase() } })
    if (u && !u.emailVerified) await this.sendVerify(u)
    return { message: 'If that account exists and is not yet confirmed, a new confirmation email was sent.' }
  }

  @Public() @Post('login')
  async login(@Req() req: any, @Body() b: any) {
    const d = parse(z.object({ email: z.string(), password: z.string(), otp: z.string().optional() }), b)
    limit('login:' + req.ip + ':' + d.email.toLowerCase(), 10, 15 * 60e3)
    const u = await this.db.user.findUnique({ where: { email: d.email.toLowerCase() } })
    if (!u || !(await bcrypt.compare(d.password, u.passwordHash))) throw new UnauthorizedException('Invalid email or password')
    if (u.status === 'SUSPENDED') throw new ForbiddenException('This account is suspended')
    if (!u.emailVerified) throw new ForbiddenException('Please confirm your email first. Check your inbox, or use "Resend verification".')
    if (u.twoFactorEnabled) {
      if (!d.otp) {
        const code = String(crypto.randomInt(100000, 1000000))
        await this.db.user.update({ where: { id: u.id }, data: { otpHash: sha(code), otpExpires: new Date(Date.now() + 10 * 60e3) } })
        await this.mail.send(u.email, 'Your MedMinder login code', `Your code is ${code}. It expires in 10 minutes.`)
        return { twoFactorRequired: true }
      }
      if (!u.otpHash || !u.otpExpires || u.otpExpires < new Date() || u.otpHash !== sha(d.otp)) throw new UnauthorizedException('Invalid or expired code')
      await this.db.user.update({ where: { id: u.id }, data: { otpHash: null, otpExpires: null } })
    }
    let user = u
    if (u.status === 'DEACTIVATED') user = await this.db.user.update({ where: { id: u.id }, data: { status: 'ACTIVE' } }) // logging in reactivates
    await this.acc.log(u.id, 'LOGIN')
    return this.issue(user)
  }

  @Public() @Post('refresh')
  async refresh(@Body() b: any) {
    const { refreshToken } = parse(z.object({ refreshToken: z.string() }), b)
    const t = await this.db.refreshToken.findUnique({ where: { tokenHash: sha(refreshToken) } })
    if (!t || t.expiresAt < new Date()) throw new UnauthorizedException('Session expired')
    await this.db.refreshToken.delete({ where: { id: t.id } }) // rotate
    const u = await this.db.user.findUnique({ where: { id: t.userId } })
    if (!u || u.status !== 'ACTIVE') throw new UnauthorizedException('Account inactive')
    return this.issue(u)
  }

  @Public() @Post('logout')
  async logout(@Body() b: any) {
    if (b?.refreshToken) await this.db.refreshToken.deleteMany({ where: { tokenHash: sha(String(b.refreshToken)) } })
    return { ok: true }
  }

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
