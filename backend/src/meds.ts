import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { Access, APP_URL, Mailer, Me, PrismaService, allergyWarnings, doseTimes, limit, localDate, parse, rand, sha } from './common'
import { Engine, Notifier, Sync } from './services'

const day = z.string().regex(/^\d{4}-\d\d-\d\d/)
const sched = z.object({
  type: z.enum(['DAILY', 'WEEKLY', 'DAYS', 'INTERVAL', 'ASNEEDED']),
  times: z.array(z.string().regex(/^\d\d:\d\d$/)).default([]),
  days: z.array(z.number().int().min(0).max(6)).default([]),
  intervalDays: z.number().int().min(1).optional(),
}).refine((s) => s.type === 'ASNEEDED' || s.times.length > 0, 'Add at least one dose time')
const medBody = z.object({
  name: z.string().min(1), dosage: z.string().min(1), form: z.string().optional(), instructions: z.string().optional(),
  startDate: day, endDate: day.nullable().optional(), durationDays: z.number().int().min(1).nullable().optional(),
  schedule: sched, pillCount: z.number().int().min(0).nullable().optional(),
  lowStockAt: z.number().int().min(0).default(5), unitsPerDose: z.number().int().min(1).default(1),
})

@Controller('patients/:pid/medications')
export class MedsController {
  constructor(private db: PrismaService, private acc: Access, private engine: Engine, private sync: Sync) {}

  private async own(id: string, pid: string) {
    const m = await this.db.medication.findFirst({ where: { id, patientId: pid } })
    if (!m) throw new NotFoundException('Medication not found')
    return m
  }

  @Get() async list(@Me() u: any, @Param('pid') pid: string) {
    const { id } = await this.acc.resolve(u, pid, 'meds')
    return this.db.medication.findMany({ where: { patientId: id }, orderBy: { createdAt: 'desc' } })
  }

  @Post() async create(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const p = await this.db.user.findUnique({ where: { id } })
    const d = parse(medBody, b)
    const startDate = localDate(d.startDate.slice(0, 10), p.timezone)
    let endDate = d.endDate ? localDate(d.endDate.slice(0, 10), p.timezone) : null
    if (!endDate && d.durationDays) endDate = DateTime.fromJSDate(startDate, { zone: p.timezone }).plus({ days: d.durationDays - 1 }).toJSDate()
    const m = await this.db.medication.create({ data: { patientId: id, name: d.name, dosage: d.dosage, form: d.form, instructions: d.instructions, startDate, endDate, durationDays: d.durationDays ?? null, schedule: d.schedule, pillCount: d.pillCount ?? null, lowStockAt: d.lowStockAt, unitsPerDose: d.unitsPerDose, createdById: u.id } })
    await this.engine.generate(m, p)
    await this.engine.checkStock(m.id)
    await this.acc.log(u.id, 'MED_CREATE', m.name)
    const warnings = allergyWarnings(await this.db.allergy.findMany({ where: { patientId: id } }), d.name)
    const dup = await this.db.medication.count({ where: { patientId: id, status: 'ACTIVE', name: { equals: d.name, mode: 'insensitive' }, NOT: { id: m.id } } })
    if (dup) warnings.push('There is already an active medication with this name')
    await this.sync.changed(id, u, 'medications', `${m.name} ${m.dosage} was added`)
    return { ...m, warnings }
  }

  @Patch(':id') async update(@Me() u: any, @Param('pid') pid: string, @Param('id') mid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const old = await this.own(mid, id)
    const p = await this.db.user.findUnique({ where: { id } })
    const d = parse(medBody.partial(), b)
    const { startDate, endDate, ...rest } = d
    const data: any = { ...rest }
    if (startDate) data.startDate = localDate(startDate.slice(0, 10), p.timezone)
    if (endDate !== undefined) data.endDate = endDate ? localDate(endDate.slice(0, 10), p.timezone) : null
    const m = await this.db.medication.update({ where: { id: mid }, data })
    if (d.schedule || startDate || endDate !== undefined) await this.engine.regen(m, p)
    await this.engine.checkStock(m.id)
    await this.sync.changed(id, u, 'medications', `${m.name} ${m.dosage} was changed`)
    const warnings = allergyWarnings(await this.db.allergy.findMany({ where: { patientId: id } }), m.name)
    return { ...m, warnings }
  }

