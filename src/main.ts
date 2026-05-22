import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS לפיתוח — ה-UI ב-Next.js רץ על פורט שונה (3001) ופונה ל-API ב-3000
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`מערכת תפעול פנסיוני — ליבת קליטה עלתה על פורט ${port}`);
}

bootstrap();
