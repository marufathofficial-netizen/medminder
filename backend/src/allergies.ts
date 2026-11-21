import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { Access, Me, PrismaService, parse } from './common'
import { Sync } from './services'

const body = z.object({
  substance: z.string().trim().min(1, 'Say what you are allergic to').max(100),
  reaction: z.string().trim().max(300).nullable().optional(),
  severity: z.enum(['MILD', 'MODERATE', 'SEVERE']).default('MODERATE'),
  notes: z.string().trim().max(500).nullable().optional(),
})

/** Allergies are safety-critical: any active doctor/caregiver can read them; changing them needs the patient's "edit" permission. */
@Controller('patients/:pid/allergies')
export class AllergiesController {
  constructor(private db: PrismaService, private acc: Access, private sync: Sync) {}

  @Get() async list(@Me() u: any, @Param('pid') pid: string) {
    const { id } = await this.acc.resolve(u, pid)
    return this.db.allergy.findMany({ where: { patientId: id }, orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }] })
  }

  @Post() async add(@Me() u: any, @Param('pid') pid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const d = parse(body, b)
    const a = await this.db.allergy.create({ data: { patientId: id, substance: d.substance, reaction: d.reaction || null, severity: d.severity, notes: d.notes || null, createdById: u.id } })
    await this.sync.changed(id, u, 'allergies', `Allergy added: ${a.substance} (${a.severity.toLowerCase()})`)
    return a
  }

  @Patch(':aid') async edit(@Me() u: any, @Param('pid') pid: string, @Param('aid') aid: string, @Body() b: any) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    if (!(await this.db.allergy.findFirst({ where: { id: aid, patientId: id } }))) throw new NotFoundException()
    const d = parse(body.partial(), b)
    const a = await this.db.allergy.update({ where: { id: aid }, data: d })
    await this.sync.changed(id, u, 'allergies', `Allergy updated: ${a.substance} (${a.severity.toLowerCase()})`)
    return a
  }

  @Delete(':aid') async remove(@Me() u: any, @Param('pid') pid: string, @Param('aid') aid: string) {
    const { id } = await this.acc.resolve(u, pid, 'edit')
    const a = await this.db.allergy.findFirst({ where: { id: aid, patientId: id } })
    if (!a) return { ok: true }
    await this.db.allergy.delete({ where: { id: aid } })
    await this.sync.changed(id, u, 'allergies', `Allergy removed: ${a.substance}`)
    return { ok: true }
  }
}
