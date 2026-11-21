import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { Me, PrismaService, Public } from './common'

@Controller('notifications')
export class NotificationsController {
  constructor(private db: PrismaService) {}

  @Get() async list(@Me() u: any, @Query('limit') limit: string) {
    const [items, unread] = await Promise.all([
      this.db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(limit) || 50, 200) }),
      this.db.notification.count({ where: { userId: u.id, read: false } }),
    ])
    return { items, unread }
  }

  /** Mark given ids (or all, if none given) as read */
  @Post('read') async read(@Me() u: any, @Body() b: any) {
    const ids: string[] | undefined = Array.isArray(b?.ids) ? b.ids : undefined
    await this.db.notification.updateMany({ where: { userId: u.id, ...(ids ? { id: { in: ids } } : {}) }, data: { read: true } })
    return { ok: true }
  }

  @Public() @Get('vapid') vapid() { return { key: process.env.VAPID_PUBLIC || null } }
}
