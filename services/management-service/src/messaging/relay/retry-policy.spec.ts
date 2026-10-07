import { ErrorCode as NatsErrorCode, NatsError } from 'nats';
import { EnvelopeValidationError } from '../events/envelope-validator';
import {
  classifyPublishError,
  computeBackoffMs,
  MAX_PUBLISH_ATTEMPTS,
  PublishErrorCode,
} from './retry-policy';

describe('classifyPublishError', () => {
  it('classifies an envelope validation failure as non-retryable (malformed local event)', () => {
    const result = classifyPublishError(new EnvelopeValidationError('bad envelope'));
    expect(result).toEqual({ retryable: false, code: PublishErrorCode.VALIDATION_FAILED });
  });

  it('classifies a NATS timeout as retryable', () => {
    const error = new NatsError('timeout', NatsErrorCode.Timeout);
    const result = classifyPublishError(error);
    expect(result).toEqual({ retryable: true, code: PublishErrorCode.NATS_TIMEOUT });
  });

  it.each([
    NatsErrorCode.ConnectionClosed,
    NatsErrorCode.ConnectionRefused,
    NatsErrorCode.ConnectionTimeout,
    NatsErrorCode.Disconnect,
  ])('classifies NATS error "%s" as retryable (transient availability)', (code) => {
    const result = classifyPublishError(new NatsError('x', code));
    expect(result.retryable).toBe(true);
    expect(result.code).toBe(PublishErrorCode.NATS_UNAVAILABLE);
  });

  it('classifies an unrecognized NATS protocol/permission error as non-retryable (configuration problem)', () => {
    const result = classifyPublishError(new NatsError('permission denied', NatsErrorCode.PermissionsViolation));
    expect(result.retryable).toBe(false);
  });

  it('classifies a connection-not-yet-established error (e.g. getJetStreamClient rejected) as retryable', () => {
    const result = classifyPublishError(new Error('not connected yet'));
    expect(result).toEqual({ retryable: true, code: PublishErrorCode.JETSTREAM_NOT_READY });
  });
});

describe('computeBackoffMs', () => {
  it('grows exponentially with the attempt count', () => {
    expect(computeBackoffMs(1)).toBe(1000);
    expect(computeBackoffMs(2)).toBe(2000);
    expect(computeBackoffMs(3)).toBe(4000);
    expect(computeBackoffMs(4)).toBe(8000);
  });

  it('is capped at a bounded maximum rather than growing unbounded', () => {
    expect(computeBackoffMs(20)).toBe(60_000);
  });

  it('defines a finite maximum attempt count (bounded retry, no infinite loop)', () => {
    expect(MAX_PUBLISH_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_PUBLISH_ATTEMPTS)).toBe(true);
  });
});
