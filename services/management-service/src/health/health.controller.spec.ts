import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseService } from '../database/database.service';

describe('HealthController', () => {
  let controller: HealthController;
  let databaseService: { ping: jest.Mock; getDatabaseName: jest.Mock };

  beforeEach(async () => {
    databaseService = {
      ping: jest.fn(),
      getDatabaseName: jest.fn().mockReturnValue('management_db'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok status without touching the database', () => {
    expect(controller.check()).toEqual({
      status: 'ok',
      service: 'management-service',
    });
    expect(databaseService.ping).not.toHaveBeenCalled();
  });

  it('reports ready when the database ping succeeds', async () => {
    databaseService.ping.mockResolvedValue(true);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      database: 'management_db',
    });
  });

  it('reports 503 when the database ping fails', async () => {
    databaseService.ping.mockResolvedValue(false);

    await expect(controller.ready()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    } as Partial<HttpException>);
  });
});
