import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { ALL_PERMS, APP_URL, Access, Mailer, Me, PrismaService, limit, parse, rand } from './common'
import { Notifier, Sync } from './services'

const U = { select: { id: true, name: true, email: true, role: true } }
const DEFAULT: any = {
  CAREGIVER: ['meds', 'adherence', 'journal', 'measurements'],
  DOCTOR: ['meds', 'adherence', 'journal', 'measurements', 'documents', 'prescribe'],
}
// A doctor must always be able to see medications and write prescriptions; everything else (incl. "edit") is the patient's choice.
const cleanPerms = (type: string, p?: string[]) => {
  const base = (p || DEFAULT[type]).filter((x: string) => ALL_PERMS.includes(x))
  return type === 'DOCTOR' ? [...new Set([...base, 'meds', 'prescribe'])] : base.filter((x: string) => x !== 'prescribe')
}

@Controller('links')
export class LinksController {
  constructor(private db: PrismaService, private mail: Mailer, private nt: Notifier, private acc: Access, private sync: Sync) {}

  @Get()
  async list(@Me() u: any) {
    const asPatient = await this.db.link.findMany({ where: { patientId: u.id }, include: { member: U }, orderBy: { createdAt: 'desc' } })
    const asMember = await this.db.link.findMany({ where: { memberId: u.id }, include: { patient: U } })
    // invitations sent to my email that I have not accepted yet (so I can accept them inside the app too)
    const invites = await this.db.link.findMany({ where: { memberId: null, inviteEmail: u.email, initiatedBy: 'PATIENT', status: 'PENDING', type: u.role as any, expiresAt: { gt: new Date() } }, include: { patient: U } })
    return {
      asPatient: asPatient.map(({ token, ...l }) => l),
      asMember: asMember.map(({ token, ...l }) => l),
      invitesForMe: invites.map((l) => ({ id: l.id, token: l.token, type: l.type, perms: l.perms, patient: l.patient, expiresAt: l.expiresAt })),
    }
  }

  /** Patient invites a caregiver/doctor by email (secure single-use link). Accepting = patient consent. */
  @Post('invite')
  async invite(@Me() u: any, @Body() b: any) {
    const d = parse(z.object({ email: z.string().trim().email(), type: z.enum(['CAREGIVER', 'DOCTOR']), perms: z.array(z.string()).optional() }), b)
    const email = d.email.toLowerCase()
    limit('invite:' + u.id, 20, 3600e3)
    if (email === u.email) throw new BadRequestException('You cannot invite yourself')
    if (await this.db.link.findFirst({ where: { patientId: u.id, inviteEmail: email, type: d.type } })) throw new BadRequestException('Already invited or linked')
    const token = rand()
    const link = await this.db.link.create({ data: { patientId: u.id, inviteEmail: email, type: d.type, token, expiresAt: new Date(Date.now() + 7 * 864e5), initiatedBy: 'PATIENT', perms: cleanPerms(d.type, d.perms) } })
    try {
      await this.mail.send(email, `${u.name} invited you to MedMinder`, `${u.name} invited you as their ${d.type.toLowerCase()}.\n\nLog in (or register with this email) and accept: ${APP_URL()}/accept?token=${token}\n\nYou can also accept it inside MedMinder under "Care team".\n\nThe link expires in 7 days.`)
    } catch (e) {
      await this.db.link.delete({ where: { id: link.id } }) // do not leave an invitation nobody was told about
      throw e
    }
    const invitee = await this.db.user.findUnique({ where: { email } })
    if (invitee && invitee.role === d.type) await this.nt.notify(invitee.id, 'LINK_INVITE', 'New care invitation', `${u.name} invited you as their ${d.type.toLowerCase()}. Open Care team to accept.`, { inAppOnly: true })
    await this.sync.push(u.id, 'links', invitee ? [invitee.id] : [])
    await this.acc.log(u.id, 'INVITE', `${d.type} ${email}`)
    return { message: 'Invitation sent' }
  }

  /** Accept an invitation. Safe to call twice (double click / page reload): the second call just confirms the link. */
  @Post('accept')
  async accept(@Me() u: any, @Body() b: any) {
    const { token } = parse(z.object({ token: z.string() }), b)
    const l = await this.db.link.findUnique({ where: { token } })
    if (!l || l.initiatedBy !== 'PATIENT') throw new NotFoundException('Invitation not found')
    if (l.status === 'ACTIVE' && l.memberId === u.id) return { message: 'You are already linked to this patient.' }
    if (l.status !== 'PENDING') throw new BadRequestException('Invitation already used')
    if (l.expiresAt < new Date()) throw new BadRequestException('Invitation expired')
    if (l.inviteEmail !== u.email) throw new ForbiddenException('This invitation was sent to a different email address')
    if (u.role !== l.type) throw new ForbiddenException(`You need a ${l.type.toLowerCase()} account to accept this`)
    const r = await this.db.link.updateMany({ where: { id: l.id, status: 'PENDING' }, data: { memberId: u.id, status: 'ACTIVE' } })
    if (r.count) {
      await this.nt.notify(l.patientId, 'LINK', 'Invitation accepted', `${u.name} is now linked to your account.`)
      await this.acc.log(u.id, 'ACCEPT_LINK', l.patientId)
    }
    await this.sync.push(l.patientId, 'links', [u.id])
    return { message: 'Linked' }
  }

