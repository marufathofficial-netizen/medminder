import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { Access, Me, PrismaService, doseTimes, parse } from './common'
import { Engine, Sync } from './services'

/** Jewel - Module 1 feature 16 (calendar data), Module 2 features 12-14 (snooze/reschedule, mark taken/missed/skipped, dose history with filters). */
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
