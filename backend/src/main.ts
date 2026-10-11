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
  // Allow the Next.js frontend (localhost:3000) to call this API
  app.enableCors({ origin: 'http://localhost:3000' });
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}
void bootstrap();