import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseService } from '../database/database.service';
import { MessagingHealthService } from '../messaging/health/messaging-health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let databaseService: { ping: jest.Mock; getDatabaseName: jest.Mock };
  let messagingHealthService: { diagnostics: jest.Mock };

  const messagingDiagnostics = {
    natsConnected: true,
    jetstreamReady: true,
    unpublishedOutboxCount: 0,
    failedOutboxCount: 0,
  };

  beforeEach(async () => {
    databaseService = {
      ping: jest.fn(),
      getDatabaseName: jest.fn().mockReturnValue('management_db'),
    };
    messagingHealthService = { diagnostics: jest.fn().mockResolvedValue(messagingDiagnostics) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DatabaseService, useValue: databaseService },
        { provide: MessagingHealthService, useValue: messagingHealthService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok status without touching the database or messaging', () => {
    expect(controller.check()).toEqual({
      status: 'ok',
      service: 'management-service',
    });
    expect(databaseService.ping).not.toHaveBeenCalled();
    expect(messagingHealthService.diagnostics).not.toHaveBeenCalled();
  });

  it('reports ready (with messaging diagnostics) when the database ping succeeds', async () => {
    databaseService.ping.mockResolvedValue(true);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      database: 'management_db',
      messaging: messagingDiagnostics,
    });
  });

  it('reports 503 when the database ping fails, even if messaging is healthy', async () => {
    databaseService.ping.mockResolvedValue(false);

    await expect(controller.ready()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    } as Partial<HttpException>);
  });

  it('stays ready (200) when NATS is down but Mongo is up - messaging is a diagnostic, not a gate', async () => {
    databaseService.ping.mockResolvedValue(true);
    messagingHealthService.diagnostics.mockResolvedValue({
      natsConnected: false,
      jetstreamReady: false,
      unpublishedOutboxCount: 3,
      failedOutboxCount: 0,
    });

    const result = await controller.ready();

    expect(result.status).toBe('ok');
    expect(result.messaging.natsConnected).toBe(false);
  });
});
