import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/context/public.decorator';
import { DatabaseService } from '../database/database.service';
import { MessagingDiagnostics, MessagingHealthService } from '../messaging/health/messaging-health.service';

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly messagingHealthService: MessagingHealthService,
  ) {}

  /** Liveness: process is up. Never depends on the database or NATS -
   * see docs/ARCHITECTURE.md "Health model". */
  @Get()
  check(): { status: string; service: string } {
    return { status: 'ok', service: 'management-service' };
  }

  /**
   * Readiness: can this instance actually serve traffic right now.
   * Gated on owned MongoDB connectivity only (503 if unreachable) -
   * NATS/messaging state is reported as a diagnostic, never a hard
   * gate, because the transactional outbox already makes writes
   * durable independent of NATS being reachable at request time (see
   * docs/DECISIONS.md for why gating readiness on NATS would be the
   * wrong call for this architecture).
   */
  @Get('ready')
  async ready(): Promise<{ status: string; database: string; messaging: MessagingDiagnostics }> {
    const [healthy, messaging] = await Promise.all([
      this.databaseService.ping(),
      this.messagingHealthService.diagnostics(),
    ]);

    if (!healthy) {
      throw new HttpException(
        { status: 'error', database: this.databaseService.getDatabaseName(), messaging },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', database: this.databaseService.getDatabaseName(), messaging };
  }
}
