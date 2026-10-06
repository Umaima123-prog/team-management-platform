import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { mongoClientProvider, mongoDbProvider } from './database.providers';
import { DatabaseService } from './database.service';
import { IndexBootstrapService } from './index-bootstrap.service';
import { MONGO_CLIENT } from './database.tokens';

@Global()
@Module({
  providers: [mongoClientProvider, mongoDbProvider, DatabaseService, IndexBootstrapService],
  exports: [DatabaseService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