  /** Pause / resume / stop: dose history is kept, only future pending doses change. */
  @Post(':id/status') async status(@Me() u: any, @Param('pid') pid: string, @Param('id') mid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    await this.own(mid, id)
    const { status } = parse(z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'STOPPED']) }), b)
    const m = await this.db.medication.update({ where: { id: mid }, data: { status } })
    const p = await this.db.user.findUnique({ where: { id } })
    await this.engine.regen(m, p)
    await this.sync.changed(id, u, 'medications', `${m.name} is now ${status.toLowerCase()}`)
    return m
  }

  @Post(':id/refill') async refill(@Me() u: any, @Param('pid') pid: string, @Param('id') mid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const m = await this.own(mid, id)
    const d = parse(z.object({ quantity: z.number().int().min(1), prescriptionId: z.string().optional() }), b)
    if (d.prescriptionId) await this.db.prescription.updateMany({ where: { id: d.prescriptionId, patientId: id }, data: { refillsUsed: { increment: 1 } } })
    const n = await this.db.medication.update({ where: { id: mid }, data: { pillCount: (m.pillCount ?? 0) + d.quantity } })
    await this.engine.checkStock(mid)
    await this.sync.push(id, 'medications')
    return n
  }

  @Delete(':id') async remove(@Me() u: any, @Param('pid') pid: string, @Param('id') mid: string) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const m0 = await this.own(mid, id)
    await this.db.doseLog.deleteMany({ where: { medicationId: mid } })
    await this.db.prescription.updateMany({ where: { medicationId: mid }, data: { medicationId: null } })
    await this.db.medication.delete({ where: { id: mid } })
    await this.sync.changed(id, u, 'medications', `${m0.name} was deleted`)
    return { ok: true }
  }
}

const rx = z.object({
  medicationId: z.string().nullable().optional(), drugName: z.string().trim().max(120).optional(), dosage: z.string().trim().max(80).optional(),
  doctorName: z.string().trim().max(100).optional(), doctorEmail: z.string().trim().email().optional(),
  issuedAt: z.string(), quantity: z.number().int().min(0),
  refillsTotal: z.number().int().min(0).default(0), refillsUsed: z.number().int().min(0).default(0),
  expiresAt: z.string().nullable().optional(), instructions: z.string().max(1000).optional(),
})
const out = ({ verifyToken, ...r }: any) => ({ ...r, status: r.status ?? 'ACTIVE' })
const isActive = (r: any) => (r.status ?? 'ACTIVE') === 'ACTIVE'

/** Prescription verification: a prescription typed in by a patient/caregiver only becomes ACTIVE once the named doctor confirms it. */
@Injectable()
export class Rx {
  constructor(private db: PrismaService, private mail: Mailer, private sync: Sync) {}

  async sendVerification(r: any, patient: any) {
    const token = rand()
    const med = r.medicationId ? await this.db.medication.findUnique({ where: { id: r.medicationId } }) : null
    const drug = med?.name || r.drugName || 'a medication'
    await this.db.prescription.update({ where: { id: r.id }, data: { verifyToken: sha(token), verifyExpires: new Date(Date.now() + 7 * 864e5) } })
    await this.mail.send(r.doctorEmail, `Please confirm a prescription for ${patient.name}`,
      `A MedMinder user, ${patient.name} (${patient.email}), recorded a prescription in your name:\n\nMedication: ${drug}${r.dosage ? ' ' + r.dosage : ''}\nQuantity: ${r.quantity}   Refills: ${r.refillsTotal}\nIssued: ${new Date(r.issuedAt).toDateString()}${r.instructions ? '\nInstructions: ' + r.instructions : ''}\n\nIf you issued this prescription, log in to MedMinder with this email and confirm it:\n${APP_URL()}/rx-verify?token=${token}\n\nIf you did NOT issue it, open the same link and choose Reject. Until you confirm, it stays inactive and it expires automatically in 7 days.`)
  }

