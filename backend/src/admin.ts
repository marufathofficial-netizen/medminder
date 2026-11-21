import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { Access, Me, PrismaService, Roles, parse, publicUser } from './common'

@Controller('library')
export class LibraryController {
  constructor(private db: PrismaService) {}
  @Get() list(@Query('q') q?: string) {
    return this.db.libraryMed.findMany({ where: q ? { name: { contains: q, mode: 'insensitive' } } : {}, orderBy: { name: 'asc' }, take: 100 })
  }
}

const lib = z.object({ name: z.string().min(1), description: z.string().optional(), form: z.string().optional(), commonDosage: z.string().optional() })

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private db: PrismaService, private acc: Access) {}

  @Get('users') async users(@Query('q') q?: string) {
    const us = await this.db.user.findMany({ where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}, orderBy: { createdAt: 'desc' }, take: 200 })
    return us.map(publicUser)
  }

  @Post('users/:id/suspend') async suspend(@Me() a: any, @Param('id') id: string) {
    const u = await this.db.user.findUnique({ where: { id } })
    if (!u || u.role === 'ADMIN') throw new NotFoundException('User not found (admins cannot be suspended)')
    await this.db.user.update({ where: { id }, data: { status: 'SUSPENDED' } })
    await this.db.refreshToken.deleteMany({ where: { userId: id } })
    await this.acc.log(a.id, 'ADMIN_SUSPEND', u.email)
    return { ok: true }
  }

  @Post('users/:id/reactivate') async reactivate(@Me() a: any, @Param('id') id: string) {
    const u = await this.db.user.update({ where: { id }, data: { status: 'ACTIVE' } })
    await this.acc.log(a.id, 'ADMIN_REACTIVATE', u.email)
    return { ok: true }
  }

  @Get('logs') async logs(@Query('take') take?: string) {
    const logs = await this.db.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Number(take) || 100, 500) })
    const users = await this.db.user.findMany({ where: { id: { in: logs.map((l) => l.userId).filter(Boolean) as string[] } }, select: { id: true, email: true } })
    const m = new Map(users.map((u) => [u.id, u.email]))
    return logs.map((l) => ({ ...l, user: l.userId ? m.get(l.userId) || l.userId : null }))
  }

  @Get('stats') async stats() {
    const t0 = Date.now()
    await this.db.user.count()
    const dbMs = Date.now() - t0
    const day = new Date(Date.now() - 864e5)
    const [users, patients, caregivers, doctors, meds, dosesToday, missedToday, notifToday] = await Promise.all([
      this.db.user.count(), this.db.user.count({ where: { role: 'PATIENT' } }), this.db.user.count({ where: { role: 'CAREGIVER' } }), this.db.user.count({ where: { role: 'DOCTOR' } }),
      this.db.medication.count({ where: { status: 'ACTIVE' } }), this.db.doseLog.count({ where: { scheduledAt: { gte: day } } }),
      this.db.doseLog.count({ where: { scheduledAt: { gte: day }, status: 'MISSED' } }), this.db.notification.count({ where: { createdAt: { gte: day } } }),
    ])
    return { users, patients, caregivers, doctors, activeMedications: meds, dosesLast24h: dosesToday, missedLast24h: missedToday, notificationsLast24h: notifToday, dbLatencyMs: dbMs, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) }
  }

  // medication library (content management)
  @Post('library') add(@Body() b: any) { return this.db.libraryMed.create({ data: parse(lib, b) }) }
  @Patch('library/:id') edit(@Param('id') id: string, @Body() b: any) { return this.db.libraryMed.update({ where: { id }, data: parse(lib.partial(), b) }) }
  @Delete('library/:id') async del(@Param('id') id: string) { await this.db.libraryMed.delete({ where: { id } }); return { ok: true } }
}
