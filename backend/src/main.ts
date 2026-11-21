import 'dotenv/config'
import 'reflect-metadata'
import { ArgumentsHost, BadRequestException, Catch, NotFoundException } from '@nestjs/common'
import { BaseExceptionFilter, HttpAdapterHost, NestFactory } from '@nestjs/core'
import helmet from 'helmet'
import { AppModule } from './app.module'

@Catch()
class Filter extends BaseExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    if (e?.code === 'P2023') e = new BadRequestException('Invalid id')
    else if (e?.code === 'P2002') e = new BadRequestException('Already exists')
    else if (e?.code === 'P2025') e = new NotFoundException()
    else if (!e?.getStatus) console.error(e)
    super.catch(e, host)
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.use(helmet({ crossOriginResourcePolicy: false }))
  const origins = (process.env.APP_URL || 'http://localhost:3000').split(',').map((s) => s.trim().replace(/\/$/, ''))
  if (origins.includes('http://localhost:3000')) origins.push('http://127.0.0.1:3000')
  app.enableCors({ origin: origins, credentials: true })
  app.useGlobalFilters(new Filter(app.get(HttpAdapterHost).httpAdapter))
  const port = Number(process.env.PORT || 4000)
  await app.listen(port, '0.0.0.0')
  console.log(`MedMinder API running on http://localhost:${port}`)
}
bootstrap()
