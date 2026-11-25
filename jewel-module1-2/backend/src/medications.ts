import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { Access, Me, PrismaService, allergyWarnings, localDate, parse } from './common'
import { Engine, Sync } from './services'

/** Jewel - Module 1 feature 14: add, edit and delete medications (name, dosage, form, instructions, schedule). */
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
