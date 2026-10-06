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
    return new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
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
