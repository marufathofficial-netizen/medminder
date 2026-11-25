import { Body, Controller, Delete, Get, NotFoundException, Param, Patch } from '@nestjs/common'
import { z } from 'zod'
import { ALL_PERMS, Access, Me, PrismaService, parse } from './common'
import { Notifier, Sync } from './services'

/** Jewel - Module 2 feature 16: patient-controlled permissions on what each caregiver / doctor can view or edit. */
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
export class PermissionsController {
  constructor(private db: PrismaService, private nt: Notifier, private acc: Access, private sync: Sync) {}

  /** The people the patient has given access to, with their current permissions. */
  @Get('mine')
  async mine(@Me() u: any) {
    const asPatient = await this.db.link.findMany({ where: { patientId: u.id }, include: { member: U }, orderBy: { createdAt: 'desc' } })
    return asPatient.map(({ token, ...l }) => l)
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
}
