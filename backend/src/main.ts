import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow the Next.js frontend (localhost:3000) to call this API
  app.enableCors({ origin: 'http://localhost:3000' });
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();