  async decide(u: any, r: any, approve: boolean, reason?: string) {
    if (u.role !== 'DOCTOR') throw new ForbiddenException('Only the named doctor can do this')
    if (r.status !== 'PENDING') throw new BadRequestException('This prescription has already been handled')
    if (!(r.doctorId === u.id || (r.doctorEmail && r.doctorEmail === u.email))) throw new ForbiddenException('This prescription was not addressed to you')
    if (r.verifyExpires && r.verifyExpires < new Date()) throw new BadRequestException('The confirmation window has expired. Ask the patient to send it again.')
    if (approve) {
      await this.db.prescription.update({ where: { id: r.id }, data: { status: 'ACTIVE', verifiedAt: new Date(), verifyToken: null, verifyExpires: null, doctorId: u.id, doctorName: u.name, rejectReason: null } })
      if (r.medicationId && (r.dosage || r.instructions))
        await this.db.medication.updateMany({ where: { id: r.medicationId, patientId: r.patientId }, data: { ...(r.dosage ? { dosage: r.dosage } : {}), ...(r.instructions ? { instructions: r.instructions } : {}) } })
    } else {
      await this.db.prescription.update({ where: { id: r.id }, data: { status: 'REJECTED', verifyToken: null, verifyExpires: null, rejectReason: reason || 'Rejected by the doctor' } })
    }
    const drug = r.drugName || 'prescription'
    await this.sync.changed(r.patientId, u, 'prescriptions', approve ? `Dr. ${u.name} confirmed the ${drug} prescription` : `Dr. ${u.name} rejected the ${drug} prescription${reason ? ': ' + reason : ''}`)
    return { ok: true, status: approve ? 'ACTIVE' : 'REJECTED' }
  }
}

@Controller('patients/:pid/prescriptions')
export class PrescriptionsController {
  constructor(private db: PrismaService, private acc: Access, private nt: Notifier, private sync: Sync, private rx: Rx) {}

  @Get() async list(@Me() u: any, @Param('pid') pid: string) {
    const { id } = await this.acc.resolve(u, pid, 'meds')
    const rows = await this.db.prescription.findMany({ where: { patientId: id }, include: { medication: { select: { name: true } } }, orderBy: { issuedAt: 'desc' } })
    return rows.map(out)
  }

  @Post() async create(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const a = await this.acc.resolve(u, pid, 'edit', 'prescribe')
    const d = parse(rx, b)
    if (!d.medicationId && !d.drugName) throw new BadRequestException('Choose a medication or type its name')
    const med = d.medicationId ? await this.db.medication.findFirst({ where: { id: d.medicationId, patientId: a.id } }) : null
    if (d.medicationId && !med) throw new BadRequestException('Medication not found')
    const patient = await this.db.user.findUnique({ where: { id: a.id } })
    const drug = med?.name || d.drugName!
    const warnings = allergyWarnings(await this.db.allergy.findMany({ where: { patientId: a.id } }), drug)
    const base = { patientId: a.id, medicationId: med?.id ?? null, drugName: d.drugName || null, dosage: d.dosage || null, issuedAt: new Date(d.issuedAt), quantity: d.quantity, refillsTotal: d.refillsTotal, refillsUsed: Math.min(d.refillsUsed, d.refillsTotal), expiresAt: d.expiresAt ? new Date(d.expiresAt) : null, instructions: d.instructions, createdById: u.id }

    // A linked doctor writing a prescription: active immediately, visible to patient and caregivers.
    if (u.role === 'DOCTOR' && !a.self) {
      const r = await this.db.prescription.create({ data: { ...base, doctorName: u.name, doctorId: u.id, doctorEmail: u.email, status: 'ACTIVE', verifiedAt: new Date() } })
      if (med && (d.dosage || d.instructions) && a.perms.includes('edit'))
        await this.db.medication.update({ where: { id: med.id }, data: { ...(d.dosage ? { dosage: d.dosage } : {}), ...(d.instructions ? { instructions: d.instructions } : {}) } })
      await this.sync.changed(a.id, u, 'prescriptions', `Dr. ${u.name} prescribed ${drug}`)
      return { ...out(r), warnings }
    }

    // Patient / caregiver: the named doctor must confirm by email before it counts.
    if (!d.doctorEmail) throw new BadRequestException("Enter your doctor's email so they can confirm this prescription")
    const email = d.doctorEmail.toLowerCase()
    if (email === u.email || email === patient.email) throw new BadRequestException('You cannot confirm your own prescription - a doctor must')
    limit('rx:' + u.id, 10, 3600e3)
    const doc = await this.db.user.findUnique({ where: { email } })
    if (doc && doc.role !== 'DOCTOR') throw new BadRequestException('That email belongs to an account that is not a doctor')
    const r = await this.db.prescription.create({ data: { ...base, doctorName: doc?.name || d.doctorName || 'Not specified', doctorId: doc?.id ?? null, doctorEmail: email, status: 'PENDING' } })
    try { await this.rx.sendVerification(r, patient) } catch (e) { await this.db.prescription.delete({ where: { id: r.id } }); throw e }
    if (doc) await this.nt.notify(doc.id, 'RX_VERIFY', 'Prescription to confirm', `${patient.name} recorded a prescription in your name (${drug}). Please confirm or reject it.`, { force: true, data: { prescriptionId: r.id, patientId: a.id } })
    await this.sync.push(a.id, 'prescriptions', doc ? [doc.id] : [])
    return { ...out(r), warnings, message: `Saved. We emailed ${email} - the prescription becomes active once the doctor confirms it.` }
  }

