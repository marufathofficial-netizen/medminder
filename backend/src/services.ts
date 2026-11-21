import { Injectable, OnModuleInit } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import * as bcrypt from 'bcryptjs'
import { Queue, Worker } from 'bullmq'
import { DateTime } from 'luxon'
import { Server, Socket } from 'socket.io'
import * as webpush from 'web-push'
import { Mailer, PrismaService, doseTimes, genDoses, retry } from './common'

@WebSocketGateway({ cors: { origin: true } })
export class Gateway implements OnGatewayConnection {
  @WebSocketServer() server: Server
  constructor(private jwt: JwtService) {}
  handleConnection(c: Socket) {
    try { c.join('user:' + this.jwt.verify(String(c.handshake.auth?.token || '')).sub) } catch { c.disconnect() }
  }
  emit(uid: string, ev: string, data: any) { this.server?.to('user:' + uid).emit(ev, data) }
}

@Injectable()
export class Notifier {
  private push = false
  constructor(private db: PrismaService, private mail: Mailer, private gw: Gateway) {
    if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@medminder.local', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE)
      this.push = true
    }
  }
  quiet(u: any) {
    if (!u.quietStart || !u.quietEnd) return false
    const n = DateTime.now().setZone(u.timezone)
    const cur = n.hour * 60 + n.minute
    const [a, b] = [u.quietStart, u.quietEnd].map((t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m })
    return a <= b ? cur >= a && cur < b : cur >= a || cur < b
  }
  /** In-app (always) + realtime socket + email/push per user prefs. Quiet hours suppress email/push unless force. inAppOnly skips email/push. */
  async notify(userId: string, type: string, title: string, body: string, o: { force?: boolean; inAppOnly?: boolean; data?: any } = {}) {
    const u = await this.db.user.findUnique({ where: { id: userId } })
    if (!u || u.status !== 'ACTIVE') return
    const n = await this.db.notification.create({ data: { userId, type, title, body, data: o.data } })
    this.gw.emit(userId, 'notification', n)
    if (o.inAppOnly) return
    if (!o.force && this.quiet(u)) return
    if (u.channels.includes('EMAIL')) retry(() => this.mail.send(u.email, title, body)).catch((e) => console.error('email failed:', e.message))
    if (this.push && u.channels.includes('PUSH') && u.pushSub) retry(() => webpush.sendNotification(u.pushSub as any, JSON.stringify({ title, body }))).catch((e) => console.error('push failed:', e.message))
  }
}

/** Keeps patient, caregivers and doctors looking at the same data: every change is pushed to everyone linked. */
@Injectable()
export class Sync {
  constructor(private db: PrismaService, private nt: Notifier, private gw: Gateway) {}

  async members(patientId: string): Promise<string[]> {
    const ls = await this.db.link.findMany({ where: { patientId, status: 'ACTIVE', memberId: { not: null } }, select: { memberId: true } })
    return [...new Set(ls.map((l) => l.memberId as string))]
  }

  /** Tell every connected screen of the patient and their care team to reload `what` (silent). */
  async push(patientId: string, what: string, extra: string[] = []) {
    const ids = new Set([patientId, ...(await this.members(patientId)), ...extra])
    for (const id of ids) this.gw.emit(id, 'sync', { patientId, what })
  }

  /** push + an in-app notice to everyone except the person who made the change. */
  async changed(patientId: string, actor: { id: string; name: string }, what: string, detail: string, extra: string[] = []) {
    await this.push(patientId, what, extra)
    const p = await this.db.user.findUnique({ where: { id: patientId }, select: { name: true } })
    const ids = [...new Set([patientId, ...(await this.members(patientId))])].filter((i) => i !== actor.id)
    for (const id of ids) {
      const mine = id === patientId
      await this.nt.notify(id, 'CHANGE', mine ? `${actor.name} updated your ${what}` : `${p?.name || 'Patient'}: ${what} updated`, mine ? detail : `${actor.name === p?.name ? 'Updated by the patient' : 'Updated by ' + actor.name}: ${detail}`, { inAppOnly: true, data: { patientId, what } })
    }
  }
}

