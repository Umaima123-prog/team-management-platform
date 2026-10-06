import { ArgumentsHost, BadRequestException, ConflictException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostWith(response: { status: jest.Mock; json: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    host = hostWith({ status, json });
  });

  it('wraps a custom {code, message, ...extra} exception body under error, moving extras to details', () => {
    const exception = new ConflictException({
      code: 'CONFLICT',
      message: 'stale',
      currentVersion: 5,
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'CONFLICT', message: 'stale', details: { currentVersion: 5 } },
    });
  });

  it('maps a plain-string HttpException message using the status-derived code', () => {
    const exception = new BadRequestException('bad input');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'VALIDATION_ERROR', message: 'bad input' },
    });
  });

  it("maps ValidationPipe's default {message: string[]} shape to VALIDATION_ERROR with details", () => {
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['title must be a string', 'title should not be empty'],
      error: 'Bad Request',
    });

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        details: ['title must be a string', 'title should not be empty'],
      },
    });
  });

  it('never leaks internals for an unexpected non-HttpException error', () => {
    filter.catch(new Error('connection string leaked here'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
    });
  });
});
