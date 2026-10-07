import * as dns from 'dns';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Local-only workaround for ISPs that can't resolve Atlas addresses.
  // Enabled by USE_GOOGLE_DNS=true in your own backend/.env.
  if (process.env.USE_GOOGLE_DNS === 'true') {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  }

  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();