  @Patch(':id') async update(@Me() u: any, @Param('pid') pid: string, @Param('id') rid: string, @Body() b: any) {
    const a = await this.acc.resolve(u, pid, 'edit', 'prescribe')
    const r = await this.db.prescription.findFirst({ where: { id: rid, patientId: a.id } })
    if (!r) throw new NotFoundException()
    if (u.role === 'DOCTOR' && !a.self) {
      if (!(r.doctorId === u.id || a.perms.includes('edit'))) throw new ForbiddenException('Ask the patient to allow editing under Care team')
      const { dosage, issuedAt, expiresAt, doctorName, doctorEmail, ...d } = parse(rx.partial(), b)
      const data: any = { ...d }
      if (dosage !== undefined) data.dosage = dosage || null
      if (issuedAt) data.issuedAt = new Date(issuedAt)
      if (expiresAt !== undefined) { data.expiresAt = expiresAt ? new Date(expiresAt) : null; data.expiryReminded = false }
      const n = await this.db.prescription.update({ where: { id: rid }, data })
      if (r.medicationId && (dosage || d.instructions) && a.perms.includes('edit'))
        await this.db.medication.update({ where: { id: r.medicationId }, data: { ...(dosage ? { dosage } : {}), ...(d.instructions ? { instructions: d.instructions } : {}) } })
      await this.sync.changed(a.id, u, 'prescriptions', `Dr. ${u.name} updated a prescription`)
      return out(n)
    }
    // Patients and caregivers can never rewrite a doctor-confirmed prescription; they can only count refills as used.
    if (!isActive(r)) throw new ForbiddenException('A prescription awaiting confirmation cannot be edited. Delete it and record it again.')
    const { refillsUsed } = parse(z.object({ refillsUsed: z.number().int().min(0) }), b)
    if (refillsUsed > r.refillsTotal) throw new BadRequestException('All refills are already used')
    const n = await this.db.prescription.update({ where: { id: rid }, data: { refillsUsed } })
    await this.sync.changed(a.id, u, 'prescriptions', 'A refill was marked as used')
    return out(n)
  }

