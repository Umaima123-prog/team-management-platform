import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Db } from 'mongodb';
import { MONGO_DB } from './database.tokens';
import { INDEX_REGISTRY } from './index-registry';

/**
 * Applies INDEX_REGISTRY entries idempotently at startup. createIndexes
 * is safe to call repeatedly (MongoDB no-ops on an existing identical
 * index), so this runs on every boot rather than needing a separate
 * migration step.
 */
@Injectable()
export class IndexBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexBootstrapService.name);

  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const spec of INDEX_REGISTRY) {
      try {
        await this.db.collection(spec.collection).createIndexes(spec.indexes);
      } catch (error) {
        this.logger.warn(
          `Failed to create indexes for "${spec.collection}" (${(error as Error).name})`,
        );
      }
    }
  }
}
