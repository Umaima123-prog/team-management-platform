import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode as NatsErrorCode, headers as natsHeaders, NatsError } from 'nats';
import { NatsConnectionService } from '../nats/nats-connection.service';
import { formatMessagingLog } from '../logging/messaging-log';
import { PROJECT_ACTIVITY_QUERY_SUBJECT } from '../events/subjects';
import { ActivityQueryOutcome, ProjectActivityResponse } from './activity.types';

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_LIMIT = 50;

function isValidActivityResponse(value: unknown): value is ProjectActivityResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.status === 'not_ready') {
    return typeof record.reason === 'string';
  }
  if (record.status === 'ok') {
    const data = record.data as Record<string, unknown> | undefined;
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.projectId === 'string' &&
      typeof data.generatedAt === 'string' &&
      Array.isArray(data.entries)
    );
  }
  return false;
}

/**
 * NestJS/BFF side of the Core NATS request/reply project-activity
 * query (tm.query.v1.project_activity) - the Phase 6 admin UI's
 * Activity screen reading the real, asynchronously-built
 * activity_projection, never a direct DB read from the browser and
 * never a direct NATS connection from the browser. Deliberately the
 * same shape as InsightsClientService (docs/DECISIONS.md #2/#22):
 * no persistence of the request, a bounded timeout, and a typed
 * fallback - a timeout or missing responder is an acceptable, cheap
 * failure mode for a read query, never an unbounded wait or a 500.
 */
@Injectable()
export class ActivityClientService {
  private readonly logger = new Logger(ActivityClientService.name);
  private readonly timeoutMs: number;
  private readonly subject: string;

  constructor(
    private readonly nats: NatsConnectionService,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(config.get('INSIGHTS_QUERY_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
    // Test-only seam (never set in real deployment config) - see
    // InsightsClientService's identical override for why (docs/
    // DECISIONS.md #31/#32).
    this.subject = config.get('ACTIVITY_QUERY_SUBJECT_OVERRIDE') ?? PROJECT_ACTIVITY_QUERY_SUBJECT;
  }

  async getProjectActivity(
    projectId: string,
    workspaceId: string,
    correlationId: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<ActivityQueryOutcome> {
    const start = Date.now();

    if (!this.nats.isConnected()) {
      this.log(correlationId, projectId, 'unavailable_not_connected', start);
      return { status: 'unavailable', reason: 'NATS_NOT_CONNECTED' };
    }

    try {
      const nc = await this.nats.getConnection();
      const h = natsHeaders();
      h.set('X-Correlation-Id', correlationId);
      const payload = JSON.stringify({ projectId, workspaceId, correlationId, limit });

      const msg = await nc.request(this.subject, new TextEncoder().encode(payload), {
        timeout: this.timeoutMs,
        headers: h,
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(msg.data));
      } catch {
        this.log(correlationId, projectId, 'unavailable_malformed', start);
        return { status: 'unavailable', reason: 'MALFORMED_RESPONSE' };
      }

      if (!isValidActivityResponse(parsed)) {
        this.log(correlationId, projectId, 'unavailable_malformed', start);
        return { status: 'unavailable', reason: 'MALFORMED_RESPONSE' };
      }

      this.log(correlationId, projectId, parsed.status === 'ok' ? 'ok' : 'not_ready', start);
      return parsed;
    } catch (error) {
      if (error instanceof NatsError) {
        if (error.code === (NatsErrorCode.Timeout as string)) {
          this.log(correlationId, projectId, 'pending_timeout', start);
          return { status: 'pending', reason: 'TIMEOUT' };
        }
        if (error.code === (NatsErrorCode.NoResponders as string)) {
          this.log(correlationId, projectId, 'unavailable_no_responder', start);
          return { status: 'unavailable', reason: 'NO_RESPONDER' };
        }
      }
      this.log(correlationId, projectId, 'unavailable_error', start);
      return { status: 'unavailable', reason: 'ERROR' };
    }
  }

  private log(correlationId: string, projectId: string, result: string, start: number): void {
    this.logger.log(
      formatMessagingLog({
        service: 'management-service',
        correlationId,
        subject: this.subject,
        aggregateId: projectId,
        latencyMs: Date.now() - start,
        result,
      }),
    );
  }
}
