import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
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

  // Phase 6: the admin UI is a separate origin (its own dev server /
  // static host), so it needs CORS - never enabled before Phase 6
  // because nothing but same-origin tooling (curl, supertest, Postman)
  // called this API. Scoped to an explicit, configurable allow-list
  // (never a wildcard). Phase 9: `credentials: true` is now required -
  // the refresh token travels as an HttpOnly cookie, and a wildcard
  // origin is rejected by browsers outright once credentials are
  // involved, so the explicit allow-list is now load-bearing for
  // security, not just tidiness.
  const adminUiOrigins = (process.env.ADMIN_UI_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  app.enableCors({
    origin: adminUiOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    credentials: true,
  });

  // Parses the refresh-token cookie (HttpOnly, set by
  // AuthController) - req.cookies would otherwise be undefined.
  app.use(cookieParser());

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
