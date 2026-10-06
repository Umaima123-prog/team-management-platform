import { IsInt, Min } from 'class-validator';

export class ArchiveWorkItemDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
