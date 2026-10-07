import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientSession, Db, Document, MongoClient } from 'mongodb';
import { MONGO_CLIENT, MONGO_DB } from './database.tokens';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(MONGO_DB) private readonly db: Db,
  ) {}

  getDatabaseName(): string {
    return this.db.databaseName;
  }

  getCollection<T extends Document = Document>(name: string) {
    return this.db.collection<T>(name);
  }

  /**
   * Best-effort self-heal for a known MongoDB Node.js driver footgun
   * (see docs/DECISIONS.md #16): if the client's very first connection
   * attempt fails for any reason (a transient Atlas blip, an Atlas
   * free-tier cluster waking from idle, a short timeout), the
   * driver's `Topology` permanently closes itself - every subsequent
   * operation against this client then throws `MongoTopologyClosedError`
   * forever, even once Atlas is reachable again, because nothing
   * automatically retries the *connection* itself (only individual
   * operations are retried/time out). Calling `client.connect()` again
   * is the documented recovery: internally it is lock-guarded and a
   * near-instant no-op if already connected, and - critically - it
   * transparently builds a fresh internal topology in place on this
   * SAME client object if the old one had closed, which repairs every
   * already-constructed repository's `Collection` reference too (they
   * all delegate to this one shared client, not a frozen snapshot).
   *
   * Never throws - a failed repair attempt here just means the
   * caller's own subsequent operation will surface the real,
   * unchanged error, exactly as before this method existed.
   */
  async ensureConnected(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`MongoDB reconnect attempt failed (${err.name})`);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensureConnected();
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

  /**
   * Runs `fn` inside a real MongoDB session transaction and commits
   * atomically - this is what makes "authoritative mutation + outbox
   * row" a single atomic unit (docs/ARCHITECTURE.md "Transactional
   * outbox"). Verified against the live Atlas replica-set topology
   * this service is configured against - see docs/DECISIONS.md #11 for
   * the verification evidence and its one documented limitation.
   *
   * `session.withTransaction` retries on MongoDB's own transient
   * transaction errors (e.g. a write conflict) per the driver's
   * documented behavior; callers must keep `fn` free of non-idempotent
   * side effects outside the session (it may run more than once).
   */
  async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    await this.ensureConnected();
    const session = this.client.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result as T;
    } finally {
      await session.endSession();
    }
  }
}
