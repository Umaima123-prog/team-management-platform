import { Module } from '@nestjs/common';
import { BoardsController } from './boards.controller';
import { BoardsRepository } from './boards.repository';
import { BoardsService } from './boards.service';

@Module({
  controllers: [BoardsController],
  providers: [BoardsRepository, BoardsService],
  exports: [BoardsRepository, BoardsService],
})
export class BoardsModule {}