  /** Doctor confirms / rejects from inside the app (same result as the emailed link). */
  @Post(':id/verify') async verify(@Me() u: any, @Param('pid') pid: string, @Param('id') rid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'prescribe')
    const { approve, reason } = parse(z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }), b)
    const r = await this.db.prescription.findFirst({ where: { id: rid, patientId: id } })
    if (!r) throw new NotFoundException()
    return this.rx.decide(u, r, approve, reason)
  }

  @Post(':id/resend') async resend(@Me() u: any, @Param('pid') pid: string, @Param('id') rid: string) {
    const a = await this.acc.resolve(u, pid, 'edit')
    const r = await this.db.prescription.findFirst({ where: { id: rid, patientId: a.id, status: 'PENDING' } })
    if (!r || !r.doctorEmail) throw new NotFoundException('No prescription waiting for confirmation')
    limit('rxresend:' + r.id, 3, 3600e3)
    await this.rx.sendVerification(r, await this.db.user.findUnique({ where: { id: a.id } }))
    return { message: `Confirmation email sent again to ${r.doctorEmail}` }
  }

  @Delete(':id') async remove(@Me() u: any, @Param('pid') pid: string, @Param('id') rid: string) {
    const a = await this.acc.resolve(u, pid, 'edit', 'prescribe')
    const r = await this.db.prescription.findFirst({ where: { id: rid, patientId: a.id } })
    if (!r) return { ok: true }
    if (u.role === 'DOCTOR' && !a.self) {
      if (!(r.doctorId === u.id || a.perms.includes('edit'))) throw new ForbiddenException('Ask the patient to allow editing under Care team')
    } else if (isActive(r) && !(r.expiresAt && r.expiresAt < new Date())) {
      throw new ForbiddenException('A confirmed prescription can only be removed by the doctor, or after it expires')
    }
    await this.db.prescription.delete({ where: { id: rid } })
    await this.sync.changed(a.id, u, 'prescriptions', 'A prescription was removed')
    return { ok: true }
  }
}

/** Doctor-side endpoints: the emailed link and the "waiting for me" list. */
@Controller('prescriptions')
export class RxVerifyController {
  constructor(private db: PrismaService, private rx: Rx) {}

  private async detail(r: any) {
    const [patient, allergies, med] = await Promise.all([
      this.db.user.findUnique({ where: { id: r.patientId }, select: { id: true, name: true, email: true, age: true } }),
      this.db.allergy.findMany({ where: { patientId: r.patientId }, orderBy: { createdAt: 'desc' } }),
      r.medicationId ? this.db.medication.findUnique({ where: { id: r.medicationId }, select: { name: true } }) : null,
    ])
    return { ...out(r), patient, allergies, medicationName: med?.name || null, warnings: allergyWarnings(allergies, med?.name || r.drugName || '') }
  }

  @Get('pending') async pending(@Me() u: any) {
    if (u.role !== 'DOCTOR') return []
    const rows = await this.db.prescription.findMany({ where: { status: 'PENDING', OR: [{ doctorId: u.id }, { doctorEmail: u.email }] }, orderBy: { createdAt: 'desc' } })
    return Promise.all(rows.map((r) => this.detail(r)))
  }

  /** In-app confirm/reject by id; only the named doctor passes the check inside decide(). */
  @Post(':id/decide') async decideById(@Me() u: any, @Param('id') rid: string, @Body() b: any) {
    const { approve, reason } = parse(z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }), b)
    const r = await this.db.prescription.findUnique({ where: { id: rid } })
    if (!r) throw new NotFoundException()
    return this.rx.decide(u, r, approve, reason)
  }

  @Get('verify/:token') async view(@Me() u: any, @Param('token') token: string) {
    const r = await this.db.prescription.findFirst({ where: { verifyToken: sha(token) } })
    if (!r || r.status !== 'PENDING') throw new NotFoundException('This confirmation link is invalid or was already used')
    if (u.role !== 'DOCTOR' || !(r.doctorId === u.id || r.doctorEmail === u.email)) throw new ForbiddenException('Log in with the doctor account this email was sent to')
    return this.detail(r)
  }

  @Post('verify/:token') async decide(@Me() u: any, @Param('token') token: string, @Body() b: any) {
    const { approve, reason } = parse(z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }), b)
    const r = await this.db.prescription.findFirst({ where: { verifyToken: sha(token) } })
    if (!r) throw new NotFoundException('This confirmation link is invalid or was already used')
    return this.rx.decide(u, r, approve, reason)
  }
}

@Controller('patients/:pid/doses')
export class DosesController {
  constructor(private db: PrismaService, private acc: Access, private engine: Engine, private sync: Sync) {}

  private async stock(m: any, delta: number) {
    if (m.pillCount == null || !delta) return
    await this.db.medication.update({ where: { id: m.id }, data: { pillCount: Math.max(0, m.pillCount + delta * m.unitsPerDose) } })
    await this.engine.checkStock(m.id)
  }

