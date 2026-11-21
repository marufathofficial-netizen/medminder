import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Response } from 'express'
import * as fs from 'fs'
import { diskStorage } from 'multer'
import * as path from 'path'
import { z } from 'zod'
import { Access, Me, PrismaService, parse, rand } from './common'
import { Notifier, Sync } from './services'

const UP = path.join(process.cwd(), 'uploads')
fs.mkdirSync(UP, { recursive: true })
const UNITS: any = { BP: 'mmHg', GLUCOSE: 'mg/dL', WEIGHT: 'kg' }

@Controller('patients/:pid')
export class HealthController {
  constructor(private db: PrismaService, private acc: Access, private nt: Notifier, private sync: Sync) {}

  // ---- symptom & mood journal ----
  @Get('journal') async journal(@Me() u: any, @Param('pid') pid: string, @Query() q: any) {
    const { id } = await this.acc.resolve(u, pid, 'journal')
    return this.db.journal.findMany({ where: { patientId: id }, orderBy: { date: 'desc' }, take: Math.min(Number(q.take) || 100, 500) })
  }
  @Post('journal') async addJournal(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const d = parse(z.object({ date: z.string().optional(), mood: z.number().int().min(1).max(5), symptoms: z.string().optional(), medicationId: z.string().nullable().optional(), notes: z.string().optional() }), b)
    const j = await this.db.journal.create({ data: { patientId: id, date: d.date ? new Date(d.date) : new Date(), mood: d.mood, symptoms: d.symptoms, medicationId: d.medicationId || null, notes: d.notes } })
    await this.sync.push(id, 'health')
    return j
  }
  @Delete('journal/:jid') async delJournal(@Me() u: any, @Param('pid') pid: string, @Param('jid') jid: string) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    await this.db.journal.deleteMany({ where: { id: jid, patientId: id } })
    await this.sync.push(id, 'health')
    return { ok: true }
  }

  // ---- health measurements ----
  @Get('measurements') async measurements(@Me() u: any, @Param('pid') pid: string, @Query() q: any) {
    const { id } = await this.acc.resolve(u, pid, 'measurements')
    return this.db.measurement.findMany({ where: { patientId: id, ...(q.type ? { type: String(q.type) } : {}) }, orderBy: { measuredAt: 'desc' }, take: Math.min(Number(q.take) || 200, 500) })
  }
  @Post('measurements') async addMeasurement(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const d = parse(z.object({ type: z.enum(['BP', 'GLUCOSE', 'WEIGHT']), value: z.number(), value2: z.number().optional(), unit: z.string().optional(), measuredAt: z.string().optional() }), b)
    if (d.type === 'BP' && d.value2 == null) throw new BadRequestException('Blood pressure needs systolic and diastolic values')
    const m = await this.db.measurement.create({ data: { patientId: id, type: d.type, value: d.value, value2: d.value2, unit: d.unit || UNITS[d.type], measuredAt: d.measuredAt ? new Date(d.measuredAt) : new Date() } })
    await this.sync.push(id, 'health')
    return m
  }
  @Delete('measurements/:mid') async delMeasurement(@Me() u: any, @Param('pid') pid: string, @Param('mid') mid: string) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    await this.db.measurement.deleteMany({ where: { id: mid, patientId: id } })
    await this.sync.push(id, 'health')
    return { ok: true }
  }

  // ---- medical documents ----
  @Get('documents') async docs(@Me() u: any, @Param('pid') pid: string) {
    const { id } = await this.acc.resolve(u, pid, 'documents')
    return (await this.db.document.findMany({ where: { patientId: id }, orderBy: { uploadedAt: 'desc' } })).map(({ path: _p, ...d }) => d)
  }
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({ destination: UP, filename: (_r, f, cb) => cb(null, rand().slice(0, 24) + path.extname(f.originalname).slice(0, 8)) }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_r, f, cb) => cb(null, ['application/pdf', 'image/png', 'image/jpeg'].includes(f.mimetype)),
  }))
  async upload(@Me() u: any, @Param('pid') pid: string, @UploadedFile() f: Express.Multer.File) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    if (!f) throw new BadRequestException('Upload a PDF, PNG or JPG file up to 10 MB')
    const d = await this.db.document.create({ data: { patientId: id, filename: f.originalname, mimeType: f.mimetype, path: f.path } })
    const { path: _p, ...rest } = d
    await this.sync.push(id, 'health')
    return rest
  }
  @Get('documents/:did/file') async file(@Me() u: any, @Param('pid') pid: string, @Param('did') did: string, @Res() res: Response) {
    const { id } = await this.acc.resolve(u, pid, 'documents')
    const d = await this.db.document.findFirst({ where: { id: did, patientId: id } })
    if (!d || !fs.existsSync(d.path)) throw new NotFoundException()
    res.download(d.path, d.filename)
  }
  @Delete('documents/:did') async delDoc(@Me() u: any, @Param('pid') pid: string, @Param('did') did: string) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const d = await this.db.document.findFirst({ where: { id: did, patientId: id } })
    if (d) { fs.unlink(d.path, () => null); await this.db.document.delete({ where: { id: d.id } }) }
    await this.sync.push(id, 'health')
    return { ok: true }
  }

  // ---- doctor notes & recommendations ----
  @Get('notes') async notes(@Me() u: any, @Param('pid') pid: string) {
    const { id } = await this.acc.resolve(u, pid, 'meds')
    return this.db.doctorNote.findMany({ where: { patientId: id }, orderBy: { createdAt: 'desc' } })
  }
  @Post('notes') async addNote(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const { id, self } = await this.acc.resolve(u, pid, 'prescribe')
    if (self || u.role !== 'DOCTOR') throw new BadRequestException('Only linked doctors can leave notes')
    const { content } = parse(z.object({ content: z.string().min(1).max(4000) }), b)
    const n = await this.db.doctorNote.create({ data: { patientId: id, doctorId: u.id, doctorName: u.name, content } })
    await this.nt.notify(id, 'DOCTOR_NOTE', `New note from ${u.name}`, content.slice(0, 200))
    await this.sync.push(id, 'health')
    return n
  }

  // ---- combined timeline: doses + symptoms + measurements ----
  @Get('timeline') async timeline(@Me() u: any, @Param('pid') pid: string, @Query() q: any) {
    const { id, perms } = await this.acc.resolve(u, pid)
    const from = new Date(Date.now() - (Math.min(Number(q.days) || 30, 365)) * 864e5)
    const items: any[] = []
    if (perms.includes('adherence')) {
      for (const d of await this.db.doseLog.findMany({ where: { patientId: id, scheduledAt: { gte: from, lte: new Date() }, status: { not: 'PENDING' } }, include: { medication: { select: { name: true, dosage: true } } } }))
        items.push({ kind: 'dose', at: d.scheduledAt, title: `${d.medication.name} ${d.medication.dosage}`, detail: d.status + (d.skipReason ? ` (${d.skipReason})` : '') + (d.sideEffects ? ` - side effects: ${d.sideEffects}` : '') })
    }
    if (perms.includes('journal')) {
      for (const j of await this.db.journal.findMany({ where: { patientId: id, date: { gte: from } } }))
        items.push({ kind: 'journal', at: j.date, title: `Mood ${j.mood}/5`, detail: [j.symptoms, j.notes].filter(Boolean).join(' - ') })
    }
    if (perms.includes('measurements')) {
      for (const m of await this.db.measurement.findMany({ where: { patientId: id, measuredAt: { gte: from } } }))
        items.push({ kind: 'measurement', at: m.measuredAt, title: m.type, detail: `${m.value}${m.value2 != null ? '/' + m.value2 : ''} ${m.unit}` })
    }
    return items.sort((a, b) => +new Date(b.at) - +new Date(a.at))
  }
}
