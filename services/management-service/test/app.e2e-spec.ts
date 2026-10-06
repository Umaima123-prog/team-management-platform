import type { Server } from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', service: 'management-service' });
  });

  // test/setup-env.ts points MONGODB_URI at a host nothing is
  // listening on, so this genuinely exercises the failure path: a real
  // unreachable database must surface as 503, not a false "ok".
  it('/health/ready (GET) returns 503 when the database is unreachable', () => {
    return request(app.getHttpServer() as Server).get('/health/ready').expect(503);
  });
});
