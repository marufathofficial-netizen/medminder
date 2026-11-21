import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import * as fs from 'fs'
import { z } from 'zod'
import { Access, Me, PrismaService, parse, publicUser, tzSchema } from './common'
import { Engine, Sync } from './services'

const hhmm = z.string().regex(/^\d\d:\d\d$/)
const PROFILE_FIELDS: [string, string][] = [['name', 'name'], ['age', 'age'], ['conditions', 'conditions'], ['phone', 'phone'], ['emergencyName', 'emergency contact'], ['emergencyPhone', 'emergency phone']]
/** names the profile fields that really changed, so care-team notices say exactly what is new */
const profileDiff = (a: any, b: any) => PROFILE_FIELDS.filter(([k]) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).map(([, l]) => l)
const prefs = z.object({
  name: z.string().min(1), age: z.number().int().min(0).max(130).nullable(),
  conditions: z.array(z.string()),
  phone: z.string().nullable(), emergencyName: z.string().nullable(), emergencyPhone: z.string().nullable(),
  timezone: tzSchema, shareProfile: z.boolean(), leadMinutes: z.number().int().min(0).max(120),
  quietStart: hhmm.nullable(), quietEnd: hhmm.nullable(), channels: z.array(z.enum(['INAPP', 'EMAIL', 'PUSH'])),
  twoFactorEnabled: z.boolean(),
}).partial()

@Controller('users')
export class UsersController {
  constructor(private db: PrismaService, private engine: Engine, private acc: Access, private sync: Sync) {}

  @Get('me') me(@Me() u: any) { return publicUser(u) }

  @Patch('me')
  async update(@Me() u: any, @Body() b: any) {
    const d = parse(prefs, b)
    const n = await this.db.user.update({ where: { id: u.id }, data: d })
    const changed = profileDiff(u, n)
    if (changed.length) await this.sync.changed(u.id, u, 'profile', `${changed.join(', ')} updated`)
    else if (d.shareProfile !== undefined) await this.sync.push(u.id, 'profile')
    if (d.timezone !== undefined || d.leadMinutes !== undefined) {
      for (const m of await this.db.medication.findMany({ where: { patientId: u.id, status: 'ACTIVE' } })) await this.engine.regen(m, n)
    }
    return publicUser(n)
  }

  @Post('me/push')
  async push(@Me() u: any, @Body() b: any) {
    await this.db.user.update({ where: { id: u.id }, data: { pushSub: b.subscription } })
    return { ok: true }
  }

  @Post('me/deactivate')
  async deactivate(@Me() u: any) {
    await this.db.user.update({ where: { id: u.id }, data: { status: 'DEACTIVATED' } })
    await this.db.refreshToken.deleteMany({ where: { userId: u.id } })
    await this.acc.log(u.id, 'DEACTIVATE')
    return { ok: true }
  }

  @Get('me/export')
  async export(@Me() u: any) {
    const w = { patientId: u.id }
    const [medications, prescriptions, doses, journal, measurements, notes, notifications, links, allergies] = await Promise.all([
      this.db.medication.findMany({ where: w }), this.db.prescription.findMany({ where: w }), this.db.doseLog.findMany({ where: w }),
      this.db.journal.findMany({ where: w }), this.db.measurement.findMany({ where: w }), this.db.doctorNote.findMany({ where: w }),
      this.db.notification.findMany({ where: { userId: u.id } }), this.db.link.findMany({ where: { OR: [{ patientId: u.id }, { memberId: u.id }] } }), this.db.allergy.findMany({ where: w }),
    ])
    return { exportedAt: new Date(), profile: publicUser(u), allergies, medications, prescriptions, doses, journal, measurements, notes, notifications, links }
  }