  /** Doctor/caregiver asks to be linked; patient must approve (consent). */
  @Post('request')
  async request(@Me() u: any, @Body() b: any) {
    const { patientEmail } = parse(z.object({ patientEmail: z.string().trim().email() }), b)
    if (!['DOCTOR', 'CAREGIVER'].includes(u.role)) throw new ForbiddenException()
    limit('request:' + u.id, 20, 3600e3)
    const p = await this.db.user.findUnique({ where: { email: patientEmail.toLowerCase() } })
    if (p && p.id !== u.id && !(await this.db.link.findFirst({ where: { patientId: p.id, memberId: u.id } }))) {
      await this.db.link.create({ data: { patientId: p.id, memberId: u.id, inviteEmail: u.email, type: u.role, token: rand(), expiresAt: new Date(Date.now() + 14 * 864e5), initiatedBy: 'MEMBER', perms: cleanPerms(u.role) } })
      await this.nt.notify(p.id, 'LINK_REQUEST', 'Access request', `${u.name} (${u.role.toLowerCase()}) asks to view your medication data. Review it under Care team.`, { force: true })
      await this.sync.push(p.id, 'links', [u.id])
    }
    return { message: 'If that patient exists, a request was sent for their approval.' }
  }

  @Post(':id/approve')
  async approve(@Me() u: any, @Param('id') id: string) {
    const l = await this.db.link.findFirst({ where: { id, patientId: u.id, initiatedBy: 'MEMBER', status: 'PENDING' } })
    if (!l) throw new NotFoundException()
    await this.db.link.update({ where: { id }, data: { status: 'ACTIVE' } })
    await this.nt.notify(l.memberId!, 'LINK', 'Request approved', `${u.name} approved your access request.`)
    await this.sync.push(u.id, 'links', [l.memberId!])
    return { ok: true }
  }

  /** The patient decides what each person can see and whether they may edit on the patient's behalf. */
  @Patch(':id/perms')
  async perms(@Me() u: any, @Param('id') id: string, @Body() b: any) {
    const { perms } = parse(z.object({ perms: z.array(z.string()) }), b)
    const l = await this.db.link.findFirst({ where: { id, patientId: u.id } })
    if (!l) throw new NotFoundException()
    const next = cleanPerms(l.type, perms)
    await this.db.link.update({ where: { id }, data: { perms: next } })
    if (l.memberId) {
      if (next.includes('edit') !== l.perms.includes('edit'))
        await this.nt.notify(l.memberId, 'LINK', next.includes('edit') ? 'Editing allowed' : 'Editing turned off', `${u.name} ${next.includes('edit') ? 'now allows you to edit their medications, prescriptions and dose logs.' : 'no longer allows you to edit their data (you can still view it).'}`, { inAppOnly: true })
      await this.sync.push(u.id, 'links', [l.memberId])
    }
    return { ok: true }
  }

  /** Revoke/remove: either side can end the link at any time. */
  @Delete(':id')
  async remove(@Me() u: any, @Param('id') id: string) {
    const l = await this.db.link.findFirst({ where: { id, OR: [{ patientId: u.id }, { memberId: u.id }] } })
    if (!l) throw new NotFoundException()
    await this.db.link.delete({ where: { id } })
    const other = l.patientId === u.id ? l.memberId : l.patientId
    if (other) await this.nt.notify(other, 'LINK', 'Link removed', `${u.name} ended the care link.`)
    await this.sync.push(l.patientId, 'links', l.memberId ? [l.memberId] : [])
    await this.acc.log(u.id, 'REVOKE_LINK', id)
    return { ok: true }
  }

  /** Caregiver / doctor dashboard: linked patients with 30-day adherence. */
  @Get('patients')
  async patients(@Me() u: any) {
    const links = await this.db.link.findMany({ where: { memberId: u.id, status: 'ACTIVE' }, include: { patient: U } })
    const since = new Date(Date.now() - 30 * 864e5)
    return Promise.all(links.map(async (l) => {
      let adherence: any = null
      if (l.perms.includes('adherence')) {
        const ds = await this.db.doseLog.findMany({ where: { patientId: l.patientId, scheduledAt: { gte: since }, status: { in: ['TAKEN', 'MISSED', 'SKIPPED'] } }, select: { status: true, scheduledAt: true }, orderBy: { scheduledAt: 'desc' } })
        const taken = ds.filter((d) => d.status === 'TAKEN').length
        adherence = { total: ds.length, taken, missed: ds.filter((d) => d.status === 'MISSED').length, rate: ds.length ? Math.round((taken / ds.length) * 100) : null, lastMissed: ds.find((d) => d.status === 'MISSED')?.scheduledAt || null }
      }
      const allergyCount = await this.db.allergy.count({ where: { patientId: l.patientId } })
      return { linkId: l.id, type: l.type, perms: l.perms, patient: l.patient, adherence, allergyCount }
    }))
  }
}
