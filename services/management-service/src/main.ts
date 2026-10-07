import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Without this, Nest's OnApplicationShutdown hooks (DatabaseModule's
  // single client.close(), NatsConnectionService's drain, the outbox
  // relay's timer teardown) are never wired to SIGINT/SIGTERM - a
  // Ctrl+C would just kill the process, skipping graceful cleanup
  // entirely rather than running it twice. This makes "closes exactly
  // once, only on real shutdown" actually true (see docs/DECISIONS.md #16).
  app.enableShutdownHooks();

  // Explicit, documented request-body cap (abuse-control baseline,
  // see docs/DECISIONS.md) - well above any legitimate payload this
  // API accepts (the largest validated text field is 10,000 chars),
  // well below anything that could meaningfully exhaust memory.
  app.use(json({ limit: '256kb' }));
  app.use(urlencoded({ extended: true, limit: '256kb' }));

  configureApp(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
