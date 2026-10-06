import { IsInt, Min } from 'class-validator';

export class ArchiveTeamDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
