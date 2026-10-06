import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'code must contain only uppercase letters, digits, hyphens, and underscores.',
  })
  @MinLength(2)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
