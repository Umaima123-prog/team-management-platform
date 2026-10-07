import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import { MONGO_CLIENT, MONGO_DB } from './database.tokens';

// Management Service writes only management_db (see docs/ARCHITECTURE.md
// and docs/DECISIONS.md). There is no fallback/default connection string
// in this file - MONGODB_URI and MONGODB_DB_NAME must come from the
// environment (.env locally, real secrets in CI/deployment). Tests
// supply their own values via test/setup-env.ts rather than relying on
// anything hardcoded here.

function requireEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. Copy .env.example to .env and set it.`,
    );
  }
  return value;
}

export const mongoClientProvider: Provider = {
  provide: MONGO_CLIENT,
  useFactory: (config: ConfigService) => {
    const uri = requireEnv(config, 'MONGODB_URI');
    // 10s, not the previous 2s: short enough to bound a request (no
    // unbounded hangs), long enough to tolerate ordinary Atlas latency
    // and a free-tier (M0) cluster waking up, so the very first
    // connection attempt doesn't spuriously fail under normal
    // conditions - see docs/DECISIONS.md #16 for why that first
    // failure used to be catastrophic (the driver permanently closes
    // its topology on a failed connect) and DatabaseService.ensureConnected()
    // for the self-healing half of that fix.
    return new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  },
  inject: [ConfigService],
};

export const mongoDbProvider: Provider = {
  provide: MONGO_DB,
  useFactory: (client: MongoClient, config: ConfigService) => {
    const dbName = requireEnv(config, 'MONGODB_DB_NAME');
    return client.db(dbName);
  },
  inject: [MONGO_CLIENT, ConfigService],
};
