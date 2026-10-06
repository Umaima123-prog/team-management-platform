import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';

/**
 * Global pipes/filters shared between the real entrypoint (main.ts)
 * and e2e tests (test/helpers/create-test-app.ts) - so a test that
 * exercises validation or error-envelope behavior is exercising the
 * exact same configuration production runs under, not a reimplemented
 * approximation of it.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
