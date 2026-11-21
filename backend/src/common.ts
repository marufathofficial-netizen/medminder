import 'dotenv/config'
import * as crypto from 'crypto'
import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, OnModuleInit, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import { DateTime, IANAZone } from 'luxon'
import * as nodemailer from 'nodemailer'
import { z, ZodTypeAny } from 'zod'

export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export const rand = () => crypto.randomBytes(32).toString('hex')
export const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').split(',')[0].trim()
export const tzSchema = z.string().refine((t) => IANAZone.isValidZone(t), 'Invalid timezone')
export const PASSWORD_RULES = 'Password must be 8-72 characters and include at least 1 uppercase letter, 1 lowercase letter and 1 special character.'
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Z]/, 'Password needs at least 1 uppercase letter')
  .regex(/[a-z]/, 'Password needs at least 1 lowercase letter')
  .regex(/[^A-Za-z0-9\s]/, 'Password needs at least 1 special character')

const hits = new Map<string, number[]>()
/** Simple in-memory rate limit: max `n` calls per `ms` for a key. */
export function limit(key: string, n: number, ms: number) {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < ms)
  if (arr.length >= n) throw new HttpException('Too many attempts. Please wait a while and try again.', 429)
  arr.push(now)
  hits.set(key, arr)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < ms)) hits.delete(k)
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const toHtml = (text: string) =>
  '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;line-height:1.5"><h2 style="margin:0 0 16px">MedMinder</h2>' +
  esc(text).split(/\n\n+/).map((para) => '<p>' + para.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#111;font-weight:bold">$1</a>') + '</p>').join('') +
  '<hr style="border:0;border-top:1px solid #ccc;margin:24px 0"><p style="color:#666;font-size:12px">If you did not expect this email you can safely ignore it.</p></div>'

export const ALL_PERMS = ['meds', 'adherence', 'journal', 'measurements', 'documents', 'edit', 'prescribe']

// drug families used to flag cross-reactions (a hint for the doctor, never a substitute for clinical judgement)
const DRUG_CLASS: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'piperacillin', 'flucloxacillin', 'cloxacillin', 'augmentin', 'co-amoxiclav'],
  sulfa: ['sulfa', 'sulfamethoxazole', 'sulfasalazine', 'sulfadiazine', 'cotrimoxazole', 'co-trimoxazole', 'bactrim'],
  nsaid: ['ibuprofen', 'naproxen', 'diclofenac', 'aspirin', 'ketorolac', 'indomethacin', 'celecoxib', 'mefenamic'],
  aspirin: ['aspirin', 'ibuprofen', 'naproxen', 'diclofenac', 'ketorolac'],
  cephalosporin: ['cef', 'ceph'],
}
export function allergyWarnings(allergies: { substance: string; severity?: string | null }[], drug: string): string[] {
  const d = (drug || '').toLowerCase().trim()
  if (d.length < 3) return []
  const out = new Set<string>()
  for (const a of allergies) {
    const s = a.substance.toLowerCase().trim()
    if (s.length < 3) continue
    let hit = d.includes(s) || s.includes(d)
    if (!hit) for (const [k, list] of Object.entries(DRUG_CLASS)) if (s.includes(k) && list.some((x) => d.includes(x))) hit = true
    if (hit) out.add(`Possible allergy conflict: patient is allergic to ${a.substance}${a.severity ? ' (' + a.severity.toLowerCase() + ')' : ''}`)
  }
  return [...out]
}

export function parse<T extends ZodTypeAny>(s: T, d: unknown): z.infer<T> {
  const r = s.safeParse(d ?? {})
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return r.data
}

export async function retry<T>(fn: () => Promise<T>, n = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= n - 1) throw e
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
}

export const publicUser = (u: any) => {
  const { passwordHash, verifyToken, verifyExpires, resetToken, resetExpires, otpHash, otpExpires, pushSub, ...rest } = u
  return { ...rest, pushEnabled: !!pushSub }
}

// reminder timeline for one dose
export const doseTimes = (at: Date, lead: number) => ({
  remindAt: new Date(at.getTime() - lead * 60000),
  followUpAt: new Date(at.getTime() + 10 * 60000),
  deadline: new Date(at.getTime() + 30 * 60000), // not confirmed within 30 min = missed
})

export const localDate = (s: string, tz: string) => DateTime.fromISO(s, { zone: tz }).toJSDate()

