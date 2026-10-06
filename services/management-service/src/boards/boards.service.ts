import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { BoardsRepository } from './boards.repository';

@Injectable()
export class BoardsService {
  constructor(private readonly boardsRepository: BoardsRepository) {}

  createDefaultBoard(workspaceId: string, projectId: string) {
    return this.boardsRepository.createDefaultBoard(workspaceId, projectId);
  }

  async getByProjectId(workspaceId: string, projectId: string) {
    const board = await this.boardsRepository.findByProjectId(workspaceId, projectId);
    if (!board) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Board not found.' });
    }
    return board;
  }

  async getByIdOrThrow(workspaceId: string, boardId: string) {
    const board = await this.boardsRepository.findById(workspaceId, boardId);
    if (!board) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Board not found.' });
    }
    return board;
  }
}
