import { Inject, Injectable, Logger } from '@nestjs/common';
import { Db, Document } from 'mongodb';
import { MONGO_DB } from './database.tokens';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  getDatabaseName(): string {
    return this.db.databaseName;
  }

  getCollection<T extends Document = Document>(name: string) {
    return this.db.collection<T>(name);
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch (error) {
      // Never log the connection string, credentials, or full driver
      // error/message - only the error name and MongoDB's fixed,
      // generic codeName enum (e.g. "AuthenticationFailed",
      // "HostNotFound"), neither of which reflects any secret input.
      const err = error as Error & { codeName?: string; code?: number | string };
      this.logger.warn(
        `MongoDB ping failed (${err.name}${err.codeName ? `: ${err.codeName}` : ''}${
          err.code !== undefined ? ` code=${err.code}` : ''
        }) ${err.message}`,
      );
      return false;
    }
  }
}