// Generate dose datetimes (UTC) for a medication between from..to, interpreting times in the patient's timezone.
export function genDoses(m: { startDate: Date; endDate?: Date | null; schedule: any }, from: Date, to: Date, tz: string): Date[] {
  const s = m.schedule || {}
  if (s.type === 'ASNEEDED' || !s.times?.length) return []
  const out: Date[] = []
  const startDay = DateTime.fromJSDate(m.startDate, { zone: tz }).startOf('day')
  const endDay = m.endDate ? DateTime.fromJSDate(m.endDate, { zone: tz }).startOf('day') : null
  const last = DateTime.fromJSDate(to, { zone: tz }).startOf('day')
  for (let d = DateTime.fromJSDate(from, { zone: tz }).startOf('day'); d <= last; d = d.plus({ days: 1 })) {
    if (d < startDay) continue
    if (endDay && d > endDay) break
    if (s.type === 'DAYS' || s.type === 'WEEKLY') {
      const days: number[] = s.days?.length ? s.days : [startDay.weekday % 7]
      if (!days.includes(d.weekday % 7)) continue
    }
    if (s.type === 'INTERVAL') {
      const diff = Math.round(d.diff(startDay, 'days').days)
      if (diff % (s.intervalDays || 1) !== 0) continue
    }
    for (const t of s.times as string[]) {
      const [h, mi] = t.split(':').map(Number)
      const dt = d.set({ hour: h, minute: mi, second: 0, millisecond: 0 }).toJSDate()
      if (dt >= from && dt <= to) out.push(dt)
    }
  }
  return out
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() { await this.$connect() }
}

@Injectable()
export class Mailer implements OnModuleInit {
  private t = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: (process.env.SMTP_PASS || '').replace(/\s+/g, '') } : undefined,
      })
    : null
  get enabled() { return !!this.t }
  async onModuleInit() {
    if (!this.t) { console.warn('\n!!! SMTP NOT CONFIGURED: real emails are NOT sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS in backend/.env !!!\n'); return }
    try { await this.t.verify(); console.log('SMTP OK: real emails will be sent from', process.env.SMTP_USER) }
    catch (e: any) { console.error('!!! SMTP login FAILED:', e.message, '\n    Check SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS (Gmail needs an App Password).') }
  }
  /** Throws a readable error if mail cannot be sent, so the user is never told "check your email" falsely. */
  async send(to: string, subject: string, text: string) {
    if (!this.t) {
      if (process.env.MAIL_CONSOLE === 'true') { console.log(`\n[MAIL -> ${to}] ${subject}\n${text}\n`); return }
      throw new BadRequestException('Email sending is not configured on the server (SMTP settings missing).')
    }
    try { await this.t.sendMail({ from: process.env.MAIL_FROM || `MedMinder <${process.env.SMTP_USER}>`, to, subject, text, html: toHtml(text) }) }
    catch (e: any) { console.error('Email send failed:', e.message); throw new BadRequestException('Could not send the email right now. Please try again in a few minutes.') }
  }
}

export const Roles = (...r: string[]) => SetMetadata('roles', r)
export const Public = () => SetMetadata('public', true)
export const Me = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user)

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private ref: Reflector, private db: PrismaService) {}
  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()]
    if (this.ref.getAllAndOverride('public', targets)) return true
    const req = ctx.switchToHttp().getRequest()
    const h: string = req.headers.authorization || ''
    let p: any
    try { p = this.jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '') } catch { throw new UnauthorizedException() }
    const u = await this.db.user.findUnique({ where: { id: p.sub } })
    if (!u || u.status !== 'ACTIVE') throw new UnauthorizedException('Account inactive')
    req.user = u
    const roles = this.ref.getAllAndOverride<string[]>('roles', targets)
    if (roles?.length && !roles.includes(u.role)) throw new ForbiddenException('Not allowed for your role')
    return true
  }
}

@Injectable()
export class Access {
  constructor(private db: PrismaService) {}
  /** Resolve 'me' or a patient id and verify the caller may access it (any of the `need` permissions). */
  async resolve(user: any, pid: string, ...need: string[]) {
    if (pid === 'me' || pid === user.id) return { id: user.id as string, perms: ALL_PERMS, self: true }
    if (!/^[a-f\d]{24}$/i.test(pid)) throw new BadRequestException('Invalid patient id')
    const link = await this.db.link.findFirst({ where: { patientId: pid, memberId: user.id, status: 'ACTIVE' } })
    if (!link || (need.length && !need.some((p) => link.perms.includes(p)))) throw new ForbiddenException('You do not have access to this patient')
    return { id: pid, perms: link.perms, self: false }
  }
  log(userId: string | null, action: string, meta?: string) {
    return this.db.activityLog.create({ data: { userId, action, meta } }).catch(() => null)
  }
}
