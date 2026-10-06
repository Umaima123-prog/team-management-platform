import { IsInt, Min } from 'class-validator';

export class ArchiveProjectDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
