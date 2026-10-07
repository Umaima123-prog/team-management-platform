import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BoardsModule } from './boards/boards.module';
import { CorrelationIdMiddleware } from './common/context/correlation-id.middleware';
import { RequestContextGuard } from './common/context/request-context.guard';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { MessagingModule } from './messaging/messaging.module';
import { ProjectsModule } from './projects/projects.module';
import { TeamsModule } from './teams/teams.module';
import { WorkItemsModule } from './work-items/work-items.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Abuse-control baseline (see docs/DECISIONS.md) - a documented,
    // deliberate response to a named prior-assignment mistake
    // ("no rate limiting / abuse protection"). Health checks opt out
    // via @SkipThrottle().
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    MessagingModule,
    HealthModule,
    IdentityModule,
    TeamsModule,
    ProjectsModule,
    BoardsModule,
    WorkItemsModule,
  ],
  providers: [
    // Order matters: throttling must reject abusive traffic before
    // the request-context lookup (a database read) ever runs.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RequestContextGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs before every guard (including the health checks' @Public()
    // routes) so a correlationId is always available - see
    // docs/ARCHITECTURE.md "Correlation / observability".
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
