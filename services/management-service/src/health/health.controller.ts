import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  /** Liveness: process is up. Never depends on the database. */
  @Get()
  check(): { status: string; service: string } {
    return { status: 'ok', service: 'management-service' };
  }

  /** Readiness: can this instance actually serve traffic right now. */
  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    const healthy = await this.databaseService.ping();
    if (!healthy) {
      throw new HttpException(
        { status: 'error', database: this.databaseService.getDatabaseName() },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', database: this.databaseService.getDatabaseName() };
  }
}
