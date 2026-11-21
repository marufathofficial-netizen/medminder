import { Controller, Get, Param, Query, Res } from '@nestjs/common'
import { DateTime } from 'luxon'
import PDFDocument = require('pdfkit')
import { Response } from 'express'
import { Access, Me, PrismaService } from './common'

@Controller('patients/:pid')
export class ReportsController {
  constructor(private db: PrismaService, private acc: Access) {}

  async stats(pid: string, days: number) {
    const p = await this.db.user.findUnique({ where: { id: pid } })
    const tz = p.timezone
    const start = DateTime.now().setZone(tz).startOf('day').minus({ days: days - 1 })
    const ds = await this.db.doseLog.findMany({ where: { patientId: pid, scheduledAt: { gte: start.toJSDate() }, status: { in: ['TAKEN', 'MISSED', 'SKIPPED'] } }, include: { medication: { select: { name: true } } }, orderBy: { scheduledAt: 'asc' } })
    const daily = new Map<string, any>()
    for (let i = 0; i < days; i++) { const k = start.plus({ days: i }).toISODate(); daily.set(k, { date: k, taken: 0, missed: 0, skipped: 0 }) }
    const byMed = new Map<string, any>()
    for (const d of ds) {
      const s = d.status.toLowerCase()
      const e = daily.get(DateTime.fromJSDate(d.scheduledAt, { zone: tz }).toISODate())
      if (e) e[s]++
      const m = byMed.get(d.medication.name) || { name: d.medication.name, taken: 0, missed: 0, skipped: 0 }
      m[s]++; byMed.set(d.medication.name, m)
    }
    const arr = [...daily.values()]
    let streak = 0
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]
      if (!(e.taken + e.missed + e.skipped)) continue
      if (e.missed || e.skipped) break
      streak++
    }
    const c = (s: string) => ds.filter((d) => d.status === s).length
    const total = ds.length
    return { days, total, taken: c('TAKEN'), missed: c('MISSED'), skipped: c('SKIPPED'), rate: total ? Math.round((c('TAKEN') / total) * 100) : null, streak, daily: arr, byMed: [...byMed.values()].map((m) => ({ ...m, rate: Math.round((m.taken / (m.taken + m.missed + m.skipped)) * 100) })) }
  }

  @Get('adherence') async adherence(@Me() u: any, @Param('pid') pid: string, @Query('days') days: string) {
    const { id } = await this.acc.resolve(u, pid, 'adherence')
    return this.stats(id, Math.min(Math.max(Number(days) || 30, 1), 180))
  }

  @Get('report.pdf') async pdf(@Me() u: any, @Param('pid') pid: string, @Query('days') days: string, @Res() res: Response) {
    const { id } = await this.acc.resolve(u, pid, 'adherence')
    const n = Math.min(Math.max(Number(days) || 30, 1), 180)
    const [p, s, meds, doses, ms] = await Promise.all([
      this.db.user.findUnique({ where: { id } }), this.stats(id, n),
      this.db.medication.findMany({ where: { patientId: id, status: { not: 'STOPPED' } } }),
      this.db.doseLog.findMany({ where: { patientId: id, status: { not: 'PENDING' } }, include: { medication: { select: { name: true } } }, orderBy: { scheduledAt: 'desc' }, take: 60 }),
      this.db.measurement.findMany({ where: { patientId: id }, orderBy: { measuredAt: 'desc' }, take: 15 }),
    ])
    const f = (d: Date) => DateTime.fromJSDate(d, { zone: p.timezone }).toFormat('dd LLL yyyy HH:mm')
    const doc = new PDFDocument({ margin: 40 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="medminder-report.pdf"')
    doc.pipe(res)
    doc.fontSize(20).text('MedMinder Adherence Report')
    doc.fontSize(10).fillColor('#555').text(`Generated ${f(new Date())} | Last ${n} days`).fillColor('#000').moveDown()
    doc.fontSize(13).text('Patient')
    doc.fontSize(10).text(`${p.name}${p.age ? ', age ' + p.age : ''}`)
    const als = await this.db.allergy.findMany({ where: { patientId: p.id } })
    doc.text(`Allergies: ${als.map((a) => a.substance + (a.reaction ? ' - ' + a.reaction : '') + ' (' + a.severity.toLowerCase() + ')').join('; ') || 'none recorded'}`)
    if (p.shareProfile || p.id === u.id) doc.text(`Conditions: ${p.conditions.join(', ') || 'none recorded'}`)
    doc.moveDown().fontSize(13).text('Adherence')
    doc.fontSize(10).text(`Rate: ${s.rate ?? 'n/a'}%  |  Taken: ${s.taken}  Missed: ${s.missed}  Skipped: ${s.skipped}  |  Current streak: ${s.streak} days`)
    s.byMed.forEach((m) => doc.text(`  ${m.name}: ${m.rate}% (${m.taken} taken, ${m.missed} missed, ${m.skipped} skipped)`))
    doc.moveDown().fontSize(13).text('Current medications')
    doc.fontSize(10)
    meds.forEach((m) => doc.text(`${m.name} ${m.dosage} - ${(m.schedule as any).type}${(m.schedule as any).times?.length ? ' at ' + (m.schedule as any).times.join(', ') : ''} [${m.status}]${m.instructions ? ' - ' + m.instructions : ''}`))
    doc.moveDown().fontSize(13).text('Recent dose history')
    doc.fontSize(9)
    doses.forEach((d) => doc.text(`${f(d.scheduledAt)}  ${d.medication.name}  ${d.status}${d.skipReason ? ' (' + d.skipReason + ')' : ''}${d.sideEffects ? ' - side effects: ' + d.sideEffects : ''}`))
    if (ms.length) {
      doc.moveDown().fontSize(13).text('Recent measurements')
      doc.fontSize(9)
      ms.forEach((m) => doc.text(`${f(m.measuredAt)}  ${m.type}: ${m.value}${m.value2 != null ? '/' + m.value2 : ''} ${m.unit}`))
    }
    doc.end()
  }
}