@Injectable()
export class Engine implements OnModuleInit {
  constructor(private db: PrismaService, private nt: Notifier, private sync: Sync) {}

  async onModuleInit() {
    if (process.env.REDIS_URL) {
      const u = new URL(process.env.REDIS_URL)
      const connection: any = { host: u.hostname, port: Number(u.port || 6379), username: u.username || undefined, password: u.password || undefined, tls: u.protocol === 'rediss:' ? {} : undefined, maxRetriesPerRequest: null }
      const q = new Queue('medminder', { connection })
      await q.add('tick', {}, { repeat: { every: 30000 }, jobId: 'tick', removeOnComplete: true, removeOnFail: 20 })
      await q.add('maint', {}, { repeat: { every: 3600000 }, jobId: 'maint', removeOnComplete: true, removeOnFail: 20 })
      new Worker('medminder', async (job) => (job.name === 'tick' ? this.tick() : this.maint()), { connection })
      console.log('Reminder engine: BullMQ (Redis)')
    } else {
      setInterval(() => this.tick().catch(console.error), 30000)
      setInterval(() => this.maint().catch(console.error), 3600000)
      console.log('Reminder engine: in-process timers (set REDIS_URL to use BullMQ)')
    }
    setTimeout(() => this.maint().catch(console.error), 3000)
  }

  async generate(m: any, u: any, days = 7) {
    if (m.status !== 'ACTIVE') return
    const from = new Date(), to = new Date(Date.now() + days * 864e5)
    const times = genDoses(m, from, to, u.timezone)
    if (!times.length) return
    const ex = await this.db.doseLog.findMany({ where: { medicationId: m.id, slot: { gte: from, lte: to } }, select: { slot: true } })
    const have = new Set(ex.map((e) => e.slot.getTime()))
    const data = times.filter((t) => !have.has(t.getTime())).map((t) => ({ patientId: m.patientId, medicationId: m.id, slot: t, scheduledAt: t, ...doseTimes(t, u.leadMinutes) }))
    if (data.length) await this.db.doseLog.createMany({ data })
  }

  /** Drop future untouched doses and rebuild them (after schedule / status / timezone / lead-time changes). */
  async regen(m: any, u: any) {
    await this.db.doseLog.deleteMany({ where: { medicationId: m.id, status: 'PENDING', scheduledAt: { gt: new Date() } } })
    await this.generate(m, u)
  }

  async checkStock(medId: string) {
    const m = await this.db.medication.findUnique({ where: { id: medId } })
    if (!m || m.pillCount == null) return
    if (m.pillCount <= m.lowStockAt && !m.lowStockAlerted) {
      await this.db.medication.update({ where: { id: m.id }, data: { lowStockAlerted: true } })
      await this.nt.notify(m.patientId, 'LOW_STOCK', `Refill due: ${m.name}`, `Only ${m.pillCount} left of ${m.name}. Time to refill.`)
    } else if (m.pillCount > m.lowStockAt && m.lowStockAlerted) {
      await this.db.medication.update({ where: { id: m.id }, data: { lowStockAlerted: false } })
    }
  }

  async missedAlert(d: any) {
    const p = await this.db.user.findUnique({ where: { id: d.patientId } })
    if (!p) return
    const when = DateTime.fromJSDate(d.scheduledAt, { zone: p.timezone }).toFormat('dd LLL HH:mm')
    const links = await this.db.link.findMany({ where: { patientId: d.patientId, status: 'ACTIVE', memberId: { not: null }, OR: [{ type: 'CAREGIVER' }, { type: 'DOCTOR', perms: { has: 'adherence' } }] } })
    for (const l of links) await this.nt.notify(l.memberId!, 'MISSED_ALERT', `${p.name} missed a dose`, `${d.medication.name} ${d.medication.dosage} scheduled ${when}.`, { force: true })
  }