  @Get() async list(@Me() u: any, @Param('pid') pid: string, @Query() q: any) {
    const { id } = await this.acc.resolve(u, pid, 'meds')
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 864e5)
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 7 * 864e5)
    const where: any = { patientId: id, scheduledAt: { gte: from, lte: to } }
    if (q.status) where.status = String(q.status)
    if (q.medicationId) where.medicationId = String(q.medicationId)
    return this.db.doseLog.findMany({ where, include: { medication: { select: { name: true, dosage: true, form: true } } }, orderBy: { scheduledAt: q.order === 'desc' ? 'desc' : 'asc' }, take: Math.min(Number(q.take) || 500, 1000) })
  }

  /** Log an as-needed (unscheduled) dose */
  @Post() async adhoc(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const d = parse(z.object({ medicationId: z.string(), status: z.enum(['TAKEN', 'SKIPPED']).default('TAKEN'), at: z.string().optional(), sideEffects: z.string().optional(), skipReason: z.string().optional() }), b)
    const m = await this.db.medication.findFirst({ where: { id: d.medicationId, patientId: id } })
    if (!m) throw new NotFoundException('Medication not found')
    const at = d.at ? new Date(d.at) : new Date()
    const dose = await this.db.doseLog.create({ data: { patientId: id, medicationId: m.id, slot: at, scheduledAt: at, status: d.status, loggedAt: at, sideEffects: d.sideEffects, skipReason: d.skipReason, ...doseTimes(at, 0), reminderSent: true, followUpSent: true } })
    if (d.status === 'TAKEN') await this.stock(m, -1)
    await this.sync.push(id, 'doses')
    return dose
  }

  @Post(':id/log') async log(@Me() u: any, @Param('pid') pid: string, @Param('id') did: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const d = parse(z.object({ status: z.enum(['TAKEN', 'MISSED', 'SKIPPED', 'PENDING']), skipReason: z.string().optional(), sideEffects: z.string().optional(), at: z.string().optional() }), b)
    const dose = await this.db.doseLog.findFirst({ where: { id: did, patientId: id }, include: { medication: true } })
    if (!dose) throw new NotFoundException('Dose not found')
    const upd = await this.db.doseLog.update({ where: { id: did }, data: { status: d.status, loggedAt: d.status === 'PENDING' ? null : d.at ? new Date(d.at) : new Date(), skipReason: d.status === 'SKIPPED' ? d.skipReason : null, sideEffects: d.sideEffects ?? dose.sideEffects } })
    const was = dose.status === 'TAKEN', now = d.status === 'TAKEN'
    await this.stock(dose.medication, now ? -1 : was ? 1 : 0)
    if (d.status === 'MISSED' && dose.status !== 'MISSED') await this.engine.missedAlert(dose)
    await this.sync.push(id, 'doses')
    return upd
  }

  @Post(':id/snooze') async snooze(@Me() u: any, @Param('pid') pid: string, @Param('id') did: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const { minutes } = parse(z.object({ minutes: z.number().int().min(1).max(240).default(15) }), b)
    const base = new Date(Date.now() + minutes * 60000)
    const r = await this.db.doseLog.updateMany({ where: { id: did, patientId: id, status: 'PENDING' }, data: { remindAt: base, followUpAt: new Date(base.getTime() + 10 * 60000), deadline: new Date(base.getTime() + 30 * 60000), reminderSent: false, followUpSent: false } })
    if (!r.count) throw new NotFoundException('Pending dose not found')
    await this.sync.push(id, 'doses')
    return { ok: true, remindAt: base }
  }

  @Post(':id/reschedule') async reschedule(@Me() u: any, @Param('pid') pid: string, @Param('id') did: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const { scheduledAt } = parse(z.object({ scheduledAt: z.string() }), b)
    const at = new Date(scheduledAt)
    if (isNaN(at.getTime()) || at.getTime() < Date.now() - 60000) throw new BadRequestException('Pick a future time')
    const p = await this.db.user.findUnique({ where: { id } })
    const r = await this.db.doseLog.updateMany({ where: { id: did, patientId: id, status: 'PENDING' }, data: { scheduledAt: at, ...doseTimes(at, p.leadMinutes), reminderSent: false, followUpSent: false } })
    if (!r.count) throw new NotFoundException('Pending dose not found')
    await this.sync.push(id, 'doses')
    return { ok: true }
  }
}
