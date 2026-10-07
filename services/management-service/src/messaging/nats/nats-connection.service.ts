import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  connect,
  JetStreamClient,
  JetStreamManager,
  NatsConnection,
} from 'nats';

function requireEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(`Missing required environment variable ${key}. Copy .env.example to .env and set it.`);
  }
  return value;
}

/**
 * Lazy, shared Core NATS connection for the whole service - JetStream
 * publish, JetStream management, and Core request/reply all reuse the
 * one underlying socket. Mirrors the Mongo client's Phase 2 pattern
 * (docs/DECISIONS.md #6): no connection is attempted at module
 * construction time, only on first real use, so the app (and its test
 * suite) can boot without a reachable NATS server.
 *
 * Liveness (GET /health) never touches this - see
 * docs/ARCHITECTURE.md "Health model". Readiness reports
 * `isConnected()` as a diagnostic, not a hard gate (see
 * HealthController / docs/DECISIONS.md).
 */
@Injectable()
export class NatsConnectionService implements OnApplicationShutdown {
  private readonly logger = new Logger(NatsConnectionService.name);
  private connection: NatsConnection | null = null;
  private connecting: Promise<NatsConnection> | null = null;

  constructor(private readonly config: ConfigService) {}

  async getConnection(): Promise<NatsConnection> {
    if (this.connection && !this.connection.isClosed()) {
      return this.connection;
    }
    if (!this.connecting) {
      const servers = requireEnv(this.config, 'NATS_URL');
      this.connecting = connect({
        servers,
        name: 'management-service',
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 1000,
      })
        .then((nc) => {
          this.connection = nc;
          this.connecting = null;
          this.logger.log('NATS connection established.');
          void this.watchDisconnects(nc);
          return nc;
        })
        .catch((error: Error) => {
          this.connecting = null;
          // Never log connection strings/credentials - only the error name.
          this.logger.warn(`NATS connect failed (${error.name}): ${error.message}`);
          throw error;
        });
    }
    return this.connecting;
  }

  async getJetStreamClient(): Promise<JetStreamClient> {
    const nc = await this.getConnection();
    return nc.jetstream({ timeout: 10_000 });
  }

  async getJetStreamManager(): Promise<JetStreamManager> {
    const nc = await this.getConnection();
    return nc.jetstreamManager({ timeout: 10_000 });
  }

  isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }

  private async watchDisconnects(nc: NatsConnection): Promise<void> {
    for await (const status of nc.status()) {
      const type = String(status.type);
      if (type === 'disconnect' || type === 'error' || type === 'reconnecting') {
        this.logger.warn(`NATS status: ${type}`);
      } else if (type === 'reconnect') {
        this.logger.log('NATS reconnected.');
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.connection && !this.connection.isClosed()) {
      await this.connection.drain().catch(() => undefined);
    }
  }
}