  async tick() {
    const now = new Date()
    const inc = { medication: true }
    for (const d of await this.db.doseLog.findMany({ where: { status: 'PENDING', reminderSent: false, remindAt: { lte: now }, deadline: { gt: now } }, include: inc, take: 500 })) {
      await this.db.doseLog.update({ where: { id: d.id }, data: { reminderSent: true } })
      await this.nt.notify(d.patientId, 'REMINDER', `Time to take ${d.medication.name}`, `${d.medication.dosage}${d.medication.instructions ? ' - ' + d.medication.instructions : ''}`, { data: { doseId: d.id } })
    }
    for (const d of await this.db.doseLog.findMany({ where: { status: 'PENDING', followUpSent: false, followUpAt: { lte: now }, deadline: { gt: now } }, include: inc, take: 500 })) {
      await this.db.doseLog.update({ where: { id: d.id }, data: { followUpSent: true, reminderSent: true } })
      await this.nt.notify(d.patientId, 'FOLLOW_UP', `Did you take ${d.medication.name}?`, 'Please confirm your dose: taken, skipped or missed.', { data: { doseId: d.id } })
    }
    for (const d of await this.db.doseLog.findMany({ where: { status: 'PENDING', deadline: { lte: now } }, include: inc, take: 500 })) {
      await this.db.doseLog.update({ where: { id: d.id }, data: { status: 'MISSED', loggedAt: now } })
      await this.nt.notify(d.patientId, 'MISSED', `Missed dose: ${d.medication.name}`, 'This dose was not confirmed and has been marked as missed.')
      await this.missedAlert(d)
      await this.sync.push(d.patientId, 'doses')
    }
  }

  async maint() {
    // remove sign-ups that never confirmed their email within 3 days
    await this.db.user.deleteMany({ where: { emailVerified: false, role: { not: 'ADMIN' }, createdAt: { lt: new Date(Date.now() - 3 * 864e5) } } })
    await this.db.medication.updateMany({ where: { status: 'ACTIVE', endDate: { lt: new Date(Date.now() - 36 * 3600e3) } }, data: { status: 'STOPPED' } })
    const meds = await this.db.medication.findMany({ where: { status: 'ACTIVE' } })
    const users = new Map((await this.db.user.findMany({ where: { id: { in: [...new Set(meds.map((m) => m.patientId))] } } })).map((u) => [u.id, u]))
    for (const m of meds) { const u = users.get(m.patientId); if (u && u.status === 'ACTIVE') { await this.generate(m, u); await this.checkStock(m.id) } }
    // patient-entered prescriptions the doctor never confirmed within 7 days are rejected automatically
    for (const r of await this.db.prescription.findMany({ where: { status: 'PENDING', verifyExpires: { lt: new Date() } } })) {
      await this.db.prescription.update({ where: { id: r.id }, data: { status: 'REJECTED', verifyToken: null, rejectReason: 'The doctor did not confirm this prescription in time.' } })
      await this.nt.notify(r.patientId, 'RX_REJECTED', 'Prescription not confirmed', `The prescription from Dr. ${r.doctorName} was not confirmed within 7 days, so it was not activated.`, { inAppOnly: true })
      await this.sync.push(r.patientId, 'prescriptions')
    }
    for (const r of await this.db.prescription.findMany({ where: { status: 'ACTIVE', expiryReminded: false, expiresAt: { not: null, lte: new Date(Date.now() + 7 * 864e5) } } })) {
      if (!r.expiresAt) continue
      await this.db.prescription.update({ where: { id: r.id }, data: { expiryReminded: true } })
      await this.nt.notify(r.patientId, 'RX_EXPIRY', 'Prescription expiring soon', `A prescription from ${r.doctorName} expires on ${r.expiresAt.toDateString()}. Please renew it.`)
    }
    // daily 21:00 (local) summary email
    for (const u of await this.db.user.findMany({ where: { status: 'ACTIVE', emailVerified: true, role: { not: 'ADMIN' } } })) {
      const n = DateTime.now().setZone(u.timezone)
      if (n.hour !== 21 || (u.lastSummaryAt && DateTime.fromJSDate(u.lastSummaryAt, { zone: u.timezone }).hasSame(n, 'day'))) continue
      const ds = await this.db.doseLog.findMany({ where: { patientId: u.id, scheduledAt: { gte: n.startOf('day').toJSDate(), lte: n.endOf('day').toJSDate() } } })
      if (!ds.length) continue
      const c = (s: string) => ds.filter((d) => d.status === s).length
      await this.db.user.update({ where: { id: u.id }, data: { lastSummaryAt: new Date() } })
      await this.nt.notify(u.id, 'SUMMARY', 'Your daily medication summary', `Today: ${c('TAKEN')} of ${ds.length} doses taken, ${c('MISSED')} missed, ${c('SKIPPED')} skipped, ${c('PENDING')} pending.`)
    }
  }
}