  @Delete('me')
  async remove(@Me() u: any, @Body() b: any) {
    if (!(await bcrypt.compare(String(b?.password || ''), u.passwordHash))) throw new BadRequestException('Password is incorrect')
    const w = { patientId: u.id }
    for (const d of await this.db.document.findMany({ where: w })) fs.unlink(d.path, () => null)
    await Promise.all([
      this.db.doseLog.deleteMany({ where: w }), this.db.prescription.deleteMany({ where: w }), this.db.medication.deleteMany({ where: w }),
      this.db.journal.deleteMany({ where: w }), this.db.measurement.deleteMany({ where: w }), this.db.document.deleteMany({ where: w }), this.db.allergy.deleteMany({ where: w }),
      this.db.doctorNote.deleteMany({ where: w }), this.db.notification.deleteMany({ where: { userId: u.id } }),
      this.db.refreshToken.deleteMany({ where: { userId: u.id } }), this.db.link.deleteMany({ where: { OR: [{ patientId: u.id }, { memberId: u.id }] } }),
    ])
    await this.db.user.delete({ where: { id: u.id } })
    await this.acc.log(null, 'ACCOUNT_DELETED', u.email)
    return { ok: true }
  }
}

const profileBody = z.object({
  name: z.string().trim().min(1).max(100), age: z.number().int().min(0).max(130).nullable(), conditions: z.array(z.string().trim()),
  phone: z.string().nullable(), emergencyName: z.string().nullable(), emergencyPhone: z.string().nullable(),
}).partial()
const view = (p: any) => ({ id: p.id, name: p.name, email: p.email, age: p.age, conditions: p.conditions, phone: p.phone, emergencyName: p.emergencyName, emergencyPhone: p.emergencyPhone, timezone: p.timezone, shareProfile: p.shareProfile })

@Controller('patients')
export class ProfileController {
  constructor(private db: PrismaService, private acc: Access, private sync: Sync) {}

  @Get(':pid/profile')
  async profile(@Me() u: any, @Param('pid') pid: string) {
    const { id, self } = await this.acc.resolve(u, pid)
    const p = await this.db.user.findUnique({ where: { id } })
    if (!p) return null
    if (self || p.shareProfile) return view(p)
    return { id: p.id, name: p.name, timezone: p.timezone, shareProfile: false } // patient chose to hide details
  }

  /** A caregiver with "edit" permission can update the patient's details for them (e.g. patient cannot use the site). */
  @Patch(':pid/profile')
  async edit(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const old = await this.db.user.findUnique({ where: { id } })
    const n = await this.db.user.update({ where: { id }, data: parse(profileBody, b) })
    const changed = profileDiff(old, n)
    if (changed.length) await this.sync.changed(id, u, 'profile', `${changed.join(', ')} updated`)
    return view(n)
  }

  /** Everything a doctor/caregiver needs on one screen: who the patient is, allergies, what they take, recent doses. */
  @Get(':pid/overview')
  async overview(@Me() u: any, @Param('pid') pid: string) {
    const { id, self, perms } = await this.acc.resolve(u, pid)
    const p = await this.db.user.findUnique({ where: { id } })
    const now = new Date()
    const [allergies, meds, prescriptions, recent, upcoming] = await Promise.all([
      this.db.allergy.findMany({ where: { patientId: id }, orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }] }),
      perms.includes('meds') ? this.db.medication.findMany({ where: { patientId: id, status: { in: ['ACTIVE', 'PAUSED'] } }, orderBy: { createdAt: 'desc' } }) : [],
      perms.includes('meds') ? this.db.prescription.findMany({ where: { patientId: id }, orderBy: { issuedAt: 'desc' }, take: 6, include: { medication: { select: { name: true } } } }) : [],
      perms.includes('adherence') ? this.db.doseLog.findMany({ where: { patientId: id, status: { not: 'PENDING' }, scheduledAt: { lte: now } }, orderBy: { scheduledAt: 'desc' }, take: 10, include: { medication: { select: { name: true, dosage: true } } } }) : [],
      perms.includes('meds') ? this.db.doseLog.findMany({ where: { patientId: id, status: 'PENDING', scheduledAt: { gte: now } }, orderBy: { scheduledAt: 'asc' }, take: 5, include: { medication: { select: { name: true, dosage: true } } } }) : [],
    ])
    return { self, perms, profile: self || p.shareProfile ? view(p) : { id: p.id, name: p.name, timezone: p.timezone, shareProfile: false }, allergies, meds, prescriptions: prescriptions.map(({ verifyToken, ...r }: any) => ({ ...r, status: r.status ?? 'ACTIVE' })), recent, upcoming }
  }
}
