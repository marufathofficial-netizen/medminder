import { Body, Controller, Get, Param, Patch } from '@nestjs/common'
import { z } from 'zod'
import { Access, Me, PrismaService, parse, publicUser, tzSchema } from './common'
import { Engine, Sync } from './services'

/** Jewel - Module 1 feature 13: profile creation and editing (personal details, emergency contact, timezone). */
const PROFILE_FIELDS: [string, string][] = [['name', 'name'], ['age', 'age'], ['conditions', 'conditions'], ['phone', 'phone'], ['emergencyName', 'emergency contact'], ['emergencyPhone', 'emergency phone']]
/** names the profile fields that really changed, so care-team notices say exactly what is new */
const profileDiff = (a: any, b: any) => PROFILE_FIELDS.filter(([k]) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).map(([, l]) => l)
const prefs = z.object({
  name: z.string().min(1), age: z.number().int().min(0).max(130).nullable(),
  conditions: z.array(z.string()),
  phone: z.string().nullable(), emergencyName: z.string().nullable(), emergencyPhone: z.string().nullable(),
  timezone: tzSchema,
}).partial()

@Controller('users')
export class ProfileSelfController {
  constructor(private db: PrismaService, private engine: Engine, private sync: Sync) {}

  @Get('me') me(@Me() u: any) { return publicUser(u) }

  @Patch('me')
  async update(@Me() u: any, @Body() b: any) {
    const d = parse(prefs, b)
    const n = await this.db.user.update({ where: { id: u.id }, data: d })
    const changed = profileDiff(u, n)
    if (changed.length) await this.sync.changed(u.id, u, 'profile', `${changed.join(', ')} updated`)
    if (d.timezone !== undefined) {
      for (const m of await this.db.medication.findMany({ where: { patientId: u.id, status: 'ACTIVE' } })) await this.engine.regen(m, n)
    }
    return publicUser(n)
  }
}

const profileBody = z.object({
  name: z.string().trim().min(1).max(100), age: z.number().int().min(0).max(130).nullable(), conditions: z.array(z.string().trim()),
  phone: z.string().nullable(), emergencyName: z.string().nullable(), emergencyPhone: z.string().nullable(),
}).partial()
const view = (p: any) => ({ id: p.id, name: p.name, email: p.email, age: p.age, conditions: p.conditions, phone: p.phone, emergencyName: p.emergencyName, emergencyPhone: p.emergencyPhone, timezone: p.timezone, shareProfile: p.shareProfile })

@Controller('patients')
export class PatientProfileController {
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
}
