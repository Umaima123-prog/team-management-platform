import { ConfigService } from '@nestjs/config';
import { ErrorCode as NatsErrorCode, NatsError } from 'nats';
import { NatsConnectionService } from '../nats/nats-connection.service';
import { ActivityClientService } from './activity-client.service';
import { PROJECT_ACTIVITY_QUERY_SUBJECT } from '../events/subjects';

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe('ActivityClientService', () => {
  let connection: { request: jest.Mock };
  let nats: { isConnected: jest.Mock; getConnection: jest.Mock };
  let config: { get: jest.Mock };
  let client: ActivityClientService;

  beforeEach(() => {
    connection = { request: jest.fn() };
    nats = { isConnected: jest.fn().mockReturnValue(true), getConnection: jest.fn().mockResolvedValue(connection) };
    config = { get: jest.fn().mockReturnValue(undefined) };
    client = new ActivityClientService(nats as unknown as NatsConnectionService, config as unknown as ConfigService);
  });

  it('returns "unavailable" immediately, without attempting a request, when NATS is not connected', async () => {
    nats.isConnected.mockReturnValue(false);

    const result = await client.getProjectActivity('proj-1', 'ws-1', 'corr-1');

    expect(result).toEqual({ status: 'unavailable', reason: 'NATS_NOT_CONNECTED' });
    expect(connection.request).not.toHaveBeenCalled();
  });

  it('returns the parsed "ok" response from a real responder', async () => {
    const data = {
      status: 'ok',
      data: {
        projectId: 'proj-1',
        generatedAt: new Date().toISOString(),
        entries: [
          {
            eventId: 'evt-1',
            eventType: 'workitem.created',
            aggregateType: 'WorkItem',
            aggregateId: 'wi-1',
            actorId: 'u1',
            occurredAt: new Date().toISOString(),
          },
        ],
        lastProcessedSequence: 42,
      },
    };
    connection.request.mockResolvedValue({ data: encode(data) });

    const result = await client.getProjectActivity('proj-1', 'ws-1', 'corr-1');

    expect(result).toEqual(data);
  });

  it('sends the query on the documented subject with a bounded timeout, correlationId header, and limit', async () => {
    connection.request.mockResolvedValue({ data: encode({ status: 'not_ready', reason: 'pending' }) });

    await client.getProjectActivity('proj-1', 'ws-1', 'corr-1');

    const [subject, body, options] = connection.request.mock.calls[0] as [
      string,
      Uint8Array,
      { timeout: number; headers: { get: (k: string) => string } },
    ];
    expect(subject).toBe(PROJECT_ACTIVITY_QUERY_SUBJECT);
    expect(options.timeout).toBeGreaterThan(0);
    expect(Number.isFinite(options.timeout)).toBe(true);
    expect(options.headers.get('X-Correlation-Id')).toBe('corr-1');
    const parsedBody = JSON.parse(new TextDecoder().decode(body)) as { limit: number };
    expect(parsedBody.limit).toBe(50);
  });

  it('returns "pending" on a request timeout, never throwing / never blocking indefinitely', async () => {
    connection.request.mockRejectedValue(new NatsError('timeout', NatsErrorCode.Timeout));

    const result = await client.getProjectActivity('proj-1', 'ws-1', 'corr-1');

    expect(result).toEqual({ status: 'pending', reason: 'TIMEOUT' });
  });

  it('returns "unavailable" (NO_RESPONDER) when nothing is listening on the subject yet', async () => {
    connection.request.mockRejectedValue(new NatsError('no responders', NatsErrorCode.NoResponders));

    const result = await client.getProjectActivity('proj-1', 'ws-1', 'corr-1');

    expect(result).toEqual({ status: 'unavailable', reason: 'NO_RESPONDER' });
  });

  it('returns "unavailable" (MALFORMED_RESPONSE) on a reply that does not match the strict response schema', async () => {
    connection.request.mockResolvedValue({ data: encode({ nonsense: true }) });

    const result = await client.getProjectActivity('proj-1', 'ws-1', 'corr-1');

    expect(result).toEqual({ status: 'unavailable', reason: 'MALFORMED_RESPONSE' });
  });

  it('returns a typed "not_ready" response unchanged', async () => {
    connection.request.mockResolvedValue({
      data: encode({ status: 'not_ready', reason: 'projection not yet caught up' }),
    });

    const result = await client.getProjectActivity('proj-1', 'ws-1', 'corr-1');

    expect(result).toEqual({ status: 'not_ready', reason: 'projection not yet caught up' });
  });
});