@Injectable()
export class Seed implements OnModuleInit {
  constructor(private db: PrismaService) {}
  async onModuleInit() {
    const { ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env
    if (e && p) {
      // keep the admin account in sync with ADMIN_EMAIL / ADMIN_PASSWORD from .env
      const email = e.toLowerCase(), ex = await this.db.user.findUnique({ where: { email } })
      if (!ex) await this.db.user.create({ data: { email, name: 'Admin', role: 'ADMIN', emailVerified: true, passwordHash: await bcrypt.hash(p, 10), channels: ['INAPP'] } })
      else if (ex.role !== 'ADMIN' || ex.status !== 'ACTIVE' || !ex.emailVerified || !(await bcrypt.compare(p, ex.passwordHash)))
        await this.db.user.update({ where: { id: ex.id }, data: { role: 'ADMIN', status: 'ACTIVE', emailVerified: true, twoFactorEnabled: false, passwordHash: await bcrypt.hash(p, 10) } })
    }
    await this.migrate()
    if (!(await this.db.libraryMed.count()))
      await this.db.libraryMed.createMany({ data: [
        { name: 'Paracetamol', form: 'Tablet', commonDosage: '500 mg', description: 'Pain and fever relief' },
        { name: 'Metformin', form: 'Tablet', commonDosage: '500 mg', description: 'Type 2 diabetes' },
        { name: 'Amlodipine', form: 'Tablet', commonDosage: '5 mg', description: 'High blood pressure' },
        { name: 'Atorvastatin', form: 'Tablet', commonDosage: '20 mg', description: 'Cholesterol' },
        { name: 'Omeprazole', form: 'Capsule', commonDosage: '20 mg', description: 'Acid reflux' },
        { name: 'Lisinopril', form: 'Tablet', commonDosage: '10 mg', description: 'High blood pressure' },
        { name: 'Ibuprofen', form: 'Tablet', commonDosage: '400 mg', description: 'Pain and inflammation' },
        { name: 'Amoxicillin', form: 'Capsule', commonDosage: '500 mg', description: 'Antibiotic' },
        { name: 'Cetirizine', form: 'Tablet', commonDosage: '10 mg', description: 'Allergy' },
        { name: 'Levothyroxine', form: 'Tablet', commonDosage: '50 mcg', description: 'Thyroid' },
      ] })
  }

  /** One-time upgrades for data created by earlier versions. Safe to run on every start. */
  async migrate() {
    try {
      // prescriptions made before verification existed are treated as confirmed
      await this.db.$runCommandRaw({ update: 'Prescription', updates: [{ q: { status: { $exists: false } }, u: { $set: { status: 'ACTIVE' } }, multi: true }] })
    } catch (e: any) { console.warn('prescription migration skipped:', e.message) }
    try {
      // allergies typed into the old comma list become real allergy records
      for (const u of await this.db.user.findMany({ where: { role: { not: 'ADMIN' } }, select: { id: true, allergies: true } })) {
        if (!u.allergies?.length) continue
        if (!(await this.db.allergy.count({ where: { patientId: u.id } })))
          await this.db.allergy.createMany({ data: u.allergies.filter(Boolean).map((a) => ({ patientId: u.id, substance: a, severity: 'MODERATE' as const, createdById: u.id })) })
        await this.db.user.update({ where: { id: u.id }, data: { allergies: [] } })
      }
      // a doctor always needs at least read access to medications once linked
      for (const l of await this.db.link.findMany({ where: { type: 'DOCTOR' } }))
        if (!l.perms.includes('meds') || !l.perms.includes('prescribe')) await this.db.link.update({ where: { id: l.id }, data: { perms: [...new Set([...l.perms, 'meds', 'prescribe'])] } })
    } catch (e: any) { console.warn('data migration skipped:', e.message) }
  }
}
