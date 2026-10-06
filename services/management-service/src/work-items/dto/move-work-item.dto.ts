import { IsInt, IsMongoId, IsOptional, IsUUID, Min } from 'class-validator';

export class MoveWorkItemDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsUUID()
  targetColumnId!: string;

  /** Id of the item that should end up immediately before this one in
   * the target column, if any (omit to move to the top). */
  @IsOptional()
  @IsMongoId()
  beforeItemId?: string;

  /** Id of the item that should end up immediately after this one in
   * the target column, if any (omit to move to the bottom). */
  @IsOptional()
  @IsMongoId()
  afterItemId?: string;
}
