import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BoardsModule } from './boards/boards.module';
import { RequestContextGuard } from './common/context/request-context.guard';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
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
export class AppModule {}
