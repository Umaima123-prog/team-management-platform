import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class AssignWorkItemDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  /** Omit (or null) to unassign. */
  @IsOptional()
  @IsMongoId()
  assigneeId?: string | null;
}
